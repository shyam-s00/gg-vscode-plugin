import * as vscode from 'vscode';

import type { ConfigManager } from '../config/config';
import type { Installer } from '../installer/installer';
import { runSnapCommand } from './snapCliRunner';
import { getSnapDetailPanel } from './snapDetailPanel';
import type { LoadedSnap } from './snapModel';

// ─────────────────────────────────────────────────────────────────────────────
// Types — exported for testing
// ─────────────────────────────────────────────────────────────────────────────

export interface AssertOptions {
  /** Maximum allowed p99 latency increase in % (default 20). */
  latencyRegressionPct: number;
  /** Maximum allowed absolute error-rate increase 0–1 (default 0.05). */
  errorRateDelta: number;
  /** Maximum allowed average payload-size increase in % (default 50). */
  payloadSizeDeltaPct: number;
  denyRemovedFields: boolean;
  failOnWarn: boolean;
}

export interface AssertViolation {
  endpoint_id: string;
  verdict: string;
  message: string;
}

export interface AssertResult {
  passed: boolean;
  violations: AssertViolation[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers — exported for testing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses the JSON stdout of `gg snap assert --reporter json`.
 * Returns `undefined` when stdout is empty or not valid JSON.
 */
export function parseAssertResult(stdout: string): AssertResult | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.passed !== 'boolean') {
      return undefined;
    }
    return {
      passed: parsed.passed,
      violations: Array.isArray(parsed.violations)
        ? (parsed.violations as AssertViolation[])
        : [],
    };
  } catch {
    return undefined;
  }
}

