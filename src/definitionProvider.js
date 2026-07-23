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
exports.GgYamlDefinitionProvider = void 0;
exports.resolveHttpFileFromLine = resolveHttpFileFromLine;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
// ─────────────────────────────────────────────────────────────────────────────
// Pure resolution logic — exported for direct unit testing, no vscode dep.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Given a `.gg.yaml` line and cursor position, extracts the `httpFile` path
 * value (if the cursor is within it) and returns the resolved absolute path.
 *
 * Handles both quoted (`httpFile: "request.http"`) and bare
 * (`httpFile: request.http`) value styles, and is cursor-aware so
 * Ctrl+Clicking on the key itself (not the value) is a no-op.
 */
function resolveHttpFileFromLine(configPath, lineText, cursorChar) {
    const match = /^\s*httpFile:\s+"?([^"\s]+)"?\s*(?:#.*)?$/.exec(lineText);
    if (!match) {
        return undefined;
    }
    // Guard: cursor must be in the value portion, not on the key itself.
    const valueStart = lineText.indexOf(match[1]);
    if (cursorChar < valueStart) {
        return undefined;
    }
    const resolved = path.resolve(path.dirname(configPath), match[1]);
    return fs.existsSync(resolved) ? resolved : undefined;
}
// ─────────────────────────────────────────────────────────────────────────────
// DefinitionProvider
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Implements Ctrl+Click navigation from the `httpFile:` value in a `*.gg.yaml`
 * config file to the actual `.http` request file it references — parity with
 * the JetBrains plugin's `YamlFileReferenceContributor`.
 *
 * Registered against the "**\/*.gg.yaml" glob pattern (not a language selector)
 * for the same robustness reason as the CodeLens providers.
 */
class GgYamlDefinitionProvider {
    dispose() {
        // No persistent resources.
    }
    provideDefinition(document, position) {
        const line = document.lineAt(position).text;
        const resolved = resolveHttpFileFromLine(document.uri.fsPath, line, position.character);
        if (!resolved) {
            return undefined;
        }
        return new vscode.Location(vscode.Uri.file(resolved), new vscode.Position(0, 0));
    }
}
exports.GgYamlDefinitionProvider = GgYamlDefinitionProvider;
//# sourceMappingURL=definitionProvider.js.map