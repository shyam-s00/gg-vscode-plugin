import * as vscode from 'vscode';

import type { ConfigManager } from '../../config/config';
import type { Installer } from '../../installer/installer';
import { readTemplate, resolveAssetUris } from '../../webview/webviewAssets';
import { runSnapCommand } from '../snapCliRunner';
import { getExtensionUri, getSnapDetailPanel } from '../snapDetailPanel';
import type { LoadedSnap } from '../snapModel';

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
  panel.webview.html = buildAssertResultHtml(panel.webview, getExtensionUri(), baseline, compare, result, opts);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML — exported for smoke-testing
// ─────────────────────────────────────────────────────────────────────────────

export function buildAssertResultHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
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

  const headline = result.passed
    ? 'Assertion passed'
    : `Assertion failed — ${regressions.length} regression${regressions.length !== 1 ? 's' : ''}${warns.length > 0 ? `, ${warns.length} warning${warns.length !== 1 ? 's' : ''}` : ''}`;

  const tableOrEmpty = result.violations.length === 0
    ? '<div class="empty">No violations recorded.</div>'
    : `<table>
<thead><tr><th>Endpoint</th><th>Verdict</th><th>Details</th></tr></thead>
<tbody>${verdictRows.join('')}</tbody>
</table>`;

  const { css } = resolveAssetUris(webview, extensionUri, 'snap/assert', false);
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
  ].join('; ');

  return readTemplate(extensionUri, 'snap/assert', 'view.html')
    .replace('{{CSP}}', csp)
    .replace('{{CSS_URI}}', css.toString())
    .replace('{{BANNER_CLASS}}', result.passed ? 'pass' : 'fail')
    .replace('{{BANNER_ICON}}', result.passed ? '✅' : '❌')
    .replace('{{HEADLINE}}', headline)
    .replace('{{BASELINE_TAG}}', escHtml(bTag))
    .replace('{{COMPARE_TAG}}', escHtml(cTag))
    .replace('{{OPTS_LINE}}', escHtml(optsLine))
    .replace('{{TABLE_OR_EMPTY}}', tableOrEmpty);
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
