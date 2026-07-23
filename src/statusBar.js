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
exports.StatusBarManager = void 0;
const childProcess = __importStar(require("child_process"));
const vscode = __importStar(require("vscode"));
// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────
function execVersion(binPath) {
    return new Promise((resolve, reject) => childProcess.execFile(binPath, ['--version'], { timeout: 5_000 }, (err, stdout) => err ? reject(err) : resolve(stdout.trim())));
}
/** Extracts a bare semver string (e.g. "1.2.3") from raw version output. */
function parseVersion(raw) {
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
class StatusBarManager {
    configMgr;
    _item;
    _disposables = [];
    constructor(configMgr) {
        this.configMgr = configMgr;
        this._item = vscode.window.createStatusBarItem('gopher-glide.status', vscode.StatusBarAlignment.Right, 
        /* priority */ 500);
        this._item.name = 'Gopher-Glide';
        this._item.show();
        // Show loading immediately — refresh() will update it
        this.setLoading();
        // Auto-refresh whenever the binary path changes
        this._disposables.push(configMgr.onDidChangeConfig(({ changedKeys }) => {
            if (changedKeys.includes('binaryPath')) {
                void this.refresh();
            }
        }));
    }
    // ── Public state setters ──────────────────────────────────────────────────
    /** Shown while an install or update-check is in progress. */
    setLoading() {
        this._item.text = '$(loading~spin) gg';
        this._item.tooltip = 'Gopher-Glide — checking binary…';
        this._item.command = undefined;
        this._item.backgroundColor = undefined;
        this._item.color = undefined;
    }
    /** Shown when the binary is reachable and the version is known. */
    setReady(version) {
        this._item.text = `$(check) gg ${version}`;
        this._item.tooltip = this._readyTooltip(version);
        this._item.command = 'gg.checkForUpdates';
        this._item.backgroundColor = undefined;
        this._item.color = new vscode.ThemeColor('statusBar.foreground');
    }
    /** Shown when the binary can be found on PATH but the version can't be parsed. */
    setUnknownVersion() {
        this._item.text = '$(tools) gg';
        this._item.tooltip = this._readyTooltip('unknown');
        this._item.command = 'gg.checkForUpdates';
        this._item.backgroundColor = undefined;
        this._item.color = undefined;
    }
    /** Shown when the binary is not reachable at all. */
    setNotFound() {
        this._item.text = '$(warning) gg: not found';
        this._item.tooltip = new vscode.MarkdownString('**Gopher-Glide** — `gg` binary not found.\n\n' +
            'Click to trigger auto-install, or set `gg.binaryPath` in Settings.');
        this._item.command = 'gg.checkForUpdates';
        this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this._item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    }
    /** Shown on unexpected errors (e.g. permission denied). */
    setError(message) {
        this._item.text = '$(error) gg: error';
        this._item.tooltip = new vscode.MarkdownString(`**Gopher-Glide** — error detecting \`gg\`:\n\n\`${message}\`\n\n` +
            'Click to open Settings.');
        this._item.command = {
            command: 'workbench.action.openSettings',
            title: 'Open Settings',
            arguments: ['gg.binaryPath'],
        };
        this._item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this._item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
    }
    // ── Public actions ────────────────────────────────────────────────────────
    /**
     * Probes `effectiveBinaryPath`, runs `gg --version`, and updates the item.
     * Safe to call at any time; never throws.
     */
    async refresh() {
        const binPath = this.configMgr.effectiveBinaryPath;
        try {
            const raw = await execVersion(binPath);
            const version = parseVersion(raw);
            if (version) {
                this.setReady(version);
            }
            else {
                this.setUnknownVersion();
            }
        }
        catch (err) {
            // Distinguish "file not found / ENOENT" (binary missing) from other errors
            const code = err.code;
            if (code === 'ENOENT' || code === 'EACCES') {
                this.setNotFound();
            }
            else {
                const msg = err instanceof Error ? err.message : String(err);
                this.setError(msg);
            }
        }
    }
    // ── Disposable ────────────────────────────────────────────────────────────
    dispose() {
        this._item.dispose();
        this._disposables.forEach((d) => d.dispose());
        this._disposables.length = 0;
    }
    // ── Private helpers ───────────────────────────────────────────────────────
    _readyTooltip(version) {
        const md = new vscode.MarkdownString(`**Gopher-Glide** — \`gg ${version}\` is active.\n\n` +
            `Click to check for updates.`);
        md.isTrusted = true;
        return md;
    }
}
exports.StatusBarManager = StatusBarManager;
//# sourceMappingURL=statusBar.js.map