import * as path from 'path';
import * as vscode from 'vscode';

import { findSiblingConfig, isGgConfigFile } from './configParser';
import { HTTP_FILE_EXTENSIONS, parseHttpRequests } from './httpParser';

const DEBOUNCE_MS = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Shared debounced refresh signal
// ─────────────────────────────────────────────────────────────────────────────

/** Fires `onDidChangeCodeLenses` at most once per `debounceMs` of inactivity; `fireNow()` bypasses the debounce for discrete events (file create/delete/rename). */
class DebouncedRefreshEmitter implements vscode.Disposable {
  private readonly _emitter = new vscode.EventEmitter<void>();
  readonly event = this._emitter.event;
  private _timer: NodeJS.Timeout | undefined;

  constructor(private readonly debounceMs: number) {}

  schedule(): void {
    if (this._timer) {
      clearTimeout(this._timer);
    }
    this._timer = setTimeout(() => this._emitter.fire(), this.debounceMs);
  }

  fireNow(): void {
    this._emitter.fire();
  }

  dispose(): void {
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

export class GgHttpCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly _refresh = new DebouncedRefreshEmitter(DEBOUNCE_MS);
  readonly onDidChangeCodeLenses = this._refresh.event;
  private readonly _disposables: vscode.Disposable[] = [this._refresh];

  constructor() {
    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (HTTP_FILE_EXTENSIONS.has(path.extname(e.document.fileName).toLowerCase())) {
          this._refresh.schedule();
        }
      }),
      // A sibling .gg.yaml being created/deleted/renamed changes whether the
      // "Run GG (Config)" lens should appear — no debounce needed, these are
      // already discrete, infrequent events.
      vscode.workspace.onDidCreateFiles(() => this._refresh.fireNow()),
      vscode.workspace.onDidDeleteFiles(() => this._refresh.fireNow()),
      vscode.workspace.onDidRenameFiles(() => this._refresh.fireNow()),
    );
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
    this._disposables.length = 0;
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    const requests = parseHttpRequests(document.getText());
    if (requests.length === 0) {
      return [];
    }

    const siblingConfig = await findSiblingConfig(document.uri.fsPath);

    const lenses: vscode.CodeLens[] = [];
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
    }
    return lenses;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// *.gg.yaml — single "Run GG" CodeLens above the first top-level key.
// ─────────────────────────────────────────────────────────────────────────────

export class GgYamlCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly _refresh = new DebouncedRefreshEmitter(DEBOUNCE_MS);
  readonly onDidChangeCodeLenses = this._refresh.event;
  private readonly _disposables: vscode.Disposable[] = [this._refresh];

  constructor() {
    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (isGgConfigFile(path.basename(e.document.fileName))) {
          this._refresh.schedule();
        }
      }),
    );
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
    this._disposables.length = 0;
  }

  provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): vscode.CodeLens[] {
    const line = findFirstTopLevelKeyLine(document.getText());
    const range = new vscode.Range(line, 0, line, 0);
    return [new vscode.CodeLens(range, {
      title: '▶ Run GG',
      command: 'gg.runConfig',
      arguments: [document.uri],
    })];
  }
}

/**
 * Finds the first top-level (non-indented, non-comment) YAML key line —
 * mirrors the JetBrains plugin's "root-level first YAMLKeyValue" gutter
 * attachment point. Falls back to line 0 for an empty/unrecognized document
 * so the CodeLens always has somewhere to anchor while the file is mid-edit.
 */
export function findFirstTopLevelKeyLine(text: string): number {
  const lines = text.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^[A-Za-z_]/.test(lines[i])) {
      return i;
    }
  }
  return 0;
}
