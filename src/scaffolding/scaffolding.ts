import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { HTTP_FILE_EXTENSIONS } from '../http/httpParser';
import { BUILT_IN_PROFILES, byCategory } from '../profiles/profileCatalog';

// ─────────────────────────────────────────────────────────────────────────────
// Templates — pure functions, exported for testing.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates the content of a new `*.gg.yaml` config file for a given
 * `.http` filename. Mirrors the JetBrains plugin's `GenerateConfigYaml`
 * template exactly so both editors produce the same starting point.
 */
export function generateConfigTemplate(httpFileName: string): string {
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
export function generateHttpTestTemplate(): string {
  const lines: string[] = ['# Gopher-Glide profiles:'];
  for (const [category, profiles] of byCategory(BUILT_IN_PROFILES)) {
    lines.push(`#   ${category}: ${profiles.map((p) => p.name).join(', ')}`);
  }
  lines.push('#', '### Sample Request', 'GET https://example.com/', 'Accept: application/json', '');
  return lines.join('\n');
}

/** The placeholder URL inside the generated HTTP test file. Callers use this to select it after opening. */
export const HTTP_TEMPLATE_PLACEHOLDER_URL = 'https://example.com/';

// ─────────────────────────────────────────────────────────────────────────────
// ScaffoldCommands
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registers `gg.generateConfig` and `gg.newHttpTest`.
 * Neither command depends on the `gg` binary being installed — they're
 * purely file-creation utilities.
 */
export class ScaffoldCommands implements vscode.Disposable {
  private readonly _disposables: vscode.Disposable[] = [];

  constructor() {
    this._disposables.push(
      vscode.commands.registerCommand('gg.generateConfig', (uri?: vscode.Uri) =>
        this._cmdGenerateConfig(uri),
      ),
      vscode.commands.registerCommand('gg.newHttpTest', (uri?: vscode.Uri) =>
        this._cmdNewHttpTest(uri),
      ),
    );
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
    this._disposables.length = 0;
  }

  // ── gg.generateConfig ──────────────────────────────────────────────────────

  private async _cmdGenerateConfig(uri?: vscode.Uri): Promise<void> {
    const httpFile = this._resolveHttpTarget(uri);
    if (!httpFile) {
      vscode.window.showErrorMessage('Gopher-Glide: Open or select a .http file to generate a config for.');
      return;
    }

    const dir = path.dirname(httpFile);
    const destPath = path.join(dir, 'traffic-sim.gg.yaml');

    if (fs.existsSync(destPath)) {
      const choice = await vscode.window.showWarningMessage(
        `Gopher-Glide: traffic-sim.gg.yaml already exists. Overwrite it?`,
        'Overwrite',
        'Cancel',
      );
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

  private async _cmdNewHttpTest(uri?: vscode.Uri): Promise<void> {
    const content = generateHttpTestTemplate();
    const doc = await vscode.workspace.openTextDocument({ content, language: 'http' });
    const editor = await vscode.window.showTextDocument(doc);

    // Select the placeholder URL so the user can type their own immediately.
    const placeholderLine = content.split('\n').findIndex((l) =>
      l.includes(HTTP_TEMPLATE_PLACEHOLDER_URL),
    );
    if (placeholderLine !== -1) {
      const lineText = doc.lineAt(placeholderLine).text;
      const col = lineText.indexOf(HTTP_TEMPLATE_PLACEHOLDER_URL);
      editor.selection = new vscode.Selection(
        placeholderLine,
        col,
        placeholderLine,
        col + HTTP_TEMPLATE_PLACEHOLDER_URL.length,
      );
      editor.revealRange(editor.selection);
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private _resolveHttpTarget(uri?: vscode.Uri): string | undefined {
    const target = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!target) {
      return undefined;
    }
    return HTTP_FILE_EXTENSIONS.has(path.extname(target).toLowerCase()) ? target : undefined;
  }
}
