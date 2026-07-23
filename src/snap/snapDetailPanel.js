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
exports.initSnapDetailPanel = initSnapDetailPanel;
exports.getSnapDetailPanel = getSnapDetailPanel;
const vscode = __importStar(require("vscode"));
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
let _panel;
let _extensionUri;
/** Must be called once during activation, before any snap detail panel is shown. */
function initSnapDetailPanel(extensionUri) {
    _extensionUri = extensionUri;
}
/**
 * Returns the shared detail panel, creating it on first use and re-titling +
 * revealing it on every call thereafter. Callers are responsible for setting
 * `panel.webview.html` themselves (they need the panel's own `webview` — with
 * its per-panel `cspSource` — to build that HTML in the first place).
 */
function getSnapDetailPanel(title) {
    if (_panel) {
        _panel.title = title;
        _panel.reveal(_panel.viewColumn, false);
        return _panel;
    }
    const panel = vscode.window.createWebviewPanel('gg.snapDetail', title, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, { enableScripts: true });
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
//# sourceMappingURL=snapDetailPanel.js.map