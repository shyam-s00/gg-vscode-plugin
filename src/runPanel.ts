import * as vscode from 'vscode';

import type { GgRunner, HeartbeatPayload, HeartbeatStageInfo, RunExitInfo } from './runner';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type RunStatus = 'idle' | 'running' | 'finished' | 'interrupted' | 'error';

export interface ChartPoint {
  elapsedSec: number;
  actualRps: number;
  targetRps: number;
}

export interface RunPanelState {
  status: RunStatus;
  profile?: string;
  message?: string;
  /** Set when a `snap` heartbeat arrives — informational, doesn't affect `status`. */
  snapMessage?: string;
  startedAtMs?: number;
  totalDurationSec?: number;
  stages: HeartbeatStageInfo[];
  currentStage?: number;
  totalStages?: number;
  targetRps?: number;
  actualRps?: number;
  errorRate?: number;
  totalRequests?: number;
  p50?: number;
  p95?: number;
  p99?: number;
  points: ChartPoint[];
  stderrTail?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure state transitions — exported for direct unit testing, no vscode/canvas
// involved. The class below only wires these to GgRunner events and the
// webview; all the actual "what does a heartbeat mean" logic lives here.
// ─────────────────────────────────────────────────────────────────────────────

export function createEmptyState(): RunPanelState {
  return { status: 'idle', stages: [], points: [] };
}

/** Applies one `gg --headless --reporter json` heartbeat to produce the next state. */
export function applyHeartbeat(state: RunPanelState, payload: HeartbeatPayload, now: number = Date.now()): RunPanelState {
  switch (payload.event) {
    case 'started': {
      const stages = payload.stages ?? [];
      return {
        ...createEmptyState(),
        status: 'running',
        profile: payload.profile,
        message: payload.message,
        stages,
        totalStages: payload.total_stages,
        totalDurationSec: stages.length
          ? stages.reduce((sum, s) => sum + (s.duration_seconds ?? 0), 0)
          : undefined,
        startedAtMs: now,
      };
    }
    case 'heartbeat': {
      const elapsedSec = state.startedAtMs !== undefined ? (now - state.startedAtMs) / 1000 : 0;
      return {
        ...state,
        currentStage: payload.stage,
        targetRps: payload.target_rps,
        actualRps: payload.actual_rps,
        errorRate: payload.error_rate,
        totalRequests: payload.total_requests,
        p50: payload.p50_ms,
        p95: payload.p95_ms,
        p99: payload.p99_ms,
        points: [
          ...state.points,
          { elapsedSec, actualRps: payload.actual_rps ?? 0, targetRps: payload.target_rps ?? 0 },
        ],
      };
    }
    case 'finished':
      return { ...state, status: 'finished', message: payload.message };
    case 'interrupted':
      return { ...state, status: 'interrupted', message: payload.message };
    case 'error':
      return { ...state, status: 'error', message: payload.message };
    case 'snap':
      return { ...state, snapMessage: payload.message };
    default:
      return state;
  }
}

/**
 * Applies process-exit info. Only overrides `status` when a run is still
 * marked 'running' — i.e. when the process exited without ever sending a
 * terminal heartbeat (crash, or an older binary), so we don't clobber a
 * 'finished'/'interrupted'/'error' status a heartbeat already set.
 */
export function applyExit(state: RunPanelState, info: RunExitInfo): RunPanelState {
  let next = state;
  if (state.status === 'running') {
    next = {
      ...state,
      status: info.code === 0 ? 'finished' : 'error',
      message: info.code === 0
        ? state.message
        : (info.signal ? `gg exited via signal ${info.signal}` : `gg exited with code ${info.code}`),
    };
  }
  if (info.code !== 0) {
    next = { ...next, stderrTail: info.stderrTail };
  }
  return next;
}

export function applySpawnError(state: RunPanelState, err: Error): RunPanelState {
  return { ...state, status: 'error', message: `Failed to start gg: ${err.message}` };
}

// ─────────────────────────────────────────────────────────────────────────────
// RunPanel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * VS Code's equivalent of the JetBrains plugin's `GopherGlideRunPanel` +
 * `RpsChartComponent` + `StageTimelineComponent` — a Webview since that's the
 * only way to render live charts here.
 *
 * Fully decoupled from `RunCommands`/the run UX flow: it subscribes directly
 * to `GgRunner`'s events and reveals/resets itself automatically whenever a
 * run starts, so triggering a run never needs to know this panel exists.
 */
export class RunPanel implements vscode.Disposable {
  private static readonly VIEW_TYPE = 'gg.runPanel';
  private static readonly TITLE = 'Gopher-Glide Run';

