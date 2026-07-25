import * as childProcess from 'child_process';
import * as vscode from 'vscode';

import type { ConfigManager } from '../config/config';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function execVersion(binPath: string): Promise<string> {
  return new Promise((resolve, reject) =>
    childProcess.execFile(binPath, ['--version'], { timeout: 5_000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.trim()),
    ),
  );
}

/** Extracts a bare semver string (e.g. "1.2.3") from raw version output. */
function parseVersion(raw: string): string {
  const m = raw.match(/v?(\d+\.\d+[\.\d]*)/);
  return m ? `v${m[1]}` : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// StatusBarManager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the Gopher-Glide entry in the VS Code status bar.
 *
 * States
 * ──────
 *  loading   — spin icon, shown while install / update check is running
 *  ready     — checkmark + version, green background on hover
 *  notFound  — warning icon, orange background; clicking opens install prompt
 *  error     — error icon, red background; clicking opens settings
 *
 * The item always appears on the **right** side of the status bar. Clicking it
 * runs `gg.checkForUpdates` (or `workbench.action.openSettings` if not found).
 */
export class StatusBarManager implements vscode.Disposable {
  private readonly _item: vscode.StatusBarItem;
  private readonly _disposables: vscode.Disposable[] = [];

  constructor(private readonly configMgr: ConfigManager) {
    this._item = vscode.window.createStatusBarItem(
      'gopher-glide.status',
      vscode.StatusBarAlignment.Right,
      /* priority */ 500,
    );
    this._item.name = 'Gopher-Glide';
    this._item.show();

    // Show loading immediately — refresh() will update it
    this.setLoading();

    // Auto-refresh whenever the binary path changes
    this._disposables.push(
      configMgr.onDidChangeConfig(({ changedKeys }) => {
        if (changedKeys.includes('binaryPath')) {
          void this.refresh();
        }
      }),
    );
  }

  // ── Public state setters ──────────────────────────────────────────────────

  /** Shown while an install or update-check is in progress. */
  setLoading(): void {
    this._item.text             = '$(loading~spin) gg';
    this._item.tooltip          = 'Gopher-Glide — checking binary…';
    this._item.command          = undefined;
    this._item.backgroundColor  = undefined;
    this._item.color            = undefined;
  }

  /** Shown when the binary is reachable and the version is known. */
  setReady(version: string): void {
    this._item.text             = `$(check) gg ${version}`;
    this._item.tooltip          = this._readyTooltip(version);
    this._item.command          = 'gg.checkForUpdates';
    this._item.backgroundColor  = undefined;
    this._item.color            = new vscode.ThemeColor('statusBar.foreground');
  }

  /** Shown when the binary can be found on PATH but the version can't be parsed. */
  setUnknownVersion(): void {
    this._item.text             = '$(tools) gg';
    this._item.tooltip          = this._readyTooltip('unknown');
    this._item.command          = 'gg.checkForUpdates';
    this._item.backgroundColor  = undefined;
    this._item.color            = undefined;
  }

  /** Shown when the binary is not reachable at all. */
  setNotFound(): void {
    this._item.text             = '$(warning) gg: not found';
    this._item.tooltip          = new vscode.MarkdownString(
      '**Gopher-Glide** — `gg` binary not found.\n\n' +
      'Click to trigger auto-install, or set `gg.binaryPath` in Settings.',
    );
    this._item.command          = 'gg.checkForUpdates';
    this._item.backgroundColor  = new vscode.ThemeColor('statusBarItem.warningBackground');
    this._item.color            = new vscode.ThemeColor('statusBarItem.warningForeground');
  }

  /** Shown on unexpected errors (e.g. permission denied). */
  setError(message: string): void {
    this._item.text             = '$(error) gg: error';
    this._item.tooltip          = new vscode.MarkdownString(
      `**Gopher-Glide** — error detecting \`gg\`:\n\n\`${message}\`\n\n` +
      'Click to open Settings.',
    );
    this._item.command          = {
      command:   'workbench.action.openSettings',
      title:     'Open Settings',
      arguments: ['gg.binaryPath'],
    };
    this._item.backgroundColor  = new vscode.ThemeColor('statusBarItem.errorBackground');
    this._item.color            = new vscode.ThemeColor('statusBarItem.errorForeground');
  }

  // ── Public actions ────────────────────────────────────────────────────────

  /**
   * Probes `effectiveBinaryPath`, runs `gg --version`, and updates the item.
   * Safe to call at any time; never throws.
   */
  async refresh(): Promise<void> {
    const binPath = this.configMgr.effectiveBinaryPath;

    try {
      const raw     = await execVersion(binPath);
      const version = parseVersion(raw);

      if (version) {
        this.setReady(version);
      } else {
        this.setUnknownVersion();
      }
    } catch (err) {
      // Distinguish "file not found / ENOENT" (binary missing) from other errors
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EACCES') {
        this.setNotFound();
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        this.setError(msg);
      }
    }
  }

  // ── Disposable ────────────────────────────────────────────────────────────

  dispose(): void {
    this._item.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables.length = 0;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _readyTooltip(version: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString(
      `**Gopher-Glide** — \`gg ${version}\` is active.\n\n` +
      `Click to check for updates.`,
    );
    md.isTrusted = true;
    return md;
  }
}
