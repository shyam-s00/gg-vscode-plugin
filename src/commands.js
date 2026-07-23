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
exports.RunCommands = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const configParser_1 = require("./configParser");
const httpParser_1 = require("./httpParser");
const profileCatalog_1 = require("./profileCatalog");
const runArgs_1 = require("./runArgs");
const LAST_PROFILE_KEY = 'gg.lastProfile';
const DURATION_RE = /^(\d+(h|m|s|ms))+$/;
/** Backs the `gg.hasSiblingConfig` "when" clause for the `gg.runConfig` context-menu entry on .http/.rest files. */
const HAS_SIBLING_CONFIG_CONTEXT_KEY = 'gg.hasSiblingConfig';
// ─────────────────────────────────────────────────────────────────────────────
// RunCommands
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Registers `gg.run` and `gg.runConfig` and drives the UX flow for each:
 * profile picking (with category grouping + last-used memory), peak RPS /
 * duration overrides, and the snap checkbox+tag prompt — then hands off to
 * `GgRunner` to actually run `gg` headlessly.
 *
 * Live progress (status, metrics, charts) is rendered by `RunPanel`, which
 * subscribes to `GgRunner` directly and needs no wiring here. The Output
 * Channel below is just an `$ gg ...` transparency log of what was invoked.
 */
