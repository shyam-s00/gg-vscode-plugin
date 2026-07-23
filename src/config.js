"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigManager = void 0;
const fs = __importStar(require("fs"));
const vscode = __importStar(require("vscode"));
// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────
const SECTION = 'gg';
/** Read all gg.* settings from VS Code's configuration API. */
function readConfig(scope) {
    const c = vscode.workspace.getConfiguration(SECTION, scope ?? null);
    return {
        binaryPath: c.get('binaryPath', '').trim(),
        autoUpdateCheck: c.get('autoUpdateCheck', true),
        installationMode: c.get('installationMode', 'auto'),
        defaultProfile: c.get('defaultProfile', '').trim(),
        snapshotsDir: c.get('snapshotsDir', '').trim(),
        heartbeatIntervalSeconds: c.get('heartbeatIntervalSeconds', 0),
    };
}
/** Returns the keys whose values differ between two config snapshots. */
function diffConfig(a, b) {
    return Object.keys(a).filter((k) => a[k] !== b[k]);
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
class ConfigManager {
    context;
    // ── Singleton ──────────────────────────────────────────────────────────────
    static _instance;
    static getInstance() {
        if (!ConfigManager._instance) {
            throw new Error('ConfigManager has not been initialized. Call ConfigManager.create() first.');
        }
        return ConfigManager._instance;
    }
    /**
     * Creates the singleton, registers commands and the config-change listener,
     * and pushes everything onto `context.subscriptions`.
     */
    static create(context) {
        if (ConfigManager._instance) {
            return ConfigManager._instance;
        }
        const mgr = new ConfigManager(context);
        ConfigManager._instance = mgr;
        context.subscriptions.push(mgr);
        return mgr;
    }
    // ── State ──────────────────────────────────────────────────────────────────
    _config;
    _emitter = new vscode.EventEmitter();
    _disposables = [];
    _updateChecker;
    // ── Constructor (private — use ConfigManager.create) ──────────────────────
    constructor(context) {
        this.context = context;
        this._config = readConfig();
        this._validateBinaryPath(this._config.binaryPath);
        // Watch for setting changes
        this._disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(SECTION)) {
                this._handleConfigChange();
            }
        }));
        // Register Command Palette commands
        this._disposables.push(vscode.commands.registerCommand('gg.selectBinaryPath', () => this._cmdSelectBinaryPath()), vscode.commands.registerCommand('gg.checkForUpdates', () => this._cmdCheckForUpdates()), vscode.commands.registerCommand('gg.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:gopherglide.gg-plugin')));
    }
    // ── Public API ─────────────────────────────────────────────────────────────
    /** Current cached configuration snapshot. */
    get config() {
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
    get onDidChangeConfig() {
        return this._emitter.event;
    }
    /**
     * Allows the Installer (or any other module) to supply the real
     * implementation that backs the `gg.checkForUpdates` command.
     * Must be called before the command is first invoked.
     */
    setUpdateChecker(fn) {
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
    get effectiveBinaryPath() {
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
    _handleConfigChange() {
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
    _validateBinaryPath(p) {
        if (!p) {
            return;
        }
        if (!fs.existsSync(p)) {
            vscode.window
                .showWarningMessage(`Gopher-Glide: The binary path "${p}" does not exist. ` +
                'Please update the gg.binaryPath setting.', 'Open Settings')
                .then((choice) => {
                if (choice === 'Open Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'gg.binaryPath');
                }
            });
        }
    }
    // ── Command handlers ───────────────────────────────────────────────────────
    /**
     * Opens a file picker so the user can browse to the gg binary, then
     * persists the selection to the global (user-level) setting.
     */
    async _cmdSelectBinaryPath() {
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
        vscode.window.showInformationMessage(`Gopher-Glide: Binary path set to "${chosen}".`);
    }
    /**
     * Invokes the real update checker registered via `setUpdateChecker()`.
     * Shows a fallback message when no checker has been registered yet.
     */
    _cmdCheckForUpdates() {
        if (this._updateChecker) {
            this._updateChecker().catch((err) => {
                const msg = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Gopher-Glide: Update check failed — ${msg}`);
            });
        }
        else {
            vscode.window.showInformationMessage('Gopher-Glide: Update check is not yet available.');
        }
    }
    // ── Disposable ─────────────────────────────────────────────────────────────
    dispose() {
        this._emitter.dispose();
        this._disposables.forEach((d) => d.dispose());
        this._disposables.length = 0;
        ConfigManager._instance = undefined;
    }
}
exports.ConfigManager = ConfigManager;
//# sourceMappingURL=config.js.map