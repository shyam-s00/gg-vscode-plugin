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
exports.ScaffoldCommands = exports.HTTP_TEMPLATE_PLACEHOLDER_URL = void 0;
exports.generateConfigTemplate = generateConfigTemplate;
exports.generateHttpTestTemplate = generateHttpTestTemplate;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const httpParser_1 = require("./httpParser");
const profileCatalog_1 = require("./profileCatalog");
// ─────────────────────────────────────────────────────────────────────────────
// Templates — pure functions, exported for testing.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Generates the content of a new `*.gg.yaml` config file for a given
 * `.http` filename. Mirrors the JetBrains plugin's `GenerateConfigYaml`
 * template exactly so both editors produce the same starting point.
 */
function generateConfigTemplate(httpFileName) {
    return [
        'config:',
        `  httpFile: "${httpFileName}"`,
        '  prometheus: false',
        '  breaker_threshold_pct: 20.0',
        '  jitter: 0.1',
        '  time_scale: 1.0',
        'stages:',
        '  - name: "Ramp-up"',
        '    duration: 10s',
        '    target_rps: 50',
        '',
    ].join('\n');
}
/**
 * Generates the content of a new `.http` test file with a sample request and
 * a header comment listing all built-in profiles grouped by category —
 * mirroring the JetBrains plugin's `CreateGopherGlideTestAction`.
 */
function generateHttpTestTemplate() {
    const lines = ['# Gopher-Glide profiles:'];
    for (const [category, profiles] of (0, profileCatalog_1.byCategory)(profileCatalog_1.BUILT_IN_PROFILES)) {
        lines.push(`#   ${category}: ${profiles.map((p) => p.name).join(', ')}`);
    }
    lines.push('#', '### Sample Request', 'GET https://example.com/', 'Accept: application/json', '');
    return lines.join('\n');
}
/** The placeholder URL inside the generated HTTP test file. Callers use this to select it after opening. */
exports.HTTP_TEMPLATE_PLACEHOLDER_URL = 'https://example.com/';
// ─────────────────────────────────────────────────────────────────────────────
// ScaffoldCommands
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Registers `gg.generateConfig` and `gg.newHttpTest`.
 * Neither command depends on the `gg` binary being installed — they're
 * purely file-creation utilities.
 */
class ScaffoldCommands {
    _disposables = [];
    constructor() {
        this._disposables.push(vscode.commands.registerCommand('gg.generateConfig', (uri) => this._cmdGenerateConfig(uri)), vscode.commands.registerCommand('gg.newHttpTest', (uri) => this._cmdNewHttpTest(uri)));
    }
    dispose() {
        this._disposables.forEach((d) => d.dispose());
        this._disposables.length = 0;
    }
    // ── gg.generateConfig ──────────────────────────────────────────────────────
    async _cmdGenerateConfig(uri) {
        const httpFile = this._resolveHttpTarget(uri);
        if (!httpFile) {
            vscode.window.showErrorMessage('Gopher-Glide: Open or select a .http file to generate a config for.');
            return;
        }
        const dir = path.dirname(httpFile);
        const destPath = path.join(dir, 'traffic-sim.gg.yaml');
        if (fs.existsSync(destPath)) {
            const choice = await vscode.window.showWarningMessage(`Gopher-Glide: traffic-sim.gg.yaml already exists. Overwrite it?`, 'Overwrite', 'Cancel');
            if (choice !== 'Overwrite') {
                return;
            }
        }
        const content = generateConfigTemplate(path.basename(httpFile));
        await fs.promises.writeFile(destPath, content, 'utf-8');
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(destPath));
        await vscode.window.showTextDocument(doc);
    }
    // ── gg.newHttpTest ──────────────────────────────────────────────────────────
    async _cmdNewHttpTest(uri) {
        const content = generateHttpTestTemplate();
        const doc = await vscode.workspace.openTextDocument({ content, language: 'http' });
        const editor = await vscode.window.showTextDocument(doc);
        // Select the placeholder URL so the user can type their own immediately.
        const placeholderLine = content.split('\n').findIndex((l) => l.includes(exports.HTTP_TEMPLATE_PLACEHOLDER_URL));
        if (placeholderLine !== -1) {
            const lineText = doc.lineAt(placeholderLine).text;
            const col = lineText.indexOf(exports.HTTP_TEMPLATE_PLACEHOLDER_URL);
            editor.selection = new vscode.Selection(placeholderLine, col, placeholderLine, col + exports.HTTP_TEMPLATE_PLACEHOLDER_URL.length);
            editor.revealRange(editor.selection);
        }
    }
    // ── helpers ────────────────────────────────────────────────────────────────
    _resolveHttpTarget(uri) {
        const target = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
        if (!target) {
            return undefined;
        }
        return httpParser_1.HTTP_FILE_EXTENSIONS.has(path.extname(target).toLowerCase()) ? target : undefined;
    }
}
exports.ScaffoldCommands = ScaffoldCommands;
//# sourceMappingURL=scaffolding.js.map