  private readonly _disposables: vscode.Disposable[] = [];
  private _panel: vscode.WebviewPanel | undefined;
  private _panelDisposables: vscode.Disposable[] = [];
  private _shownForCurrentRun = false;
  private _state: RunPanelState = createEmptyState();

  constructor(private readonly runner: GgRunner) {
    this._disposables.push(
      { dispose: this.runner.onHeartbeat((p) => this._onHeartbeat(p)) },
      { dispose: this.runner.onExit((info) => this._onExit(info)) },
      { dispose: this.runner.onSpawnError((err) => this._onSpawnError(err)) },
    );
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
    this._disposables.length = 0;
    this._disposePanel();
  }

  // ── GgRunner event handlers ────────────────────────────────────────────────

  private _onHeartbeat(payload: HeartbeatPayload): void {
    if (payload.event === 'started') {
      this._shownForCurrentRun = false;
    }
    this._state = applyHeartbeat(this._state, payload);
    this._ensureVisible();
    this._postState();
  }

  private _onExit(info: RunExitInfo): void {
    this._state = applyExit(this._state, info);
    this._ensureVisible();
    this._postState();
  }

  private _onSpawnError(err: Error): void {
    this._state = applySpawnError(this._state, err);
    this._ensureVisible();
    this._postState();
  }

  // ── Webview lifecycle ──────────────────────────────────────────────────────

  private _ensureVisible(): void {
    if (!this._panel) {
      this._createPanel();
      this._shownForCurrentRun = true;
      return;
    }
    if (!this._shownForCurrentRun) {
      this._panel.reveal(this._panel.viewColumn, true);
      this._shownForCurrentRun = true;
    }
  }

  private _createPanel(): void {
    const panel = vscode.window.createWebviewPanel(
      RunPanel.VIEW_TYPE,
      RunPanel.TITLE,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );

    // Initial state is embedded directly in the HTML (rather than relying on
    // a postMessage round-trip) since the webview's script isn't guaranteed
    // to have registered its message listener before we could otherwise post.
    panel.webview.html = renderHtml(panel.webview, this._state);

    this._panelDisposables.push(
      panel.webview.onDidReceiveMessage((msg: { command?: string }) => {
        if (msg?.command === 'stop') {
          this.runner.stop();
        }
      }),
      panel.onDidDispose(() => {
        this._panelDisposables.forEach((d) => d.dispose());
        this._panelDisposables = [];
        this._panel = undefined;
      }),
    );

    this._panel = panel;
  }

  private _disposePanel(): void {
    this._panelDisposables.forEach((d) => d.dispose());
    this._panelDisposables = [];
    this._panel?.dispose();
    this._panel = undefined;
  }

