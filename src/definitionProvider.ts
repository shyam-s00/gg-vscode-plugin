import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

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
export function resolveHttpFileFromLine(
  configPath: string,
  lineText: string,
  cursorChar: number,
): string | undefined {
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
export class GgYamlDefinitionProvider implements vscode.DefinitionProvider, vscode.Disposable {
  dispose(): void {
    // No persistent resources.
  }

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Definition | undefined {
    const line = document.lineAt(position).text;
    const resolved = resolveHttpFileFromLine(document.uri.fsPath, line, position.character);
    if (!resolved) {
      return undefined;
    }
    return new vscode.Location(vscode.Uri.file(resolved), new vscode.Position(0, 0));
  }
}
