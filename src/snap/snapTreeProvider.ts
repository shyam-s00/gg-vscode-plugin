import * as vscode from 'vscode';

import type { ConfigManager } from '../config/config';
import type { Installer } from '../installer/installer';
import { handleAssert } from './assert/panel';
import { loadSnaps, resolveSnapshotsDir } from './snapDataManager';
import { showSnapDiff } from './diff/panel';
import { handlePrune } from './prune/panel';
import { showSnapView } from './view/panel';
import type { LoadedSnap } from './snapModel';

// ─────────────────────────────────────────────────────────────────────────────
// Tree item
// ─────────────────────────────────────────────────────────────────────────────

/** Context value used in `when` clauses (e.g. `viewItem == snapItem`). */
export const SNAP_ITEM_CONTEXT = 'snapItem';

export class SnapTreeItem extends vscode.TreeItem {
  constructor(readonly snap: LoadedSnap) {
    const tag = snap.meta.tag.trim() || '(untagged)';
    super(`#${snap.internalIndex}  ${tag}`, vscode.TreeItemCollapsibleState.None);

    this.description =
      `${formatSnapDate(snap.meta.start_time)} · ${snap.meta.total_requests.toLocaleString()} req · ${snap.meta.peak_rps} rps`;

    this.tooltip = new vscode.MarkdownString(
      `**Tag:** ${tag}\n\n` +
      `**Started:** ${snap.meta.start_time}\n\n` +
      `**Ended:** ${snap.meta.end_time}\n\n` +
      `**Total requests:** ${snap.meta.total_requests.toLocaleString()}\n\n` +
      `**Peak RPS:** ${snap.meta.peak_rps}\n\n` +
      `**File:** ${snap.filePath}`,
    );

    this.iconPath = new vscode.ThemeIcon('database');
    this.contextValue = SNAP_ITEM_CONTEXT;

    // Double-click / Enter opens the view panel.
    this.command = { command: 'gg.viewSnap', title: 'View Snapshot', arguments: [this] };
  }
}

/**
 * Converts an ISO 8601 timestamp to a short, locale-aware display string
 * (e.g. "Jun 30  14:23"). Falls back to the first 16 characters of the
 * raw string if the date cannot be parsed.
 */
export function formatSnapDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) {
      return isoStr.slice(0, 16);
    }
    const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${date}  ${time}`;
  } catch {
    return isoStr.slice(0, 16);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Data provider
// ─────────────────────────────────────────────────────────────────────────────

class SnapTreeDataProvider implements vscode.TreeDataProvider<SnapTreeItem> {
  private _snaps: LoadedSnap[] = [];
  private readonly _emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._emitter.event;

  setSnaps(snaps: LoadedSnap[]): void {
    this._snaps = snaps;
    this._emitter.fire();
  }

  getTreeItem(element: SnapTreeItem): SnapTreeItem {
    return element;
  }

  getChildren(element?: SnapTreeItem): SnapTreeItem[] {
    if (element) {
      return [];
    }
    return this._snaps.map((s) => new SnapTreeItem(s));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SnapBrowser — owns the TreeView, context key, and all gg.snap* commands
// ─────────────────────────────────────────────────────────────────────────────

/** Context key updated on selection change; used in toolbar `when` clauses. */
const SELECTION_COUNT_KEY = 'gg.snapSelectionCount';

/**
 * Manages the "Snaps" section in the Gopher-Glide bottom panel:
 * the snap list TreeView, its toolbar, and all `gg.snap*` command handlers.
 *
 * View/diff/assert/prune handlers validate selection and show placeholder
 * feedback until their full Webview UIs are implemented.
 */
export class SnapBrowser implements vscode.Disposable {
  private readonly _provider = new SnapTreeDataProvider();
  private readonly _treeView: vscode.TreeView<SnapTreeItem>;
  private readonly _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly configMgr: ConfigManager,
    private readonly installer: Installer,
  ) {
    this._treeView = vscode.window.createTreeView('gg.snapView', {
      treeDataProvider: this._provider,
      canSelectMany: true,
    });

    this._disposables.push(
      this._treeView,

      // Track selection count in a context key so toolbar `when` clauses work.
      this._treeView.onDidChangeSelection((e) => {
        void vscode.commands.executeCommand('setContext', SELECTION_COUNT_KEY, e.selection.length);
      }),

      // Auto-refresh when the Snaps panel becomes visible (first open).
      this._treeView.onDidChangeVisibility((e) => {
        if (e.visible) {
          void this.refresh();
        }
      }),

      vscode.commands.registerCommand('gg.refreshSnaps', () => this.refresh()),
      vscode.commands.registerCommand('gg.viewSnap', (item?: SnapTreeItem) => this._cmdView(item)),
      vscode.commands.registerCommand('gg.diffSnaps', () => this._cmdDiff()),
      vscode.commands.registerCommand('gg.assertSnaps', () => this._cmdAssert()),
      vscode.commands.registerCommand('gg.pruneSnaps', () => this._cmdPrune()),
    );

    // Initial load (panel may already be visible on startup).
    void this.refresh();
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
    this._disposables.length = 0;
  }

  // ── Public helpers (used by later phases to access current selection) ──────

  get selection(): SnapTreeItem[] {
    return [...this._treeView.selection];
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  async refresh(): Promise<void> {
    const dir = resolveSnapshotsDir(this.configMgr.config.snapshotsDir);
    const snaps = await loadSnaps(dir);
    this._provider.setSnaps(snaps);
  }

  // ── Command handlers ───────────────────────────────────────────────────────

  private _cmdView(item?: SnapTreeItem): void {
    const target = item?.snap ?? this.selection[0]?.snap;
    if (!target) {
      vscode.window.showWarningMessage('Gopher-Glide: Select a snapshot to view.');
      return;
    }
    showSnapView(target);
  }

  private _cmdDiff(): void {
    const sel = this.selection;
    if (sel.length !== 2) {
      vscode.window.showWarningMessage('Gopher-Glide: Select exactly 2 snapshots to diff.');
      return;
    }
    showSnapDiff(sel[0].snap, sel[1].snap);
  }

  private _cmdAssert(): void {
    const sel = this.selection;
    if (sel.length !== 2) {
      vscode.window.showWarningMessage('Gopher-Glide: Select exactly 2 snapshots to assert.');
      return;
    }
    void handleAssert(this.configMgr, this.installer, sel[0].snap, sel[1].snap);
  }

  private _cmdPrune(): void {
    const dir = resolveSnapshotsDir(this.configMgr.config.snapshotsDir);
    const prefilledIds = this.selection.length > 0
      ? this.selection.map((item) => String(item.snap.internalIndex)).join(',')
      : undefined;
    void handlePrune(this.configMgr, this.installer, dir, prefilledIds, () => void this.refresh());
  }
}
