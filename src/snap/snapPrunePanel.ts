import * as vscode from 'vscode';

import type { ConfigManager } from '../config/config';
import type { Installer } from '../installer/installer';
import { runSnapCommand } from './snapCliRunner';
import { getSnapDetailPanel } from './snapDetailPanel';

// ─────────────────────────────────────────────────────────────────────────────
// Types — exported for testing
// ─────────────────────────────────────────────────────────────────────────────

export interface PruneOptions {
  /** Comma-separated internalIndex IDs (e.g. "1,3,5"). */
  ids?: string;
  /** Keep the N most-recent snapshots; delete the rest. */
  keepLast?: number;
  /** Delete snapshots older than this duration (e.g. "30d", "7d", "2w"). */
  olderThan?: string;
  /** Delete only snapshots with this exact tag. */
  tag?: string;
  /** When true, preview candidates without deleting (default: true). */
  dryRun: boolean;
}

export interface PruneCandidate {
  id?: number;
  tag?: string;
  date?: string;
  file?: string;
  reason?: string;
}

export interface PruneResult {
  dry_run: boolean;
  snap_dir?: string;
  candidates: PruneCandidate[];
  deleted: number;
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers — exported for testing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses the JSON stdout of `gg snap prune --reporter json`.
 * Returns `undefined` when stdout is empty, not valid JSON, or the shape
 * doesn't look like a prune report (no `deleted` count field).
 */
export function parsePruneResult(stdout: string): PruneResult | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.deleted !== 'number') {
      return undefined;
    }
    return {
      dry_run: parsed.dry_run === true,
      snap_dir: typeof parsed.snap_dir === 'string' ? parsed.snap_dir : undefined,
      candidates: Array.isArray(parsed.candidates) ? (parsed.candidates as PruneCandidate[]) : [],
      deleted: parsed.deleted as number,
      errors: Array.isArray(parsed.errors) ? (parsed.errors as string[]) : [],
    };
  } catch {
    return undefined;
  }
}

/** Builds the `gg snap prune` args list from a directory path and options. */
export function buildPruneArgs(snapDir: string, opts: PruneOptions): string[] {
  const args = ['--snap-dir', snapDir];
  if (opts.ids?.trim()) {
    args.push('--ids', opts.ids.trim());
  }
  if (opts.keepLast !== undefined) {
    args.push('--keep-last', String(opts.keepLast));
  }
  if (opts.olderThan?.trim()) {
    args.push('--older-than', opts.olderThan.trim());
  }
  if (opts.tag?.trim()) {
    args.push('--tag', opts.tag.trim());
  }
  if (opts.dryRun) {
    args.push('--dry-run');
  }
  // Always skip the interactive confirmation — we either preview (dry-run) or the
  // user explicitly chose to delete via the result panel's confirmation step.
  args.push('--yes');
  return args;
}