  private _postState(): void {
    this._panel?.webview.postMessage({ type: 'state', state: this._state });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webview HTML
// ─────────────────────────────────────────────────────────────────────────────

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

/** Exported for direct testing — the rest of the HTML/canvas/DOM logic isn't otherwise verifiable outside a real webview. */
export function renderHtml(webview: vscode.Webview, initialState: RunPanelState): string {
  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 12px 16px;
  }
  .header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; background: #888; flex-shrink: 0; }
  .status-dot.status-running { background: #3fb950; }
  .status-dot.status-finished { background: #58a6ff; }
  .status-dot.status-interrupted { background: #d29922; }
  .status-dot.status-error { background: #f85149; }
  #statusText { font-weight: 600; }
  #profileText, #elapsedText { color: var(--vscode-descriptionForeground); margin-left: auto; }
  #stopBtn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none; border-radius: 2px; padding: 4px 12px; cursor: pointer;
  }
  #stopBtn:disabled { opacity: 0.5; cursor: default; }
  .metrics-row { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .metric-card {
    flex: 1; min-width: 110px;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px; padding: 8px 10px;
  }
  .metric-label { font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
  .metric-value { font-size: 18px; font-weight: 600; }
  .metric-good { color: #3fb950; }
  .metric-warn { color: #d29922; }
  .metric-bad { color: #f85149; }
  #timeline {
    position: relative; display: flex; height: 28px;
    border-radius: 4px; overflow: hidden; margin-bottom: 12px;
  }
  .stage-segment {
    background: var(--vscode-panel-border);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; white-space: nowrap; overflow: hidden;
    border-right: 1px solid var(--vscode-editor-background);
  }
  .stage-segment.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .timeline-marker { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--vscode-editor-foreground); }
  #chartContainer { height: 200px; margin-bottom: 12px; }
  #rpsChart { width: 100%; height: 100%; }
  #errorBanner {
    display: none; white-space: pre-wrap; font-family: var(--vscode-editor-font-family);
    background: rgba(248, 81, 73, 0.1); border: 1px solid #f85149; border-radius: 4px;
    padding: 8px 10px; font-size: 12px; margin-bottom: 12px;
  }
  #snapMessage { display: none; color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 12px; }
</style>
</head>
<body>
  <div class="header">
    <div id="statusDot" class="status-dot"></div>
    <div id="statusText"></div>
    <div id="profileText"></div>
    <div id="elapsedText"></div>
    <button id="stopBtn">Stop</button>
  </div>

  <div class="metrics-row">
    <div class="metric-card"><div class="metric-label">Target RPS</div><div id="metric-targetRps" class="metric-value">—</div></div>
    <div class="metric-card"><div class="metric-label">Actual RPS</div><div id="metric-actualRps" class="metric-value">—</div></div>
    <div class="metric-card"><div class="metric-label">Error Rate</div><div id="metric-errorRate" class="metric-value">—</div></div>
    <div class="metric-card"><div class="metric-label">Total Requests</div><div id="metric-totalRequests" class="metric-value">—</div></div>
    <div class="metric-card"><div class="metric-label">Latency (p50 / p95 / p99)</div><div id="metric-latency" class="metric-value">—</div></div>
  </div>

  <div id="timeline"></div>

  <div id="chartContainer"><canvas id="rpsChart"></canvas></div>

  <div id="snapMessage"></div>
  <div id="errorBanner"></div>

<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  let state = ${JSON.stringify(initialState)};

  document.getElementById('stopBtn').addEventListener('click', () => {
    vscode.postMessage({ command: 'stop' });
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'state') {
      state = msg.state;
      render();
    }
  });

  function statusLabel(s) {
    switch (s.status) {
      case 'running': return 'RUNNING';
      case 'finished': return 'FINISHED';
      case 'interrupted': return 'INTERRUPTED';
      case 'error': return 'ERROR';
      default: return 'IDLE';
    }
  }

  function formatElapsed(s) {
    if (s.startedAtMs === undefined) return '';
    const endMs = (s.status === 'running') ? Date.now() : (s.startedAtMs + (s.points.length ? s.points[s.points.length - 1].elapsedSec * 1000 : 0));
    const totalSec = Math.max(0, Math.floor((endMs - s.startedAtMs) / 1000));
    const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const sec = (totalSec % 60).toString().padStart(2, '0');
    return m + ':' + sec;
  }

  function setMetric(id, value) {
    document.getElementById('metric-' + id).textContent = (value === undefined || value === null) ? '—' : String(value);
  }

  // Fixed at 2 decimals so the latency tile's width stays constant between
  // updates instead of jumping as gg's raw float precision varies.
  function fmtMs(value) {
    return (typeof value === 'number' ? value : 0).toFixed(2);
  }

  function actualRpsClass(s) {
    if (s.targetRps === undefined || s.actualRps === undefined || s.targetRps === 0) return '';
    const ratio = s.actualRps / s.targetRps;
    if (ratio >= 0.9) return 'metric-good';
    if (ratio >= 0.5) return 'metric-warn';
    return 'metric-bad';
  }

  function renderTimeline(container, s) {
    container.innerHTML = '';
    const stages = s.stages || [];
    const elapsedSec = s.points.length ? s.points[s.points.length - 1].elapsedSec : 0;

    if (stages.length && s.totalDurationSec) {
      stages.forEach((stage, idx) => {
        const dur = stage.duration_seconds || 0;
        const widthPct = (dur / s.totalDurationSec) * 100;
        const seg = document.createElement('div');
        seg.className = 'stage-segment' + (idx === s.currentStage ? ' active' : '');
        seg.style.width = widthPct + '%';
        seg.textContent = widthPct > 8 ? (stage.name || ('Stage ' + (idx + 1))) : '';
        container.appendChild(seg);
      });
      const marker = document.createElement('div');
      marker.className = 'timeline-marker';
      marker.style.left = Math.min(100, (elapsedSec / s.totalDurationSec) * 100) + '%';
      container.appendChild(marker);
    } else if (s.totalStages) {
      for (let i = 0; i < s.totalStages; i++) {
        const seg = document.createElement('div');
        seg.className = 'stage-segment' + (i === s.currentStage ? ' active' : '');
        seg.style.width = (100 / s.totalStages) + '%';
        seg.textContent = 'Stage ' + (i + 1);
        container.appendChild(seg);
      }
    }
  }

  function drawChart(canvas, s) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.clientWidth;
    const h = canvas.height = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const points = s.points;
    if (!points.length) return;

    const axisColor = getComputedStyle(document.documentElement).getPropertyValue('--vscode-descriptionForeground').trim() || '#888';
    const padding = { left: 40, right: 10, top: 10, bottom: 10 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;

    let peak = (s.stages || []).reduce((m, st) => Math.max(m, st.target_rps || 0), 0);
    if (!peak) {
      peak = points.reduce((m, p) => Math.max(m, p.actualRps, p.targetRps), 10);
    }

    let visible = points;
    let xMax = s.totalDurationSec;
    let xOffset = 0;
    if (!xMax) {
      visible = points.slice(-60);
      xOffset = visible[0].elapsedSec;
      xMax = Math.max(1, visible[visible.length - 1].elapsedSec - xOffset);
    }

    function xPos(elapsedSec) { return padding.left + ((elapsedSec - xOffset) / xMax) * plotW; }
    function yPos(value) { return padding.top + plotH - (Math.min(value, peak) / peak) * plotH; }

    ctx.strokeStyle = 'rgba(128,128,128,0.3)';
    ctx.fillStyle = axisColor;
    ctx.font = '10px sans-serif';
    [0, 0.5, 1].forEach((frac) => {
      const y = padding.top + plotH - frac * plotH;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
      ctx.fillText(Math.round(peak * frac).toString(), 2, y + 3);
    });

    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 1;
    ctx.beginPath();
    visible.forEach((p, i) => {
      const x = xPos(p.elapsedSec), y = yPos(p.targetRps);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.strokeStyle = '#3fb950';
    ctx.lineWidth = 2;
    ctx.beginPath();
    visible.forEach((p, i) => {
      const x = xPos(p.elapsedSec), y = yPos(p.actualRps);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function render() {
    document.getElementById('statusDot').className = 'status-dot status-' + state.status;
    document.getElementById('statusText').textContent = statusLabel(state);
    document.getElementById('profileText').textContent = state.profile ? ('profile: ' + state.profile) : '';
    document.getElementById('elapsedText').textContent = formatElapsed(state);
    document.getElementById('stopBtn').disabled = state.status !== 'running';

    setMetric('targetRps', state.targetRps);
    setMetric('actualRps', state.actualRps);
    document.getElementById('metric-actualRps').className = 'metric-value ' + actualRpsClass(state);
    setMetric('errorRate', state.errorRate !== undefined ? (state.errorRate * 100).toFixed(2) + '%' : undefined);
    document.getElementById('metric-errorRate').className = 'metric-value ' + (state.errorRate ? 'metric-bad' : '');
    setMetric('totalRequests', state.totalRequests);
    setMetric('latency', state.p50 !== undefined
      ? (fmtMs(state.p50) + ' / ' + fmtMs(state.p95) + ' / ' + fmtMs(state.p99) + ' ms')
      : undefined);

    const snapEl = document.getElementById('snapMessage');
    if (state.snapMessage) {
      snapEl.style.display = 'block';
      snapEl.textContent = state.snapMessage;
    } else {
      snapEl.style.display = 'none';
    }

    const errorEl = document.getElementById('errorBanner');
    if (state.status === 'error' && (state.message || (state.stderrTail && state.stderrTail.length))) {
      errorEl.style.display = 'block';
      errorEl.textContent = [state.message, ...(state.stderrTail || [])].filter(Boolean).join('\\n');
    } else {
      errorEl.style.display = 'none';
    }

    renderTimeline(document.getElementById('timeline'), state);
    drawChart(document.getElementById('rpsChart'), state);
  }

  setInterval(() => {
    if (state.status === 'running') {
      document.getElementById('elapsedText').textContent = formatElapsed(state);
    }
  }, 1000);

  render();
})();
</script>
</body>
</html>`;
}
