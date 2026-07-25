import * as fs from 'fs';
import * as vscode from 'vscode';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type InstallationMode = 'auto' | 'manual' | 'pathOnly';

/** Typed snapshot of all gg.* workspace settings. */
export interface GgConfig {
  /** Absolute path to the gg binary, or '' to auto-resolve. */
  binaryPath: string;
  /** Whether to check for a newer gg CLI on activation. */
  autoUpdateCheck: boolean;
  /** Controls how the extension manages the gg CLI binary. */
  installationMode: InstallationMode;
  /** Profile to pre-select in Quick Pick, or '' to always prompt. */
  defaultProfile: string;
  /** Override directory for gg snapshot storage (passed as --snap-dir), or '' for gg's platform default. */
  snapshotsDir: string;
  /** Heartbeat cadence in seconds for headless runs (--heartbeat-interval), or 0 to use gg's own default (5s). */
  heartbeatIntervalSeconds: number;
}

/** Payload delivered to every onDidChangeConfig listener. */
export interface ConfigChangeEvent {
  /** The new configuration snapshot. */
  config: GgConfig;
  /** Which top-level keys actually changed. */
  changedKeys: ReadonlyArray<keyof GgConfig>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const SECTION = 'gg';

/** Read all gg.* settings from VS Code's configuration API. */
function readConfig(scope?: vscode.Uri): GgConfig {
  const c = vscode.workspace.getConfiguration(SECTION, scope ?? null);
  return {
    binaryPath: c.get<string>('binaryPath', '').trim(),
    autoUpdateCheck: c.get<boolean>('autoUpdateCheck', true),
    installationMode: c.get<InstallationMode>('installationMode', 'auto'),
    defaultProfile: c.get<string>('defaultProfile', '').trim(),
    snapshotsDir: c.get<string>('snapshotsDir', '').trim(),
    heartbeatIntervalSeconds: c.get<number>('heartbeatIntervalSeconds', 0),
  };
}

/** Returns the keys whose values differ between two config snapshots. */
function diffConfig(a: GgConfig, b: GgConfig): Array<keyof GgConfig> {
  return (Object.keys(a) as Array<keyof GgConfig>).filter(
    (k) => a[k] !== b[k],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfigManager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Singleton that owns the extension's gg.* settings lifecycle.
 *
 * Responsibilities:
 *  - Caches the current config so callers never call the VS Code API directly.
 *  - Fires typed `onDidChangeConfig` events with a diff of changed keys.
 *  - Validates `gg.binaryPath` on disk and warns the user when it is invalid.
 *  - Resolves the *effective* binary path used at runtime.
 *  - Implements the `gg.selectBinaryPath` command handler.
 *  - Implements `gg.checkForUpdates` (stub — wired up by the installer module).
 */
export class ConfigManager implements vscode.Disposable {
  // ── Singleton ──────────────────────────────────────────────────────────────
  private static _instance: ConfigManager | undefined;

  static getInstance(): ConfigManager {
    if (!ConfigManager._instance) {
      throw new Error('ConfigManager has not been initialized. Call ConfigManager.create() first.');
    }
    return ConfigManager._instance;
  }

  /**
   * Creates the singleton, registers commands and the config-change listener,
   * and pushes everything onto `context.subscriptions`.
   */
  static create(context: vscode.ExtensionContext): ConfigManager {
    if (ConfigManager._instance) {
      return ConfigManager._instance;
    }
    const mgr = new ConfigManager(context);
    ConfigManager._instance = mgr;
    context.subscriptions.push(mgr);
    return mgr;
  }

  // ── State ──────────────────────────────────────────────────────────────────
  private _config: GgConfig;
  private readonly _emitter = new vscode.EventEmitter<ConfigChangeEvent>();
  private readonly _disposables: vscode.Disposable[] = [];
  private _updateChecker?: () => Promise<void>;

  // ── Constructor (private — use ConfigManager.create) ──────────────────────
  private constructor(private readonly context: vscode.ExtensionContext) {
    this._config = readConfig();
    this._validateBinaryPath(this._config.binaryPath);

    // Watch for setting changes
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(SECTION)) {
          this._handleConfigChange();
        }
      }),
    );

