import type { RunPanelState } from './panel';

declare global {
  interface Window {
    __GG_INIT__: RunPanelState;
  }
}

const vscodeApi = acquireVsCodeApi<RunPanelState>();
let state: RunPanelState = window.__GG_INIT__;

document.getElementById('stopBtn')!.addEventListener('click', () => {
  vscodeApi.postMessage({ command: 'stop' });
});

window.addEventListener('message', (event: MessageEvent<{ type?: string; state?: RunPanelState }>) => {
  const msg = event.data;
  if (msg && msg.type === 'state' && msg.state) {
    state = msg.state;
    render();
  }
});

function statusLabel(s: RunPanelState): string {
  switch (s.status) {
    case 'running': return 'RUNNING';
    case 'finished': return 'FINISHED';
    case 'interrupted': return 'INTERRUPTED';
    case 'error': return 'ERROR';
    default: return 'IDLE';
  }
}

function formatElapsed(s: RunPanelState): string {
  if (s.startedAtMs === undefined) { return ''; }
  const endMs = (s.status === 'running') ? Date.now() : (s.startedAtMs + (s.points.length ? s.points[s.points.length - 1].elapsedSec * 1000 : 0));
  const totalSec = Math.max(0, Math.floor((endMs - s.startedAtMs) / 1000));
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const sec = (totalSec % 60).toString().padStart(2, '0');
  return m + ':' + sec;
}

function setMetric(id: string, value: unknown): void {
  document.getElementById('metric-' + id)!.textContent = (value === undefined || value === null) ? '—' : String(value);
}

// Fixed at 2 decimals so the latency tile's width stays constant between
// updates instead of jumping as gg's raw float precision varies.
function fmtMs(value: unknown): string {
  return (typeof value === 'number' ? value : 0).toFixed(2);
}

function actualRpsClass(s: RunPanelState): string {
  if (s.targetRps === undefined || s.actualRps === undefined || s.targetRps === 0) { return ''; }
  const ratio = s.actualRps / s.targetRps;
  if (ratio >= 0.9) { return 'metric-good'; }
  if (ratio >= 0.5) { return 'metric-warn'; }
  return 'metric-bad';
}

function renderTimeline(container: HTMLElement, s: RunPanelState): void {
  container.innerHTML = '';
  const stages = s.stages || [];
  const elapsedSec = s.points.length ? s.points[s.points.length - 1].elapsedSec : 0;

  if (stages.length && s.totalDurationSec) {
    stages.forEach((stage, idx) => {
      const dur = stage.duration_seconds || 0;
      const widthPct = (dur / s.totalDurationSec!) * 100;
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

function drawChart(canvas: HTMLCanvasElement, s: RunPanelState): void {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width = canvas.clientWidth;
  const h = canvas.height = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  const points = s.points;
  if (!points.length) { return; }

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

  function xPos(elapsedSec: number): number { return padding.left + ((elapsedSec - xOffset) / xMax!) * plotW; }
  function yPos(value: number): number { return padding.top + plotH - (Math.min(value, peak) / peak) * plotH; }

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
    if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
  });
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.strokeStyle = '#3fb950';
  ctx.lineWidth = 2;
  ctx.beginPath();
  visible.forEach((p, i) => {
    const x = xPos(p.elapsedSec), y = yPos(p.actualRps);
    if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
  });
  ctx.stroke();
}

function render(): void {
  document.getElementById('statusDot')!.className = 'status-dot status-' + state.status;
  document.getElementById('statusText')!.textContent = statusLabel(state);
  document.getElementById('profileText')!.textContent = state.profile ? ('profile: ' + state.profile) : '';
  document.getElementById('elapsedText')!.textContent = formatElapsed(state);
  (document.getElementById('stopBtn') as HTMLButtonElement).disabled = state.status !== 'running';

  setMetric('targetRps', state.targetRps);
  setMetric('actualRps', state.actualRps);
  document.getElementById('metric-actualRps')!.className = 'metric-value ' + actualRpsClass(state);
  setMetric('errorRate', state.errorRate !== undefined ? (state.errorRate * 100).toFixed(2) + '%' : undefined);
  document.getElementById('metric-errorRate')!.className = 'metric-value ' + (state.errorRate ? 'metric-bad' : '');
  setMetric('totalRequests', state.totalRequests);
  setMetric('latency', state.p50 !== undefined
    ? (fmtMs(state.p50) + ' / ' + fmtMs(state.p95) + ' / ' + fmtMs(state.p99) + ' ms')
    : undefined);

  const snapEl = document.getElementById('snapMessage')!;
  if (state.snapMessage) {
    snapEl.style.display = 'block';
    snapEl.textContent = state.snapMessage;
  } else {
    snapEl.style.display = 'none';
  }

  const errorEl = document.getElementById('errorBanner')!;
  if (state.status === 'error' && (state.message || (state.stderrTail && state.stderrTail.length))) {
    errorEl.style.display = 'block';
    errorEl.textContent = [state.message, ...(state.stderrTail || [])].filter(Boolean).join('\n');
  } else {
    errorEl.style.display = 'none';
  }

  renderTimeline(document.getElementById('timeline')!, state);
  drawChart(document.getElementById('rpsChart') as HTMLCanvasElement, state);
}

setInterval(() => {
  if (state.status === 'running') {
    document.getElementById('elapsedText')!.textContent = formatElapsed(state);
  }
}, 1000);

render();