class RunCommands {
    context;
    configMgr;
    installer;
    runner;
    _disposables = [];
    _output;
    constructor(context, configMgr, installer, runner) {
        this.context = context;
        this.configMgr = configMgr;
        this.installer = installer;
        this.runner = runner;
        this._output = vscode.window.createOutputChannel('Gopher-Glide');
        this._disposables.push(this._output, vscode.commands.registerCommand('gg.run', (uri) => this._cmdRun(uri)), vscode.commands.registerCommand('gg.runConfig', (uri) => this._cmdRunConfig(uri)), vscode.commands.registerCommand('gg.copyCommand', (uri) => this._cmdCopyCommand(uri)), vscode.window.onDidChangeActiveTextEditor(() => this._updateContextKeys()), vscode.workspace.onDidCreateFiles(() => this._updateContextKeys()), vscode.workspace.onDidDeleteFiles(() => this._updateContextKeys()), vscode.workspace.onDidRenameFiles(() => this._updateContextKeys()));
        void this._updateContextKeys();
    }
    dispose() {
        this._disposables.forEach((d) => d.dispose());
        this._disposables.length = 0;
    }
    // ── gg.run / gg.copyCommand — profile-driven run for a .http file ─────────
    // Both share the same prompt flow (profile, RPS/duration overrides, snap);
    // they only differ in what happens with the resulting command.
    async _cmdRun(uri) {
        const prepared = await this._prepareProfileRun(uri);
        if (!prepared) {
            return;
        }
        this._runHeadless(prepared.binPath, prepared.args);
    }
    async _cmdCopyCommand(uri) {
        const prepared = await this._prepareProfileRun(uri);
        if (!prepared) {
            return;
        }
        await vscode.env.clipboard.writeText([prepared.binPath, ...prepared.args].join(' '));
        vscode.window.showInformationMessage('Gopher-Glide: Command copied to clipboard.');
    }
    async _prepareProfileRun(uri) {
        const httpFile = this._resolveHttpFileTarget(uri);
        if (!httpFile) {
            vscode.window.showErrorMessage('Gopher-Glide: Open or select a .http file to run.');
            return undefined;
        }
        await this.installer.ensureInstalled();
        const binPath = this.configMgr.effectiveBinaryPath;
        const customProfiles = await (0, profileCatalog_1.loadCustomProfiles)(binPath);
        const allProfiles = [...profileCatalog_1.BUILT_IN_PROFILES, ...customProfiles];
        const lastProfile = this.context.workspaceState.get(LAST_PROFILE_KEY);
        const defaultProfileName = lastProfile ?? (this.configMgr.config.defaultProfile || undefined);
        const profile = await pickProfile(allProfiles, defaultProfileName);
        if (!profile) {
            return undefined;
        }
        const rpsResult = await promptPeakRpsOverride(profile);
        if (rpsResult.cancelled) {
            return undefined;
        }
        const durationResult = await promptDurationOverride(profile);
        if (durationResult.cancelled) {
            return undefined;
        }
        const snap = await promptSnapOptions();
        if (!snap) {
            return undefined;
        }
        await this.context.workspaceState.update(LAST_PROFILE_KEY, profile.name);
        const args = (0, runArgs_1.buildProfileRunArgs)({
            profileName: profile.name,
            httpFilePath: httpFile,
            peakRps: rpsResult.value,
            duration: durationResult.value,
            snap,
            heartbeatIntervalSeconds: this.configMgr.config.heartbeatIntervalSeconds,
        });
        return { binPath, args };
    }
    // ── gg.runConfig — config-driven run for a .gg.yaml (or .http w/ sibling) ──
    async _cmdRunConfig(uri) {
        const configPath = await this._resolveConfigTarget(uri);
        if (!configPath) {
            vscode.window.showErrorMessage('Gopher-Glide: No valid .gg.yaml config found (directly, or as a sibling of this .http file).');
            return;
        }
        await this.installer.ensureInstalled();
        const binPath = this.configMgr.effectiveBinaryPath;
        const snap = await promptSnapOptions();
        if (!snap) {
            return;
        }
        const args = (0, runArgs_1.buildConfigRunArgs)({
            configPath,
            snap,
            heartbeatIntervalSeconds: this.configMgr.config.heartbeatIntervalSeconds,
        });
        this._runHeadless(binPath, args);
    }
    // ── Context keys (gate the gg.runConfig context-menu entry) ───────────────
    /**
     * Sets `gg.hasSiblingConfig` so the right-click "Run GG (Config)" entry
     * only appears on `.http`/`.rest` files when a sibling `.gg.yaml` actually
     * exists — `.gg.yaml` files themselves are gated by filename in the "when"
     * clause instead, so they don't need this key.
     */
    async _updateContextKeys() {
        const target = vscode.window.activeTextEditor?.document.uri.fsPath;
        const isHttpFile = !!target && httpParser_1.HTTP_FILE_EXTENSIONS.has(path.extname(target).toLowerCase());
        const hasSiblingConfig = isHttpFile && !!(await (0, configParser_1.findSiblingConfig)(target));
        await vscode.commands.executeCommand('setContext', HAS_SIBLING_CONFIG_CONTEXT_KEY, hasSiblingConfig);
    }
    // ── Target resolution ──────────────────────────────────────────────────────
    _resolveHttpFileTarget(uri) {
        const target = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
        if (!target) {
            return undefined;
        }
        return httpParser_1.HTTP_FILE_EXTENSIONS.has(path.extname(target).toLowerCase()) ? target : undefined;
    }
    /** Resolves a `.gg.yaml` directly, or via a sibling lookup from a `.http` file — and validates it parses. */
    async _resolveConfigTarget(uri) {
        const target = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
        if (!target) {
            return undefined;
        }
        let configPath;
        if ((0, configParser_1.isGgConfigFile)(path.basename(target))) {
            configPath = target;
        }
        else if (httpParser_1.HTTP_FILE_EXTENSIONS.has(path.extname(target).toLowerCase())) {
            configPath = await (0, configParser_1.findSiblingConfig)(target);
        }
        if (!configPath) {
            return undefined;
        }
        const text = await fs.promises.readFile(configPath, 'utf-8').catch(() => undefined);
        return text !== undefined && (0, configParser_1.parseGgConfig)(text) ? configPath : undefined;
    }
    // ── Execution ──────────────────────────────────────────────────────────────
    _runHeadless(binPath, args) {
        this._output.appendLine(`$ ${binPath} ${args.join(' ')}`);
        this.runner.start(binPath, args);
    }
}
exports.RunCommands = RunCommands;
/** Category-grouped QuickPick over `profiles`, pre-highlighting `defaultProfileName` if present. */
function pickProfile(profiles, defaultProfileName) {
    const items = [];
    for (const [category, list] of (0, profileCatalog_1.byCategory)(profiles)) {
        items.push({ label: category, kind: vscode.QuickPickItemKind.Separator });
        for (const profile of list) {
            items.push({
                label: profile.name,
                description: `${profile.defaultPeakRps} rps · ${profile.defaultDuration}`,
                detail: profile.description,
                profile,
            });
        }
    }
    const qp = vscode.window.createQuickPick();
    qp.title = 'Gopher-Glide: Select a profile';
    qp.items = items;
    qp.ignoreFocusOut = true;
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    if (defaultProfileName) {
        const defaultItem = items.find((i) => i.profile?.name === defaultProfileName);
        if (defaultItem) {
            qp.activeItems = [defaultItem];
        }
    }
    return new Promise((resolve) => {
        qp.onDidAccept(() => {
            const selected = qp.selectedItems[0];
            qp.hide();
            resolve(selected?.profile);
        });
        qp.onDidHide(() => {
            qp.dispose();
            resolve(undefined);
        });
        qp.show();
    });
}
async function promptPeakRpsOverride(profile) {
    const raw = await vscode.window.showInputBox({
        title: 'Gopher-Glide: Peak RPS override (optional)',
        prompt: `Leave empty to use ${profile.name}'s default (${profile.defaultPeakRps} rps)`,
        placeHolder: String(profile.defaultPeakRps),
        ignoreFocusOut: true,
        validateInput: (value) => (!value.trim() || /^\d+$/.test(value.trim())
            ? undefined
            : 'Enter a positive integer, or leave empty'),
    });
    if (raw === undefined) {
        return { cancelled: true };
    }
    const trimmed = raw.trim();
    return { cancelled: false, value: trimmed ? parseInt(trimmed, 10) : undefined };
}
async function promptDurationOverride(profile) {
    const raw = await vscode.window.showInputBox({
        title: 'Gopher-Glide: Duration override (optional)',
        prompt: `Leave empty to use ${profile.name}'s default (${profile.defaultDuration}). Examples: 30s, 2m, 1h30m`,
        placeHolder: profile.defaultDuration,
        ignoreFocusOut: true,
        validateInput: (value) => (!value.trim() || DURATION_RE.test(value.trim())
            ? undefined
            : 'Enter a Go-style duration (e.g. 30s, 2m, 1h30m), or leave empty'),
    });
    if (raw === undefined) {
        return { cancelled: true };
    }
    const trimmed = raw.trim();
    return { cancelled: false, value: trimmed || undefined };
}
/** Returns `undefined` if the user cancelled the flow at any point. */
async function promptSnapOptions() {
    const choice = await vscode.window.showQuickPick([
        { label: 'No', picked: true, description: 'Run without capturing a snapshot' },
        { label: 'Yes', description: 'Capture a snapshot after this run (--snap)' },
    ], { title: 'Gopher-Glide: Capture a snapshot after this run?', ignoreFocusOut: true });
    if (!choice) {
        return undefined;
    }
    if (choice.label === 'No') {
        return { enabled: false };
    }
    const tag = await vscode.window.showInputBox({
        title: 'Gopher-Glide: Snapshot tag (optional)',
        prompt: "Leave empty to use gg's default tag",
        ignoreFocusOut: true,
    });
    if (tag === undefined) {
        return undefined;
    }
    return { enabled: true, tag: tag.trim() || undefined };
}
//# sourceMappingURL=commands.js.map