/** Builds the CLI args list for `gg snap assert` from a pair of snaps and options. */
export function buildAssertArgs(
  baseline: LoadedSnap,
  compare: LoadedSnap,
  opts: AssertOptions,
): string[] {
  const args = [
    '--baseline', baseline.filePath,
    '--current', compare.filePath,
    '--latency-regression', String(opts.latencyRegressionPct),
    '--error-rate-delta', String(opts.errorRateDelta),
    '--payload-size-delta', String(opts.payloadSizeDeltaPct),
  ];
  if (opts.denyRemovedFields) {
    args.push('--deny-removed-fields');
  }
  if (opts.failOnWarn) {
    args.push('--fail-on-warn');
  }
  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// UX flow
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_OPTS: AssertOptions = {
  latencyRegressionPct: 20,
  errorRateDelta: 0.05,
  payloadSizeDeltaPct: 50,
  denyRemovedFields: false,
  failOnWarn: false,
};

/** Collects assert thresholds via three InputBoxes + a MultiSelect QuickPick. */
async function promptAssertOptions(): Promise<AssertOptions | undefined> {
  const latRaw = await vscode.window.showInputBox({
    title: 'Gopher-Glide: Latency regression threshold (--latency-regression)',
    prompt: 'Maximum allowed p99 latency increase in %. Leave empty for default (20).',
    placeHolder: '20',
    ignoreFocusOut: true,
    validateInput: (v) => (!v.trim() || /^\d+(\.\d+)?$/.test(v.trim()) ? undefined : 'Enter a positive number, or leave empty'),
  });
  if (latRaw === undefined) {
    return undefined;
  }

  const errRaw = await vscode.window.showInputBox({
    title: 'Gopher-Glide: Error-rate delta (--error-rate-delta)',
    prompt: 'Maximum allowed absolute error-rate increase, 0–1 (e.g. 0.05 = 5 pp). Leave empty for default (0.05).',
    placeHolder: '0.05',
    ignoreFocusOut: true,
    validateInput: (v) => {
      if (!v.trim()) {
        return undefined;
      }
      const n = parseFloat(v.trim());
      return !isNaN(n) && n >= 0 && n <= 1 ? undefined : 'Enter a number between 0 and 1, or leave empty';
    },
  });
  if (errRaw === undefined) {
    return undefined;
  }

  const payRaw = await vscode.window.showInputBox({
    title: 'Gopher-Glide: Payload size delta (--payload-size-delta)',
    prompt: 'Maximum allowed average payload-size increase in %. Leave empty for default (50).',
    placeHolder: '50',
    ignoreFocusOut: true,
    validateInput: (v) => (!v.trim() || /^\d+(\.\d+)?$/.test(v.trim()) ? undefined : 'Enter a positive number, or leave empty'),
  });
  if (payRaw === undefined) {
    return undefined;
  }

  const flags = await vscode.window.showQuickPick(
    [
      { label: '--deny-removed-fields', description: 'Treat removed schema fields as REGRESSION instead of WARN', picked: false },
      { label: '--fail-on-warn', description: 'Exit non-zero on WARN verdicts (default: only REGRESSION fails)', picked: false },
    ],
    { title: 'Gopher-Glide: Additional options', canPickMany: true, ignoreFocusOut: true },
  );
  if (flags === undefined) {
    return undefined;
  }

  const flagSet = new Set(flags.map((f) => f.label));
  return {
    latencyRegressionPct: latRaw.trim() ? parseFloat(latRaw.trim()) : DEFAULT_OPTS.latencyRegressionPct,
    errorRateDelta: errRaw.trim() ? parseFloat(errRaw.trim()) : DEFAULT_OPTS.errorRateDelta,
    payloadSizeDeltaPct: payRaw.trim() ? parseFloat(payRaw.trim()) : DEFAULT_OPTS.payloadSizeDeltaPct,
    denyRemovedFields: flagSet.has('--deny-removed-fields'),
    failOnWarn: flagSet.has('--fail-on-warn'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full assert flow: prompt options → run `gg snap assert` → show result.
 * Automatically orders the two snaps oldest→newest, matching the CLI convention
 * that the "baseline" is the older reference run.
 */
export async function handleAssert(
  configMgr: ConfigManager,
  installer: Installer,
  a: LoadedSnap,
  b: LoadedSnap,
): Promise<void> {
  const [baseline, compare] =
    a.meta.start_time <= b.meta.start_time ? [a, b] : [b, a];

  const opts = await promptAssertOptions();
  if (!opts) {
    return;
  }

  await installer.ensureInstalled();
  const binPath = configMgr.effectiveBinaryPath;

  let result: AssertResult | undefined;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Gopher-Glide: Running assertion…', cancellable: false },
    async () => {
      const args = buildAssertArgs(baseline, compare, opts);
      const output = await runSnapCommand(binPath, args);

      if (output.code !== 0 && output.code !== 1) {
        // Unexpected failure (binary missing, bad args, etc.)
        vscode.window.showErrorMessage(
          `Gopher-Glide: gg snap assert failed (exit ${output.code}): ${output.stderr.trim() || output.stdout.trim()}`,
        );
        return;
      }

      result = parseAssertResult(output.stdout);
      if (!result) {
        vscode.window.showErrorMessage('Gopher-Glide: Could not parse the assertion output. Check the gg binary version.');
        return;
      }
    },
  );

  if (!result) {
    return;
  }

  if (result.passed) {
    vscode.window.showInformationMessage('Gopher-Glide: Assertion passed ✅ — no regressions detected.');
    return;
  }

  const panel = getSnapDetailPanel('Assert Result');
  panel.webview.html = buildAssertResultHtml(baseline, compare, result, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML — exported for smoke-testing
// ─────────────────────────────────────────────────────────────────────────────

export function buildAssertResultHtml(
  baseline: LoadedSnap,
  compare: LoadedSnap,
  result: AssertResult,
  opts: AssertOptions,
): string {
  const bTag = baseline.meta.tag.trim() || '(untagged)';
  const cTag = compare.meta.tag.trim() || '(untagged)';

  const regressions = result.violations.filter((v) => v.verdict === 'REGRESSION');
  const warns = result.violations.filter((v) => v.verdict === 'WARN');

  const verdictRows = result.violations.map((v) => {
    const cls = v.verdict === 'REGRESSION' ? 'reg' : v.verdict === 'WARN' ? 'wrn' : 'pass';
    return `<tr class="${cls}">
      <td class="ep">${escHtml(v.endpoint_id)}</td>
      <td><span class="badge badge-${cls}">${escHtml(v.verdict)}</span></td>
      <td>${escHtml(v.message)}</td>
    </tr>`;
  });

  const optsLine = [
    `latency-regression: ${opts.latencyRegressionPct}%`,
    `error-rate-delta: ${opts.errorRateDelta}`,
    `payload-size-delta: ${opts.payloadSizeDeltaPct}%`,
    ...(opts.denyRemovedFields ? ['deny-removed-fields'] : []),
    ...(opts.failOnWarn ? ['fail-on-warn'] : []),
  ].join('  ·  ');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 14px 18px; }
  .banner { display: flex; align-items: center; gap: 10px; border-radius: 6px; padding: 10px 14px; margin-bottom: 12px; }
  .banner.fail { background: rgba(248,81,73,0.12); border: 1px solid rgba(248,81,73,0.35); }
  .banner.pass { background: rgba(63,185,80,0.12); border: 1px solid rgba(63,185,80,0.35); }
  .banner-icon { font-size: 20px; line-height: 1; }
  .banner-text h2 { margin: 0 0 2px 0; font-size: 14px; }
  .banner-text .sub { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .header { margin-bottom: 12px; }
  .header .meta { font-size: 11px; color: var(--vscode-descriptionForeground); }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: var(--vscode-editorWidget-background); padding: 6px 8px; text-align: left; font-weight: 600; position: sticky; top: 0; border-bottom: 1px solid var(--vscode-panel-border); }
  td { padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  td.ep { font-family: var(--vscode-editor-font-family); font-size: 11px; white-space: nowrap; }
  .reg td { background: rgba(248,81,73,0.06); }
  .wrn td { background: rgba(210,153,34,0.06); }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; }
  .badge-reg { background: rgba(248,81,73,0.2); color: #f85149; }
  .badge-wrn { background: rgba(210,153,34,0.2); color: #d29922; }
  .badge-pass { background: rgba(63,185,80,0.15); color: #3fb950; }
  .empty { font-style: italic; color: var(--vscode-descriptionForeground); padding: 10px 0; font-size: 12px; }
  .opts { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
</style>
</head>
<body>
<div class="banner ${result.passed ? 'pass' : 'fail'}">
  <div class="banner-icon">${result.passed ? '✅' : '❌'}</div>
  <div class="banner-text">
    <h2>${result.passed ? 'Assertion passed' : `Assertion failed — ${regressions.length} regression${regressions.length !== 1 ? 's' : ''}${warns.length > 0 ? `, ${warns.length} warning${warns.length !== 1 ? 's' : ''}` : ''}`}</h2>
    <div class="sub">Baseline: <strong>${escHtml(bTag)}</strong> &nbsp;→&nbsp; Compare: <strong>${escHtml(cTag)}</strong></div>
  </div>
</div>
<div class="opts">Thresholds: ${escHtml(optsLine)}</div>
${result.violations.length === 0
  ? '<div class="empty">No violations recorded.</div>'
  : `<table>
<thead><tr><th>Endpoint</th><th>Verdict</th><th>Details</th></tr></thead>
<tbody>${verdictRows.join('')}</tbody>
</table>`}
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