    // Register Command Palette commands
    this._disposables.push(
      vscode.commands.registerCommand('gg.selectBinaryPath', () =>
        this._cmdSelectBinaryPath(),
      ),
      vscode.commands.registerCommand('gg.checkForUpdates', () =>
        this._cmdCheckForUpdates(),
      ),
      vscode.commands.registerCommand('gg.openSettings', () =>
        vscode.commands.executeCommand('workbench.action.openSettings', '@ext:gopherglide.gg-plugin'),
      ),
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Current cached configuration snapshot. */
  get config(): Readonly<GgConfig> {
    return this._config;
  }

  /**
   * Fired whenever one or more gg.* settings change.
   *
   * @example
   * context.subscriptions.push(
   *   configMgr.onDidChangeConfig(({ config, changedKeys }) => {
   *     if (changedKeys.includes('binaryPath')) { ... }
   *   }),
   * );
   */
  get onDidChangeConfig(): vscode.Event<ConfigChangeEvent> {
    return this._emitter.event;
  }

  /**
   * Allows the Installer (or any other module) to supply the real
   * implementation that backs the `gg.checkForUpdates` command.
   * Must be called before the command is first invoked.
   */
  setUpdateChecker(fn: () => Promise<void>): void {
    this._updateChecker = fn;
  }

  /**
   * Returns the binary path that should be used at runtime.
   *
   * Priority:
   *  1. `gg.binaryPath` (if set and the file exists)
   *  2. `GG_PATH` environment variable
   *  3. Falls back to plain `'gg'` so the OS PATH is searched at exec time.
   */
  get effectiveBinaryPath(): string {
    const override = this._config.binaryPath;
    if (override && fs.existsSync(override)) {
      return override;
    }

    const envPath = process.env['GG_PATH'];
    if (envPath && fs.existsSync(envPath)) {
      return envPath;
    }

    return 'gg'; // resolved by the OS at exec time
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _handleConfigChange(): void {
    const next = readConfig();
    const changed = diffConfig(this._config, next);

    if (changed.length === 0) {
      return;
    }

    this._config = next;

    if (changed.includes('binaryPath')) {
      this._validateBinaryPath(next.binaryPath);
    }

    this._emitter.fire({ config: next, changedKeys: changed });
  }

  /**
   * Warns the user if they set a binaryPath that doesn't exist on disk.
   * Silently passes when the path is empty (auto-resolve mode).
   */
  private _validateBinaryPath(p: string): void {
    if (!p) {
      return;
    }
    if (!fs.existsSync(p)) {
      vscode.window
        .showWarningMessage(
          `Gopher-Glide: The binary path "${p}" does not exist. ` +
            'Please update the gg.binaryPath setting.',
          'Open Settings',
        )
        .then((choice) => {
          if (choice === 'Open Settings') {
            vscode.commands.executeCommand(
              'workbench.action.openSettings',
              'gg.binaryPath',
            );
          }
        });
    }
  }

  // ── Command handlers ───────────────────────────────────────────────────────

  /**
   * Opens a file picker so the user can browse to the gg binary, then
   * persists the selection to the global (user-level) setting.
   */
  private async _cmdSelectBinaryPath(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      title: 'Select the gg binary',
      openLabel: 'Select',
    });

    if (!uris || uris.length === 0) {
      return;
    }

    const chosen = uris[0].fsPath;
    await vscode.workspace
      .getConfiguration(SECTION)
      .update('binaryPath', chosen, vscode.ConfigurationTarget.Global);

    vscode.window.showInformationMessage(
      `Gopher-Glide: Binary path set to "${chosen}".`,
    );
  }

  /**
   * Invokes the real update checker registered via `setUpdateChecker()`.
   * Shows a fallback message when no checker has been registered yet.
   */
  private _cmdCheckForUpdates(): void {
    if (this._updateChecker) {
      this._updateChecker().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Gopher-Glide: Update check failed — ${msg}`);
      });
    } else {
      vscode.window.showInformationMessage(
        'Gopher-Glide: Update check is not yet available.',
      );
    }
  }

  // ── Disposable ─────────────────────────────────────────────────────────────

  dispose(): void {
    this._emitter.dispose();
    this._disposables.forEach((d) => d.dispose());
    this._disposables.length = 0;
    ConfigManager._instance = undefined;
  }
}
