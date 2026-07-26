import * as vscode from 'vscode';

// ─────────────────────────────────────────────────────────────────────────────
// Shared, reused WebviewPanel for all snap detail views (view/diff/assert
// result/prune result).
//
// Each of these was previously created via its own `createWebviewPanel` call,
// which meant clicking a second snap (or running a second diff/assert/prune)
// opened a brand-new panel with `ViewColumn.Beside` — and since the
// previously-opened panel is now the *active* editor, the next `Beside` opens
// beside *that*, cascading into a new editor group on every click instead of
// reusing the same tab. Routing all four through this singleton fixes that:
// subsequent calls retitle + replace the content of the one existing panel.
// ─────────────────────────────────────────────────────────────────────────────

let _panel: vscode.WebviewPanel | undefined;
let _extensionUri: vscode.Uri | undefined;
let _context: vscode.ExtensionContext | undefined;

/** Must be called once during activation, before any snap detail panel is shown. */
export function initSnapDetailPanel(context: vscode.ExtensionContext): void {
  _context = context;
  _extensionUri = context.extensionUri;
}

const SNAP_VIEW_COLUMNS_KEY = 'gg.snapView.columns';

/** Column ids the user last enabled in the snap view table, or undefined if never set. */
export function getSnapViewColumnPrefs(): string[] | undefined {
  return _context?.globalState.get<string[]>(SNAP_VIEW_COLUMNS_KEY);
}

export function setSnapViewColumnPrefs(columns: string[]): void {
  void _context?.globalState.update(SNAP_VIEW_COLUMNS_KEY, columns);
}

/**
 * Returns the shared detail panel, creating it on first use and re-titling +
 * revealing it on every call thereafter. Callers are responsible for setting
 * `panel.webview.html` themselves (they need the panel's own `webview` — with
 * its per-panel `cspSource` — to build that HTML in the first place).
 */
export function getSnapDetailPanel(title: string): vscode.WebviewPanel {
  if (_panel) {
    _panel.title = title;
    _panel.reveal(_panel.viewColumn, false);
    return _panel;
  }

  const panel = vscode.window.createWebviewPanel(
    'gg.snapDetail',
    title,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: true },
  );

  if (_extensionUri) {
    panel.iconPath = {
      light: vscode.Uri.joinPath(_extensionUri, 'media', 'ggToolIcon.svg'),
      dark: vscode.Uri.joinPath(_extensionUri, 'media', 'ggToolIcon_dark.svg'),
    };
  }

  panel.onDidDispose(() => {
    if (_panel === panel) {
      _panel = undefined;
    }
  });

  _panel = panel;
  return panel;
}
