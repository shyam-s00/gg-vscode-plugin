import * as vscode from 'vscode';

import { getNonce, readTemplate, resolveAssetUris } from '../../webview/webviewAssets';
import { getExtensionUri, getSnapDetailPanel, getSnapDiffColumnPrefs, setSnapDiffColumnPrefs } from '../snapDetailPanel';
import { formatEndpointId } from '../view/panel';
import { endpointRequestCount } from '../snapModel';
import type { LoadedSnap, SnapEndpoint, SnapFieldSchema } from '../snapModel';

// ─────────────────────────────────────────────────────────────────────────────
// Public helpers — exported for testing
// ─────────────────────────────────────────────────────────────────────────────

export interface EndpointDiff {
  id: string;
  label: string;
  baseline?: SnapEndpoint;
  compare?: SnapEndpoint;
  state: 'UNCHANGED' | 'MODIFIED' | 'ADDED' | 'REMOVED';
  verdict: 'PASS' | 'REGRESSION' | 'ADDED' | 'REMOVED';
  p99Delta?: number;
  hasRegression: boolean;
  hasPayloadWarning: boolean;
  hasImprovement: boolean;
}

function pctChange(before: number, after: number): number {
  if (before === 0) {
    return after === 0 ? 0 : 100;
  }
  return ((after - before) / before) * 100;
}

