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
exports.SnapBrowser = exports.SnapTreeItem = exports.SNAP_ITEM_CONTEXT = void 0;
exports.formatSnapDate = formatSnapDate;
const vscode = __importStar(require("vscode"));
const snapAssertPanel_1 = require("./snapAssertPanel");
const snapDataManager_1 = require("./snapDataManager");
const snapDiffPanel_1 = require("./snapDiffPanel");
const snapPrunePanel_1 = require("./snapPrunePanel");
const snapViewPanel_1 = require("./snapViewPanel");
// ─────────────────────────────────────────────────────────────────────────────
// Tree item
// ─────────────────────────────────────────────────────────────────────────────
/** Context value used in `when` clauses (e.g. `viewItem == snapItem`). */
exports.SNAP_ITEM_CONTEXT = 'snapItem';
class SnapTreeItem extends vscode.TreeItem {
    snap;
    constructor(snap) {
        const tag = snap.meta.tag.trim() || '(untagged)';
        super(`#${snap.internalIndex}  ${tag}`, vscode.TreeItemCollapsibleState.None);
        this.snap = snap;
        this.description =
            `${formatSnapDate(snap.meta.start_time)} · ${snap.meta.total_requests.toLocaleString()} req · ${snap.meta.peak_rps} rps`;
        this.tooltip = new vscode.MarkdownString(`**Tag:** ${tag}\n\n` +
            `**Started:** ${snap.meta.start_time}\n\n` +
            `**Ended:** ${snap.meta.end_time}\n\n` +
            `**Total requests:** ${snap.meta.total_requests.toLocaleString()}\n\n` +
            `**Peak RPS:** ${snap.meta.peak_rps}\n\n` +
            `**File:** ${snap.filePath}`);
        this.iconPath = new vscode.ThemeIcon('database');
        this.contextValue = exports.SNAP_ITEM_CONTEXT;
        // Double-click / Enter opens the view panel.
        this.command = { command: 'gg.viewSnap', title: 'View Snapshot', arguments: [this] };
    }
}
exports.SnapTreeItem = SnapTreeItem;
/**
 * Converts an ISO 8601 timestamp to a short, locale-aware display string
 * (e.g. "Jun 30  14:23"). Falls back to the first 16 characters of the
 * raw string if the date cannot be parsed.
 */
function formatSnapDate(isoStr) {
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) {
            return isoStr.slice(0, 16);
        }
        const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        return `${date}  ${time}`;
    }
    catch {
        return isoStr.slice(0, 16);
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Data provider
// ─────────────────────────────────────────────────────────────────────────────
class SnapTreeDataProvider {
    _snaps = [];
    _emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this._emitter.event;
    setSnaps(snaps) {
        this._snaps = snaps;
        this._emitter.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
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
class SnapBrowser {
    configMgr;
    installer;
    _provider = new SnapTreeDataProvider();
    _treeView;
    _disposables = [];
    constructor(configMgr, installer) {
        this.configMgr = configMgr;
        this.installer = installer;
        this._treeView = vscode.window.createTreeView('gg.snapView', {
            treeDataProvider: this._provider,
            canSelectMany: true,
        });
        this._disposables.push(this._treeView, 
        // Track selection count in a context key so toolbar `when` clauses work.
        this._treeView.onDidChangeSelection((e) => {
            void vscode.commands.executeCommand('setContext', SELECTION_COUNT_KEY, e.selection.length);
        }), 
        // Auto-refresh when the Snaps panel becomes visible (first open).
        this._treeView.onDidChangeVisibility((e) => {
            if (e.visible) {
                void this.refresh();
            }
        }), vscode.commands.registerCommand('gg.refreshSnaps', () => this.refresh()), vscode.commands.registerCommand('gg.viewSnap', (item) => this._cmdView(item)), vscode.commands.registerCommand('gg.diffSnaps', () => this._cmdDiff()), vscode.commands.registerCommand('gg.assertSnaps', () => this._cmdAssert()), vscode.commands.registerCommand('gg.pruneSnaps', () => this._cmdPrune()));
        // Initial load (panel may already be visible on startup).
        void this.refresh();
    }
    dispose() {
        this._disposables.forEach((d) => d.dispose());
        this._disposables.length = 0;
    }
    // ── Public helpers (used by later phases to access current selection) ──────
    get selection() {
        return [...this._treeView.selection];
    }
    // ── Refresh ────────────────────────────────────────────────────────────────
    async refresh() {
        const dir = (0, snapDataManager_1.resolveSnapshotsDir)(this.configMgr.config.snapshotsDir);
        const snaps = await (0, snapDataManager_1.loadSnaps)(dir);
        this._provider.setSnaps(snaps);
    }
    // ── Command handlers ───────────────────────────────────────────────────────
    _cmdView(item) {
        const target = item?.snap ?? this.selection[0]?.snap;
        if (!target) {
            vscode.window.showWarningMessage('Gopher-Glide: Select a snapshot to view.');
            return;
        }
        (0, snapViewPanel_1.showSnapView)(target);
    }
    _cmdDiff() {
        const sel = this.selection;
        if (sel.length !== 2) {
            vscode.window.showWarningMessage('Gopher-Glide: Select exactly 2 snapshots to diff.');
            return;
        }
        (0, snapDiffPanel_1.showSnapDiff)(sel[0].snap, sel[1].snap);
    }
    _cmdAssert() {
        const sel = this.selection;
        if (sel.length !== 2) {
            vscode.window.showWarningMessage('Gopher-Glide: Select exactly 2 snapshots to assert.');
            return;
        }
        void (0, snapAssertPanel_1.handleAssert)(this.configMgr, this.installer, sel[0].snap, sel[1].snap);
    }
    _cmdPrune() {
        const dir = (0, snapDataManager_1.resolveSnapshotsDir)(this.configMgr.config.snapshotsDir);
        const prefilledIds = this.selection.length > 0
            ? this.selection.map((item) => String(item.snap.internalIndex)).join(',')
            : undefined;
        void (0, snapPrunePanel_1.handlePrune)(this.configMgr, this.installer, dir, prefilledIds, () => void this.refresh());
    }
}
exports.SnapBrowser = SnapBrowser;
//# sourceMappingURL=snapTreeProvider.js.map