/** Returns true when at least one filter is set (gg snap prune requires one). */
export function hasAtLeastOneFilter(opts: PruneOptions): boolean {
  return !!(opts.ids?.trim() || opts.keepLast !== undefined || opts.olderThan?.trim() || opts.tag?.trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// UX flow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collects prune filters via four optional InputBoxes plus a dry-run toggle.
 * `prefilledIds` is populated from the current TreeView selection if any items
 * are selected — mirrors the JetBrains SnapPruneOptionsDialog pre-fill.
 */
async function promptPruneOptions(prefilledIds?: string): Promise<PruneOptions | undefined> {
  const idsRaw = await vscode.window.showInputBox({
    title: 'Gopher-Glide: Snapshot IDs to prune (--ids)',
    prompt: 'Comma-separated index IDs (e.g. "1,3,5"). Leave empty to skip this filter.',
    value: prefilledIds ?? '',
    ignoreFocusOut: true,
    validateInput: (v) => {
      if (!v.trim()) {
        return undefined;
      }
      return /^[\d,\s]+$/.test(v.trim()) ? undefined : 'Enter comma-separated numbers, or leave empty';
    },
  });
  if (idsRaw === undefined) {
    return undefined;
  }

  const keepLastRaw = await vscode.window.showInputBox({
    title: 'Gopher-Glide: Keep last N snapshots (--keep-last)',
    prompt: 'Delete older ones, keeping the N most recent. Leave empty to skip this filter.',
    placeHolder: 'e.g. 10',
    ignoreFocusOut: true,
    validateInput: (v) => (!v.trim() || /^\d+$/.test(v.trim()) ? undefined : 'Enter a positive integer, or leave empty'),
  });
  if (keepLastRaw === undefined) {
    return undefined;
  }

  const olderThanRaw = await vscode.window.showInputBox({
    title: 'Gopher-Glide: Delete snapshots older than (--older-than)',
    prompt: 'Duration string, e.g. "30d", "7d", "2w", "24h". Leave empty to skip this filter.',
    placeHolder: 'e.g. 30d',
    ignoreFocusOut: true,
    validateInput: (v) => (!v.trim() || /^\d+(d|w|h|m)$/.test(v.trim()) ? undefined : 'Use a duration like 30d, 7d, 2w, 24h'),
  });
  if (olderThanRaw === undefined) {
    return undefined;
  }

  const tagRaw = await vscode.window.showInputBox({
    title: 'Gopher-Glide: Delete by tag (--tag)',
    prompt: 'Exact tag name to match. Leave empty to skip this filter.',
    ignoreFocusOut: true,
  });
  if (tagRaw === undefined) {
    return undefined;
  }

  const dryRunChoice = await vscode.window.showQuickPick(
    [
      { label: 'Preview only (dry-run)', description: 'Show candidates without deleting', value: true, picked: true },
      { label: 'Delete now', description: 'Permanently delete matching snapshots', value: false },
    ],
    { title: 'Gopher-Glide: Dry-run or delete?', ignoreFocusOut: true },
  );
  if (!dryRunChoice) {
    return undefined;
  }

  const opts: PruneOptions = {
    ids: idsRaw.trim() || undefined,
    keepLast: keepLastRaw.trim() ? parseInt(keepLastRaw.trim(), 10) : undefined,
    olderThan: olderThanRaw.trim() || undefined,
    tag: tagRaw.trim() || undefined,
    dryRun: dryRunChoice.value,
  };

  if (!hasAtLeastOneFilter(opts)) {
    vscode.window.showErrorMessage(
      'Gopher-Glide: At least one filter (--ids, --keep-last, --older-than, or --tag) is required.',
    );
    return undefined;
  }

  return opts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full prune flow: prompt options → run `gg snap prune` → show result panel.
 * Calls `onRefresh()` after a successful non-dry-run delete so the TreeView
 * reflects the newly-removed snaps.
 */
export async function handlePrune(
  configMgr: ConfigManager,
  installer: Installer,
  snapDir: string,
  prefilledIds: string | undefined,
  onRefresh: () => void,
): Promise<void> {
  const opts = await promptPruneOptions(prefilledIds);
  if (!opts) {
    return;
  }

  await installer.ensureInstalled();
  const binPath = configMgr.effectiveBinaryPath;

  let result: PruneResult | undefined;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: opts.dryRun ? 'Gopher-Glide: Previewing prune candidates…' : 'Gopher-Glide: Pruning snapshots…',
      cancellable: false,
    },
    async () => {
      const args = buildPruneArgs(snapDir, opts);
      const output = await runSnapCommand(binPath, args);

      if (output.code !== 0) {
        vscode.window.showErrorMessage(
          `Gopher-Glide: gg snap prune failed (exit ${output.code}): ${output.stderr.trim() || output.stdout.trim()}`,
        );
        return;
      }

      result = parsePruneResult(output.stdout);
      if (!result) {
        vscode.window.showErrorMessage('Gopher-Glide: Could not parse the prune output. Check the gg binary version.');
        return;
      }
    },
  );

  if (!result) {
    return;
  }

  if (result.candidates.length === 0 && result.deleted === 0) {
    vscode.window.showInformationMessage('Gopher-Glide: No snapshots matched the prune filters.');
    return;
  }

  if (!result.dry_run && result.deleted > 0) {
    onRefresh();
  }

  const panel = getSnapDetailPanel(result.dry_run ? 'Prune Preview' : 'Prune Complete');
  panel.webview.html = buildPruneResultHtml(result, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML — exported for smoke-testing
// ─────────────────────────────────────────────────────────────────────────────

export function buildPruneResultHtml(result: PruneResult, opts: PruneOptions): string {
  const isDryRun = result.dry_run;
  const count = isDryRun ? result.candidates.length : result.deleted;
  const title = isDryRun ? 'Prune Preview' : 'Prune Complete';

  const filtersUsed = [
    opts.ids ? `ids: ${opts.ids}` : null,
    opts.keepLast !== undefined ? `keep-last: ${opts.keepLast}` : null,
    opts.olderThan ? `older-than: ${opts.olderThan}` : null,
    opts.tag ? `tag: ${opts.tag}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const candidateRows = result.candidates.map((c) =>
    `<tr>
      <td>${c.id ?? '—'}</td>
      <td>${escHtml(c.tag ?? '')}</td>
      <td>${escHtml(c.date ?? '')}</td>
      <td>${escHtml(c.reason ?? '')}</td>
    </tr>`,
  );

  const errorRows = result.errors.map((e) => `<li class="error">${escHtml(e)}</li>`);

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 14px 18px; }
  .banner { display: flex; align-items: center; gap: 10px; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px; }
  .banner.preview { background: rgba(88,166,255,0.1); border: 1px solid rgba(88,166,255,0.3); }
  .banner.done { background: rgba(63,185,80,0.1); border: 1px solid rgba(63,185,80,0.3); }
  .banner.empty { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); }
  .banner-icon { font-size: 20px; line-height: 1; }
  .banner-text h2 { margin: 0 0 2px 0; font-size: 14px; }
  .banner-text .sub { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .filters { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: var(--vscode-editorWidget-background); padding: 6px 8px; text-align: left; font-weight: 600; position: sticky; top: 0; border-bottom: 1px solid var(--vscode-panel-border); }
  td { padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  ul.errors { list-style: none; padding: 0; margin: 10px 0 0 0; }
  li.error { color: #f85149; font-size: 12px; padding: 3px 0; }
  .empty { font-style: italic; color: var(--vscode-descriptionForeground); padding: 10px 0; font-size: 12px; }
</style>
</head>
<body>
<div class="banner ${count === 0 ? 'empty' : isDryRun ? 'preview' : 'done'}">
  <div class="banner-icon">${isDryRun ? '🔍' : count > 0 ? '🗑️' : 'ℹ️'}</div>
  <div class="banner-text">
    <h2>${title}</h2>
    <div class="sub">
      ${isDryRun
        ? `${count} snapshot${count !== 1 ? 's' : ''} would be deleted`
        : `${count} snapshot${count !== 1 ? 's' : ''} deleted`}
    </div>
  </div>
</div>
${filtersUsed ? `<div class="filters">Filters: ${escHtml(filtersUsed)}</div>` : ''}
${candidateRows.length > 0
  ? `<table>
      <thead><tr><th>ID</th><th>Tag</th><th>Date</th><th>Reason</th></tr></thead>
      <tbody>${candidateRows.join('')}</tbody>
    </table>`
  : '<div class="empty">No candidates matched the specified filters.</div>'}
${errorRows.length > 0 ? `<ul class="errors">${errorRows.join('')}</ul>` : ''}
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