export function computeDiff(
  baseline: LoadedSnap,
  compare: LoadedSnap,
): EndpointDiff[] {
  const baseMap = new Map<string, SnapEndpoint>();
  for (const ep of baseline.endpoints) {
    baseMap.set(ep.id, ep);
  }

  const compMap = new Map<string, SnapEndpoint>();
  for (const ep of compare.endpoints) {
    compMap.set(ep.id, ep);
  }

  const allIds = new Set([...baseMap.keys(), ...compMap.keys()]);
  const diffs: EndpointDiff[] = [];

  for (const id of allIds) {
    const b = baseMap.get(id);
    const c = compMap.get(id);

    let state: EndpointDiff['state'] = 'UNCHANGED';
    let verdict: EndpointDiff['verdict'] = 'PASS';
    let p99Delta: number | undefined = undefined;
    let hasRegression = false;
    let hasPayloadWarning = false;
    let hasImprovement = false;

    if (!b && c) {
      state = 'ADDED';
      verdict = 'ADDED';
    } else if (b && !c) {
      state = 'REMOVED';
      verdict = 'REMOVED';
    } else if (b && c) {
      const errDiff = c.error_rate - b.error_rate;
      const p95Diff = c.latency.p95 - b.latency.p95;
      p99Delta = pctChange(b.latency.p99, c.latency.p99);
      const bAvg = b.payload_size?.avg ?? 0;
      const cAvg = c.payload_size?.avg ?? 0;
      const payloadDiff = cAvg - bAvg;

      if (errDiff > 0.001 || (p99Delta !== undefined && p99Delta > 20) || p95Diff > 50) {
        hasRegression = true;
        verdict = 'REGRESSION';
      }
      if (payloadDiff > 1024 * 100) {
        hasPayloadWarning = true;
      }
      if (errDiff < -0.001 || p95Diff < -50 || (p99Delta !== undefined && p99Delta < 0)) {
        hasImprovement = true;
      }

      if (
        hasRegression ||
        hasPayloadWarning ||
        hasImprovement ||
        Math.abs(errDiff) > 0.0001 ||
        Math.abs(p95Diff) > 1
      ) {
        state = 'MODIFIED';
      }
    }

    diffs.push({
      id,
      label: formatEndpointId(id),
      baseline: b,
      compare: c,
      state,
      verdict,
      p99Delta,
      hasRegression,
      hasPayloadWarning,
      hasImprovement,
    });
  }

  return diffs.sort((a, b) => a.label.localeCompare(b.label));
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────────────

let _msgListener: vscode.Disposable | undefined;

export function showSnapDiff(a: LoadedSnap, b: LoadedSnap): void {
  const [baseline, compare] =
    a.meta.start_time <= b.meta.start_time ? [a, b] : [b, a];

  const bTag = baseline.meta.tag.trim() || '(untagged)';
  const cTag = compare.meta.tag.trim() || '(untagged)';

  const panel = getSnapDetailPanel(`Diff: ${bTag} ↔ ${cTag}`);

  _msgListener?.dispose();
  _msgListener = panel.webview.onDidReceiveMessage((message: { type?: string; columns?: string[] }) => {
    if (message?.type === 'columnsChanged' && Array.isArray(message.columns)) {
      setSnapDiffColumnPrefs(message.columns);
    }
  });

  panel.webview.html = buildSnapDiffHtml(panel.webview, getExtensionUri(), baseline, compare, bTag, cTag, getSnapDiffColumnPrefs());
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML — exported for testing
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '—';
  if (bytes < 1024) return bytes.toFixed(2) + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function formatLatency(ms: number | undefined): string {
  if (ms === undefined) return '—';
  return ms.toFixed(1) + 'ms';
}

function formatPct(frac: number | undefined): string {
  if (frac === undefined) return '—';
  return (frac * 100).toFixed(2) + '%';
}

/** Toggleable diff table columns, in display order. "Endpoint" is always shown and isn't part of this list. */
const COLUMNS: { id: string; label: string; higherIsBad: boolean }[] = [
  { id: 'col-requests', label: 'Requests', higherIsBad: false },
  { id: 'col-err', label: 'Error Rate', higherIsBad: true },
  { id: 'col-p99', label: 'P99', higherIsBad: true },
  { id: 'col-p95', label: 'P95', higherIsBad: true },
  { id: 'col-p50', label: 'P50', higherIsBad: true },
  { id: 'col-max', label: 'Max', higherIsBad: true },
  { id: 'col-payload-avg', label: 'Payload Avg', higherIsBad: true },
  { id: 'col-payload-p95', label: 'Payload P95', higherIsBad: true },
  { id: 'col-payload-max', label: 'Payload Max', higherIsBad: true },
];

function getMetricValue(colId: string, ep?: SnapEndpoint): number | undefined {
  if (!ep) return undefined;
  switch (colId) {
    case 'col-requests': return endpointRequestCount(ep);
    case 'col-err': return ep.error_rate ?? 0;
    case 'col-p99': return ep.latency.p99;
    case 'col-p95': return ep.latency.p95;
    case 'col-p50': return ep.latency.p50;
    case 'col-max': return ep.latency.max;
    case 'col-payload-avg': return ep.payload_size?.avg;
    case 'col-payload-p95': return ep.payload_size?.p95;
    case 'col-payload-max': return ep.payload_size?.max;
    default: return undefined;
  }
}

function formatMetricValue(colId: string, val: number | undefined): string {
  if (val === undefined) return '—';
  switch (colId) {
    case 'col-requests': return val.toLocaleString();
    case 'col-err': return formatPct(val);
    case 'col-p99': case 'col-p95': case 'col-p50': case 'col-max': return formatLatency(val);
    case 'col-payload-avg': case 'col-payload-p95': case 'col-payload-max': return formatBytes(val);
    default: return String(val);
  }
}

/**
 * Renders a diff table cell as the target value plus a delta indicator
 * (▲/▼ with the signed change), instead of a "baseline → target" pair.
 * ADDED/REMOVED endpoints still get a NEW/GONE badge.
 */
function deltaCell(colId: string, higherIsBad: boolean, baseline?: SnapEndpoint, compare?: SnapEndpoint): string {
  const baseVal = getMetricValue(colId, baseline);
  const cmpVal = getMetricValue(colId, compare);

  if (baseVal === undefined && cmpVal === undefined) return '—';
  if (baseVal === undefined) {
    return '<span class="diff-badge-added">NEW</span> ' + formatMetricValue(colId, cmpVal);
  }
  if (cmpVal === undefined) {
    return formatMetricValue(colId, baseVal) + ' <span class="diff-badge-removed">GONE</span>';
  }

  const delta = cmpVal - baseVal;
  const title = escHtml(`${formatMetricValue(colId, baseVal)} → ${formatMetricValue(colId, cmpVal)}`);

  if (Math.abs(delta) < 1e-9) {
    return `<span title="${title}">${formatMetricValue(colId, cmpVal)}</span>`;
  }

  const isIncrease = delta > 0;
  const cls = !higherIsBad ? 'diff-arrow-neutral' : (isIncrease ? 'diff-arrow-up' : 'diff-arrow-down');
  const arrow = isIncrease ? '▲' : '▼';
  const sign = isIncrease ? '+' : '-';
  const deltaFormatted = sign + formatMetricValue(colId, Math.abs(delta));

  return `<span class="${cls}" title="${title}">${arrow} ${deltaFormatted}</span>`;
}

export interface DiffRowData {
  label: string;
  baseErrorRate: number;
  cmpErrorRate: number;
  state: EndpointDiff['state'];
  baseSchema: Record<string, SnapFieldSchema>;
  cmpSchema: Record<string, SnapFieldSchema>;
  baseStatus: Record<string, number>;
  cmpStatus: Record<string, number>;
  cmpBodyStored?: number;
  cmpBodyObserved?: number;
}

export function buildSnapDiffHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  baseline: LoadedSnap,
  compare: LoadedSnap,
  bTag: string,
  cTag: string,
  savedColumns?: string[],
): string {
  const enabledColumns = new Set(savedColumns && savedColumns.length > 0 ? savedColumns : COLUMNS.map((c) => c.id));

  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `font-src ${webview.cspSource} data: 'unsafe-inline'`,
    `img-src ${webview.cspSource} data: 'unsafe-inline'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-inline'`,
  ].join('; ');

  const epMap = computeDiff(baseline, compare);
  const bStart = baseline.meta.start_time.slice(0, 19).replace('T', ' ');
  const cStart = compare.meta.start_time.slice(0, 19).replace('T', ' ');
  
  const bHash = baseline.meta.config_hash ? baseline.meta.config_hash.substring(0, 12) + '...' : '—';
  const cHash = compare.meta.config_hash ? compare.meta.config_hash.substring(0, 12) + '...' : '—';
  const mismatchWarning = (baseline.meta.config_hash !== compare.meta.config_hash) && baseline.meta.config_hash && compare.meta.config_hash;

  const diffs: DiffRowData[] = epMap.map((d) => ({
    label: d.label,
    baseErrorRate: d.baseline?.error_rate || 0,
    cmpErrorRate: d.compare?.error_rate || 0,
    state: d.state,
    baseSchema: d.baseline?.schema?.fields || {},
    cmpSchema: d.compare?.schema?.fields || {},
    baseStatus: d.baseline?.status_dist || {},
    cmpStatus: d.compare?.status_dist || {},
    cmpBodyStored: d.compare?.body_samples_stored,
    cmpBodyObserved: d.compare?.body_samples_observed,
  }));

  const warningBanner = mismatchWarning
    ? '<div class="warning-banner">Configuration mismatch: snapshot configurations do not match and may lead to inconsistent results. Re-running the baseline with the target\'s configuration is recommended.</div>'
    : '';

  const columnsMenu = COLUMNS.map((c) => `<label><input type="checkbox" ${enabledColumns.has(c.id) ? 'checked' : ''} data-col="${c.id}"> ${escHtml(c.label)}</label>`).join('');
  const tableHeaderCols = COLUMNS.map((c) => `<th class="${c.id}"${enabledColumns.has(c.id) ? '' : ' style="display:none"'}>${escHtml(c.label)}</th>`).join('');
  const tableRows = epMap.map((d, i) => {
    let rowClass = 'ep-row';
    if (d.state === 'REMOVED') { rowClass += ' row-removed'; }
    if (d.state === 'ADDED') { rowClass += ' row-added'; }

    return `
            <tr class="${rowClass}" data-idx="${i}" data-search="${escHtml(d.label.toLowerCase())}">
              <td class="id-cell" title="${escHtml(d.label)}">${escHtml(d.label)}</td>
              ${COLUMNS.map((c) => `<td class="${c.id}"${enabledColumns.has(c.id) ? '' : ' style="display:none"'}>${deltaCell(c.id, c.higherIsBad, d.baseline, d.compare)}</td>`).join('')}
            </tr>`;
  }).join('');

  const { css, js } = resolveAssetUris(webview, extensionUri, 'snap/diff', true);

  return readTemplate(extensionUri, 'snap/diff', 'view.html')
    .replace('{{CSP}}', csp)
    .replace('{{CSS_URI}}', css.toString())
    .replace('{{WARNING_BANNER}}', warningBanner)
    .replace('{{B_TAG}}', escHtml(bTag))
    .replace('{{C_TAG}}', escHtml(cTag))
    .replace('{{B_START}}', escHtml(bStart))
    .replace('{{C_START}}', escHtml(cStart))
    .replace('{{B_TOTAL}}', baseline.meta.total_requests.toLocaleString())
    .replace('{{C_TOTAL}}', compare.meta.total_requests.toLocaleString())
    .replace('{{B_PEAK}}', `${baseline.meta.peak_rps.toFixed(1)} r/s`)
    .replace('{{C_PEAK}}', `${compare.meta.peak_rps.toFixed(1)} r/s`)
    .replace('{{B_PROFILE}}', escHtml(baseline.meta.profile_name || '—'))
    .replace('{{C_PROFILE}}', escHtml(compare.meta.profile_name || '—'))
    .replace('{{B_HASH}}', bHash)
    .replace('{{C_HASH}}', cHash)
    .replace('{{COLUMNS_MENU}}', columnsMenu)
    .replace('{{TABLE_HEADER_COLS}}', tableHeaderCols)
    .replace('{{TABLE_ROWS}}', tableRows)
    .replace(/\{\{NONCE\}\}/g, nonce)
    .replace('{{DIFFS_JSON}}', JSON.stringify(diffs))
    .replace('{{JS_URI}}', js!.toString());
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
