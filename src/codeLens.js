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
exports.GgYamlCodeLensProvider = exports.GgHttpCodeLensProvider = void 0;
exports.findFirstTopLevelKeyLine = findFirstTopLevelKeyLine;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const configParser_1 = require("./configParser");
const httpParser_1 = require("./httpParser");
const DEBOUNCE_MS = 300;
// ─────────────────────────────────────────────────────────────────────────────
// Shared debounced refresh signal
// ─────────────────────────────────────────────────────────────────────────────
/** Fires `onDidChangeCodeLenses` at most once per `debounceMs` of inactivity; `fireNow()` bypasses the debounce for discrete events (file create/delete/rename). */
class DebouncedRefreshEmitter {
    debounceMs;
    _emitter = new vscode.EventEmitter();
    event = this._emitter.event;
    _timer;
    constructor(debounceMs) {
        this.debounceMs = debounceMs;
    }
    schedule() {
        if (this._timer) {
            clearTimeout(this._timer);
        }
        this._timer = setTimeout(() => this._emitter.fire(), this.debounceMs);
    }
    fireNow() {
        this._emitter.fire();
    }
    dispose() {
        if (this._timer) {
            clearTimeout(this._timer);
        }
        this._emitter.dispose();
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// .http / .rest — one "Run GG" CodeLens per request block (always file-level —
// gg has no per-request run, see vscode-extension-plan.md ground truth), plus
// a "Run GG (Config)" CodeLens on every request when a sibling `.gg.yaml`
// exists. Registered against a glob pattern, not a `language` selector, so it
// works whether or not some other extension has claimed an "http" language id.
// ─────────────────────────────────────────────────────────────────────────────
class GgHttpCodeLensProvider {
    _refresh = new DebouncedRefreshEmitter(DEBOUNCE_MS);
    onDidChangeCodeLenses = this._refresh.event;
    _disposables = [this._refresh];
    constructor() {
        this._disposables.push(vscode.workspace.onDidChangeTextDocument((e) => {
            if (httpParser_1.HTTP_FILE_EXTENSIONS.has(path.extname(e.document.fileName).toLowerCase())) {
                this._refresh.schedule();
            }
        }), 
        // A sibling .gg.yaml being created/deleted/renamed changes whether the
        // "Run GG (Config)" lens should appear — no debounce needed, these are
        // already discrete, infrequent events.
        vscode.workspace.onDidCreateFiles(() => this._refresh.fireNow()), vscode.workspace.onDidDeleteFiles(() => this._refresh.fireNow()), vscode.workspace.onDidRenameFiles(() => this._refresh.fireNow()));
    }
    dispose() {
        this._disposables.forEach((d) => d.dispose());
        this._disposables.length = 0;
    }
    async provideCodeLenses(document, _token) {
        const requests = (0, httpParser_1.parseHttpRequests)(document.getText());
        if (requests.length === 0) {
            return [];
        }
        const siblingConfig = await (0, configParser_1.findSiblingConfig)(document.uri.fsPath);
        const lenses = [];
        for (const request of requests) {
            const range = new vscode.Range(request.requestLine, 0, request.requestLine, 0);
            lenses.push(new vscode.CodeLens(range, {
                title: '▶ Run GG',
                command: 'gg.run',
                arguments: [document.uri],
            }));
            if (siblingConfig) {
                lenses.push(new vscode.CodeLens(range, {
                    title: '▶ Run GG (Config)',
                    command: 'gg.runConfig',
                    arguments: [document.uri],
                }));
            }
            else {
                lenses.push(new vscode.CodeLens(range, {
                    title: '⚙ Generate Config',
                    command: 'gg.generateConfig',
                    arguments: [document.uri],
                }));
            }
        }
        return lenses;
    }
}
exports.GgHttpCodeLensProvider = GgHttpCodeLensProvider;
// ─────────────────────────────────────────────────────────────────────────────
// *.gg.yaml — single "Run GG" CodeLens above the first top-level key.
// ─────────────────────────────────────────────────────────────────────────────
class GgYamlCodeLensProvider {
    _refresh = new DebouncedRefreshEmitter(DEBOUNCE_MS);
    onDidChangeCodeLenses = this._refresh.event;
    _disposables = [this._refresh];
    constructor() {
        this._disposables.push(vscode.workspace.onDidChangeTextDocument((e) => {
            if ((0, configParser_1.isGgConfigFile)(path.basename(e.document.fileName))) {
                this._refresh.schedule();
            }
        }));
    }
    dispose() {
        this._disposables.forEach((d) => d.dispose());
        this._disposables.length = 0;
    }
    provideCodeLenses(document, _token) {
        const line = findFirstTopLevelKeyLine(document.getText());
        const range = new vscode.Range(line, 0, line, 0);
        return [new vscode.CodeLens(range, {
                title: '▶ Run GG',
                command: 'gg.runConfig',
                arguments: [document.uri],
            })];
    }
}
exports.GgYamlCodeLensProvider = GgYamlCodeLensProvider;
/**
 * Finds the first top-level (non-indented, non-comment) YAML key line —
 * mirrors the JetBrains plugin's "root-level first YAMLKeyValue" gutter
 * attachment point. Falls back to line 0 for an empty/unrecognized document
 * so the CodeLens always has somewhere to anchor while the file is mid-edit.
 */
function findFirstTopLevelKeyLine(text) {
    const lines = text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
        if (/^[A-Za-z_]/.test(lines[i])) {
            return i;
        }
    }
    return 0;
}
//# sourceMappingURL=codeLens.js.map