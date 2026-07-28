import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** Generates a random 32-char nonce for a webview's Content-Security-Policy. */
export function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

/**
 * Reads a panel's colocated `view.html` template. Resolved via `extensionUri`
 * rather than `__dirname` — the extension host is bundled by esbuild into a
 * single `dist/extension.js`, so `__dirname` at runtime is just `dist/`, not
 * the original per-module `src/<relDir>/` location. `relDir` must match the
 * panel's folder path under `src/` (e.g. 'snap/diff'), same as
 * `resolveAssetUris`.
 */
export function readTemplate(extensionUri: vscode.Uri, relDir: string, fileName: string): string {
  return fs.readFileSync(path.join(extensionUri.fsPath, 'dist', relDir, fileName), 'utf8');
}

export interface WebviewAssetUris {
  css: vscode.Uri;
  js?: vscode.Uri;
}

/**
 * Resolves a panel's colocated `style.css` (and optionally `client.js`) into
 * webview-safe URIs. `relDir` must match the panel's folder path under
 * `src/` (e.g. 'snap/diff') — the esbuild webview build and the asset-copy
 * step both preserve that layout under `dist/`.
 */
export function resolveAssetUris(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  relDir: string,
  hasScript: boolean,
): WebviewAssetUris {
  const css = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'dist', relDir, 'style.css'),
  );
  const js = hasScript
    ? webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', relDir, 'client.js'),
    )
    : undefined;
  return { css, js };
}
