import * as vscode from 'vscode';

import { getNonce, readTemplate, resolveAssetUris } from '../../webview/webviewAssets';
import type { GgRunner, HeartbeatPayload, HeartbeatStageInfo, RunExitInfo } from '../runner';

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
 * Docked in a bottom panel container (alongside Terminal/Output), not opened
 * as an editor tab — matching the JetBrains tool window rather than
 * competing for editor tab space. See `contributes.viewsContainers`/`views`
 * in package.json for the `gg.runView` registration this implements.
 *
 * Fully decoupled from `RunCommands`/the run UX flow: it subscribes directly
 * to `GgRunner`'s events and reveals/resets itself automatically whenever a
 * run starts, so triggering a run never needs to know this panel exists.
 */
export class RunPanel implements vscode.Disposable, vscode.WebviewViewProvider {
  static readonly VIEW_ID = 'gg.runView';

  private readonly _disposables: vscode.Disposable[] = [];
  private _view: vscode.WebviewView | undefined;
  private _viewDisposables: vscode.Disposable[] = [];
  private _shownForCurrentRun = false;
  private _state: RunPanelState = createEmptyState();

  constructor(private readonly runner: GgRunner, private readonly extensionUri: vscode.Uri) {
    this._disposables.push(
      { dispose: this.runner.onHeartbeat((p) => this._onHeartbeat(p)) },
      { dispose: this.runner.onExit((info) => this._onExit(info)) },
      { dispose: this.runner.onSpawnError((err) => this._onSpawnError(err)) },
    );
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
    this._disposables.length = 0;
    this._viewDisposables.forEach((d) => d.dispose());
    this._viewDisposables = [];
    this._view = undefined;
  }

  /** Called by VS Code the first time the view becomes visible (and again if it's ever fully disposed and re-requested). */
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._viewDisposables.forEach((d) => d.dispose());
    this._viewDisposables = [];

    webviewView.webview.options = { enableScripts: true };
    // Initial state is embedded directly in the HTML (rather than relying on
    // a postMessage round-trip) since the webview's script isn't guaranteed
    // to have registered its message listener before we could otherwise post.
    webviewView.webview.html = renderHtml(webviewView.webview, this.extensionUri, this._state);

    this._viewDisposables.push(
      webviewView.webview.onDidReceiveMessage((msg: { command?: string }) => {
        if (msg?.command === 'stop') {
          this.runner.stop();
        }
      }),
      webviewView.onDidDispose(() => {
        if (this._view === webviewView) {
          this._view = undefined;
        }
      }),
    );

    this._view = webviewView;
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

  // ── Visibility ──────────────────────────────────────────────────────────────

  /**
   * Reveals the panel once per run (not on every heartbeat), mirroring the
   * original editor-tab behavior. The very first reveal of a session has to
   * go through the auto-generated `<viewId>.focus` command (nothing is
   * resolved yet to call `.show()` on); every reveal after that uses the
   * already-resolved view's `show(preserveFocus)` so it doesn't steal focus
   * from whatever the user is doing.
   */
  private _ensureVisible(): void {
    if (this._shownForCurrentRun) {
      return;
    }
    this._shownForCurrentRun = true;
    if (this._view) {
      this._view.show(true);
    } else {
      void vscode.commands.executeCommand(`${RunPanel.VIEW_ID}.focus`);
    }
  }

  private _postState(): void {
    this._view?.webview.postMessage({ type: 'state', state: this._state });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webview HTML
// ─────────────────────────────────────────────────────────────────────────────

/** Exported for direct testing — the rest of the HTML/canvas/DOM logic isn't otherwise verifiable outside a real webview. */
export function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri, initialState: RunPanelState): string {
  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  const { css, js } = resolveAssetUris(webview, extensionUri, 'run/panel', true);

  return readTemplate(extensionUri, 'run/panel', 'view.html')
    .replace('{{CSP}}', csp)
    .replace('{{CSS_URI}}', css.toString())
    .replace(/\{\{NONCE\}\}/g, nonce)
    .replace('{{INIT_JSON}}', JSON.stringify(initialState))
    .replace('{{JS_URI}}', js!.toString());
}
