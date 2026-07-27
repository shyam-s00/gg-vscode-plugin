import * as vscode from 'vscode';

import { getSnapDetailPanel, getSnapDiffColumnPrefs, setSnapDiffColumnPrefs } from './snapDetailPanel';
import { formatEndpointId } from './snapViewPanel';
import { endpointRequestCount } from './snapModel';
import type { LoadedSnap, SnapEndpoint } from './snapModel';

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

  panel.webview.html = buildSnapDiffHtml(panel.webview, baseline, compare, bTag, cTag, getSnapDiffColumnPrefs());
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

export function buildSnapDiffHtml(
  arg1: any,
  arg2: any,
  arg3?: any,
  arg4?: any,
  arg5?: any,
  arg6?: any,
): string {
  let webview: any;
  let baseline: LoadedSnap;
  let compare: LoadedSnap;
  let bTag: string;
  let cTag: string;
  let savedColumns: string[] | undefined;

  if (arg1 && arg1.cspSource) {
    webview = arg1;
    baseline = arg2;
    compare = arg3;
    bTag = arg4;
    cTag = arg5;
    savedColumns = arg6;
  } else {
    webview = { cspSource: "'self'" };
    baseline = arg1;
    compare = arg2;
    bTag = arg3;
    cTag = arg4;
    savedColumns = undefined;
  }
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

  const diffs = epMap.map(d => ({
    label: d.label,
    baseErrorRate: d.baseline?.error_rate || 0,
    cmpErrorRate: d.compare?.error_rate || 0,
    state: d.state,
    baseSchema: d.baseline?.schema?.fields || {},
    cmpSchema: d.compare?.schema?.fields || {},
    baseStatus: d.baseline?.status_dist || {},
    cmpStatus: d.compare?.status_dist || {},
    cmpBodyStored: d.compare?.body_samples_stored,
    cmpBodyObserved: d.compare?.body_samples_observed
  }));

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  
  .warning-banner { background-color: #382c10; color: #e3b341; border: 1px solid #845306; padding: 8px 12px; font-size: 12px; border-radius: 4px; margin-bottom: 12px; }
  
  .diff-header-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px; }
  .diff-header-table th { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; }
  .diff-header-table td { padding: 4px 8px; font-weight: 500; }
  
  .legend { display: flex; gap: 16px; font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 12px; align-items: center; }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .dot-regression { background: #f85149; }
  .dot-warning { background: #d29922; }
  .dot-improvement { background: #3fb950; }
  .dot-added { background: #58a6ff; }
  .dot-removed { background: #8b949e; }
  
  /* Toolbar styling — scoped to the left (endpoint list) pane only */
  .toolbar { display: flex; gap: 8px; padding: 10px 12px; align-items: center; position: relative; flex: none; border-bottom: 1px solid var(--vscode-panel-border); }
  .search-box { flex: 1; display: flex; align-items: center; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 2px; padding: 4px 8px; }
  .search-box input { flex: 1; background: transparent; border: none; color: var(--vscode-input-foreground); font-family: inherit; font-size: 12px; outline: none; }
  .search-box input::placeholder { color: var(--vscode-input-placeholderForeground); }
  .btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border, transparent); padding: 4px 12px; font-size: 12px; border-radius: 2px; cursor: pointer; display: flex; align-items: center; gap: 4px; }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

  /* Columns menu dropdown */
  .columns-menu { display: none; position: absolute; right: 0; top: 100%; margin-top: 4px; background: var(--vscode-menu-background, #252526); border: 1px solid var(--vscode-menu-border, #454545); box-shadow: 0 4px 12px rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 4px; z-index: 100; min-width: 160px; flex-direction: column; gap: 6px; }
  .columns-menu.open { display: flex; }
  .columns-menu label { font-size: 12px; display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }

  .split { display: flex; gap: 0; flex: 1; overflow: hidden; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  .pane { overflow: auto; }
  .left { width: 55%; min-width: 200px; max-width: 80%; flex: none; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); display: flex; flex-direction: column; overflow: hidden; }
  .left .table-wrap { flex: 1; overflow: auto; }
  .right { flex: 1; min-width: 200px; display: flex; flex-direction: column; background: var(--vscode-editorWidget-background); overflow: hidden; }
  
  /* Horizontal Drag Resizer */
  .resizer { width: 6px; background: var(--vscode-panel-border); cursor: col-resize; flex: none; user-select: none; transition: background 0.15s; z-index: 10; }
  .resizer:hover, .resizer.dragging { background: var(--vscode-focusBorder, #007acc); }

  /* Vertical Drag Resizer */
  .v-resizer { height: 6px; background: var(--vscode-panel-border); cursor: row-resize; flex: none; user-select: none; transition: background 0.15s; z-index: 10; }
  .v-resizer:hover, .v-resizer.v-dragging { background: var(--vscode-focusBorder, #007acc); }

  table { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: fixed; }
  th { background: var(--vscode-editor-background); padding: 8px 12px; text-align: left; font-weight: 600; position: sticky; top: 0; z-index: 1; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  td { padding: 6px 12px; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Column resize handles */
  .col-resize-handle { position: absolute; top: 0; right: 0; bottom: 0; width: 6px; cursor: col-resize; z-index: 2; user-select: none; }
  .col-resize-handle:hover, .col-resize-handle.resizing { background: var(--vscode-focusBorder, #007acc); }

  .ep-row { cursor: pointer; }
  .ep-row:hover:not(.selected) { background: var(--vscode-list-hoverBackground); }
  .ep-row.selected { background: #0060C0; color: #ffffff; }
  td.id-cell { font-family: var(--vscode-editor-font-family); font-size: 12px; }

  .row-removed { color: var(--vscode-descriptionForeground); opacity: 0.7; }
  .row-added { color: #58a6ff; }
  .diff-arrow-up { color: #f85149; font-weight: bold; }
  .diff-arrow-down { color: #3fb950; font-weight: bold; }
  .diff-arrow-neutral { color: var(--vscode-descriptionForeground); font-weight: bold; }
  .diff-badge-added { background: #1f6beb; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; }
  .diff-badge-removed { background: #484f58; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; }
  
  .schema-header { padding: 8px 12px; font-size: 12px; font-weight: 600; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); position: sticky; top: 0; z-index: 1; flex: none; }
  .schema-content { flex: 1; min-height: 80px; overflow: auto; }
  .schema-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .schema-table th { padding: 6px 12px; text-align: left; position: sticky; top: 0; background: var(--vscode-editorWidget-background); border-bottom: 1px solid var(--vscode-panel-border); }
  .schema-table td { padding: 4px 12px; border-bottom: none; }
  .schema-row { font-family: var(--vscode-editor-font-family); }
  .indent { display: inline-block; width: 16px; }
  .expand-icon { cursor: pointer; display: inline-block; width: 16px; text-align: center; color: var(--vscode-descriptionForeground); user-select: none; font-weight: bold; }
  .type-icon { display: inline-block; width: 24px; text-align: center; font-weight: bold; font-size: 10px; margin-right: 8px; color: var(--vscode-descriptionForeground); opacity: 0.8; }
  .stability-STABLE { color: #3fb950; }
  .stability-VOLATILE { color: #f85149; }
  .stability-RARE { color: var(--vscode-descriptionForeground); opacity: 0.7; }
  
  .status-dist-container { flex: 1; min-height: 100px; overflow: auto; border-top: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; }
  .status-dist-header { padding: 8px 12px; font-size: 12px; font-weight: 600; flex: none; }
  .status-dist-body { padding: 0 12px 12px 12px; display: flex; flex-direction: row; gap: 16px; flex: 1; overflow: auto; }
  .status-dist-col { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .status-dist-col + .status-dist-col { border-left: 1px solid var(--vscode-panel-border); padding-left: 16px; }
  .status-dist-subhead { font-size: 11px; font-weight: 600; color: var(--vscode-descriptionForeground); text-transform: uppercase; margin-top: 4px; margin-bottom: 2px; }
  .status-code-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .status-code-label { width: 45px; font-weight: 600; font-family: var(--vscode-editor-font-family); }
  .status-code-pct { width: 45px; text-align: right; font-weight: 500; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .bar-wrapper { flex: 1; background: var(--vscode-editor-background); height: 14px; border-radius: 2px; overflow: hidden; display: flex; }
  .bar-segment { height: 100%; }
  .bar-segment-200 { background: #3fb950; }
  .bar-segment-400 { background: #d29922; }
  .bar-segment-500 { background: #f85149; }
  
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 20px; font-size: 12px; text-align: center; }
</style>
</head>
<body>

${mismatchWarning ? `<div class="warning-banner">Configuration mismatch: snapshot configurations do not match and may lead to inconsistent results. Re-running the baseline with the target's configuration is recommended.</div>` : ''}

<table class="diff-header-table">
  <thead>
    <tr><th></th><th>Baseline</th><th>Target</th></tr>
  </thead>
  <tbody>
    <tr><td>Tag</td><td>${escHtml(bTag)}</td><td>${escHtml(cTag)}</td></tr>
    <tr><td>Date / Time</td><td>${escHtml(bStart)}</td><td>${escHtml(cStart)}</td></tr>
    <tr><td>Total Requests</td><td>${baseline.meta.total_requests.toLocaleString()}</td><td>${compare.meta.total_requests.toLocaleString()}</td></tr>
    <tr><td>Peak RPS</td><td>${baseline.meta.peak_rps.toFixed(1)} r/s</td><td>${compare.meta.peak_rps.toFixed(1)} r/s</td></tr>
    <tr><td>Profile</td><td>${escHtml(baseline.meta.profile_name || '—')}</td><td>${escHtml(compare.meta.profile_name || '—')}</td></tr>
    <tr><td>Config Hash</td><td>${bHash}</td><td>${cHash}</td></tr>
  </tbody>
</table>

<div class="legend">
  <div class="legend-item"><span class="dot dot-regression"></span> Regression</div>
  <div class="legend-item"><span class="dot dot-warning"></span> Payload Warning</div>
  <div class="legend-item"><span class="dot dot-improvement"></span> Improvement</div>
  <div class="legend-item"><span class="dot dot-added"></span> Added</div>
  <div class="legend-item"><span class="dot dot-removed"></span> Removed</div>
</div>

<div class="split" id="splitPane">
  <div class="pane left" id="leftPane">
    <div class="toolbar">
      <div class="search-box">
        <span style="opacity: 0.5; margin-right: 6px;">🔍</span>
        <input type="text" id="searchInput" placeholder="Filter endpoints..." />
      </div>
      <button class="btn" id="columnsBtn">Columns ▾</button>
      <div class="columns-menu" id="columnsMenu">
        ${COLUMNS.map((c) => `<label><input type="checkbox" ${enabledColumns.has(c.id) ? 'checked' : ''} data-col="${c.id}"> ${escHtml(c.label)}</label>`).join('')}
      </div>
    </div>
    <div class="table-wrap">
      <table id="mainTable">
        <thead>
          <tr>
            <th>Endpoint</th>
            ${COLUMNS.map((c) => `<th class="${c.id}"${enabledColumns.has(c.id) ? '' : ' style="display:none"'}>${escHtml(c.label)}</th>`).join('')}
          </tr>
        </thead>
        <tbody id="epTable">
          ${epMap.map((d, i) => {
            let rowClass = 'ep-row';
            if (d.state === 'REMOVED') rowClass += ' row-removed';
            if (d.state === 'ADDED') rowClass += ' row-added';

            return `
            <tr class="${rowClass}" data-idx="${i}" data-search="${escHtml(d.label.toLowerCase())}">
              <td class="id-cell" title="${escHtml(d.label)}">${escHtml(d.label)}</td>
              ${COLUMNS.map((c) => `<td class="${c.id}"${enabledColumns.has(c.id) ? '' : ' style="display:none"'}>${deltaCell(c.id, c.higherIsBad, d.baseline, d.compare)}</td>`).join('')}
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>
  <div class="resizer" id="dragResizer"></div>
  <div class="pane right" id="detail">
    <div class="empty" style="margin-top: 40px;">Select an endpoint to see comparative details.</div>
  </div>
</div>

<script nonce="${nonce}">
(function () {
  const vscodeApi = acquireVsCodeApi();
  const diffs = ${JSON.stringify(diffs)};

  function pct(n) { return (n * 100).toFixed(0) + '%'; }

  // Makes each <th> in a table individually drag-resizable. Freezes the
  // browser's auto-computed widths first so switching to table-layout:fixed
  // doesn't reflow the initial render.
  function initResizableColumns(table) {
    if (!table || table.dataset.resizableInit) return;
    table.dataset.resizableInit = '1';
    const ths = Array.from(table.querySelectorAll('thead th'));
    ths.forEach(th => {
      th.style.width = (th.offsetWidth || 120) + 'px';
      const handle = document.createElement('span');
      handle.className = 'col-resize-handle';
      th.appendChild(handle);

      let startX = 0;
      let startWidth = 0;

      const onMove = (ev) => {
        const newWidth = Math.max(40, startWidth + (ev.clientX - startX));
        th.style.width = newWidth + 'px';
      };
      const onUp = () => {
        handle.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };

      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startX = e.clientX;
        startWidth = th.offsetWidth;
        handle.classList.add('resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  
  function getTypeIcon(type) {
    if (type === 'object') return '{}';
    if (type === 'string') return '≡';
    if (type === 'number') return '123';
    if (type === 'boolean') return '10|01';
    if (type === 'array') return '[]';
    return '?';
  }

  function buildTree(baseFields, cmpFields) {
    const root = { children: {} };
    const allKeys = new Set([...Object.keys(baseFields), ...Object.keys(cmpFields)]);
    
    for (const key of allKeys) {
      const parts = key.split('.');
      let current = root;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!current.children[p]) {
          current.children[p] = { name: p, children: {}, fullPath: parts.slice(0, i+1).join('.') };
        }
        if (i === parts.length - 1) {
          if (baseFields[key]) current.children[p].base = baseFields[key];
          if (cmpFields[key]) current.children[p].cmp = cmpFields[key];
        }
        current = current.children[p];
      }
    }
    return root;
  }

  function renderTreeNodes(node, depth = 0) {
    let html = '';
    const keys = Object.keys(node.children || {}).sort();
    for (const k of keys) {
      const child = node.children[k];
      const hasChildren = Object.keys(child.children || {}).length > 0;
      
      const bField = child.base;
      const cField = child.cmp;
      const fieldData = cField || bField || {};
      
      const stab = fieldData.stability || 'RARE';
      const typeStr = fieldData.type || (hasChildren ? 'object' : 'unknown');
      
      const indent = '<span class="indent"></span>'.repeat(depth);
      const expand = hasChildren ? '<span class="expand-icon">▼</span>' : '<span class="expand-icon"></span>';
      
      let presenceHtml = '—';
      if (cField && cField.presence !== undefined) {
        presenceHtml = pct(cField.presence);
        if (bField && bField.presence !== undefined) {
          const delta = cField.presence - bField.presence;
          if (Math.abs(delta) > 0.01) {
            const pp = (delta * 100).toFixed(0) + 'pp';
            if (delta > 0) {
              presenceHtml += ' <span class="diff-arrow-up">▲' + pp + '</span>';
            } else {
              presenceHtml += ' <span class="diff-arrow-down">▼' + (-delta * 100).toFixed(0) + 'pp</span>';
            }
          }
        }
      } else if (bField && !cField) {
        presenceHtml = '0% <span class="diff-arrow-down">▼' + (bField.presence * 100).toFixed(0) + 'pp</span>';
      }

      html += '<tr class="schema-row" data-path="' + escHtml(child.fullPath) + '">';
      html += '<td>' + indent + expand + '<span class="type-icon">' + getTypeIcon(typeStr) + '</span>' + escHtml(k) + '</td>';
      html += '<td>' + typeStr + '</td>';
      html += '<td>' + presenceHtml + '</td>';
      html += '<td class="stability-' + stab + '">' + stab + '</td>';
      html += '</tr>';
      
      if (hasChildren) {
        html += renderTreeNodes(child, depth + 1);
      }
    }
    return html;
  }

  function renderStatusBlock(label, statusDist, errRate) {
    const rawStatuses = Object.entries(statusDist || {});
    let list = [];
    let sum = 0;
    
    for (const [k, v] of rawStatuses) {
      let code = k;
      if (code === '0' || code.toLowerCase() === 'err') {
        code = 'ERR';
      }
      list.push([code, v]);
      sum += v;
    }
    
    const errInList = list.some(([c]) => c === 'ERR');
    if (!errInList && ((errRate || 0) > 0 || sum < 0.99)) {
      const impliedErr = Math.max(errRate || 0, Math.max(0, 1.0 - sum));
      if (impliedErr > 0.001) {
        list.push(['ERR', impliedErr]);
      }
    }

    list.sort((a, b) => b[1] - a[1]);
    
    let html = '<div class="status-dist-subhead">' + label + '</div>';
    let hasErr = false;
    
    if (list.length) {
      for (const [code, p] of list) {
        if (code === 'ERR') hasErr = true;
        const cls = code.startsWith('5') || code === 'ERR' ? 'bar-segment-500' : code.startsWith('4') ? 'bar-segment-400' : 'bar-segment-200';
        
        html += '<div class="status-code-row">';
        html += '  <div class="status-code-label">' + code + '</div>';
        html += '  <div class="bar-wrapper"><div class="bar-segment ' + cls + '" style="width: ' + (p * 100) + '%;"></div></div>';
        html += '  <div class="status-code-pct">' + pct(p) + '</div>';
        html += '</div>';
      }
    } else {
      html += '<div class="empty" style="padding: 4px 0; text-align: left;">No status data recorded.</div>';
    }
    
    return { html, hasErr: hasErr || (errRate || 0) > 0 };
  }

  function renderDetail(epDiff) {
    const detail = document.getElementById('detail');
    if (!detail) return;
    let html = '';

    let schemaBody = '<div class="empty" style="margin-top: 40px;">No schema data.</div>';
    if (Object.keys(epDiff.baseSchema).length > 0 || Object.keys(epDiff.cmpSchema).length > 0) {
      const tree = buildTree(epDiff.baseSchema, epDiff.cmpSchema);
      schemaBody = '<table class="schema-table"><thead><tr><th>Field</th><th>Type</th><th>Presence %</th><th>Stability</th></tr></thead><tbody>' +
        renderTreeNodes(tree) +
        '</tbody></table>';
    }
    
    let schemaHeader = '<div class="schema-header">Inferred JSON Schema (Combined)</div>';
    if (epDiff.cmpBodyStored !== undefined && epDiff.cmpBodyObserved !== undefined && epDiff.cmpBodyObserved > 0) {
      const pctVal = Math.round((epDiff.cmpBodyStored / epDiff.cmpBodyObserved) * 100);
      schemaHeader += '<div style="padding: 4px 12px; font-size: 11px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border);">Target Body Samples: ' + epDiff.cmpBodyStored + ' stored / ' + epDiff.cmpBodyObserved + ' observed (' + pctVal + '% of traffic sampled)</div>';
    }
    
    html += schemaHeader;
    html += '<div class="schema-content" id="schemaContent">' + schemaBody + '</div>';
    html += '<div class="v-resizer" id="vDragResizer"></div>';

    html += '<div class="status-dist-container" id="statusContainer">';
    html += '<div class="status-dist-header">Status Code Distribution</div>';
    html += '<div class="status-dist-body">';

    const baseRes = renderStatusBlock('Baseline', epDiff.baseStatus, epDiff.baseErrorRate);
    const cmpRes = renderStatusBlock('Target', epDiff.cmpStatus, epDiff.cmpErrorRate);

    html += '<div class="status-dist-col">' + baseRes.html + '</div>';
    html += '<div class="status-dist-col">' + cmpRes.html + '</div>';

    html += '</div>';

    if (baseRes.hasErr || cmpRes.hasErr) {
      html += '<div style="padding: 0 12px 12px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">* ERR - connection failures (timeouts, refused, DNS) with no HTTP status code</div>';
    }

    html += '</div>';

    detail.innerHTML = html;
    initVResizer();
    initResizableColumns(detail.querySelector('.schema-table'));
  }

  function initVResizer() {
    const vResizer = document.getElementById('vDragResizer');
    const schemaContent = document.getElementById('schemaContent');
    const detailPane = document.getElementById('detail');
    if (!vResizer || !schemaContent || !detailPane) return;

    let isVDragging = false;
    vResizer.addEventListener('mousedown', (e) => {
      isVDragging = true;
      vResizer.classList.add('v-dragging');
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!isVDragging) return;
      const rect = detailPane.getBoundingClientRect();
      const topHeight = e.clientY - rect.top - 30;
      const pctVal = Math.max(20, Math.min(80, (topHeight / rect.height) * 100));
      schemaContent.style.height = pctVal + '%';
      schemaContent.style.flex = 'none';
    });
    document.addEventListener('mouseup', () => {
      if (isVDragging) {
        isVDragging = false;
        vResizer.classList.remove('v-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  // Delegated click event listener for Schema tree expand/collapse
  document.getElementById('detail')?.addEventListener('click', function(e) {
    const expandBtn = e.target.closest('.expand-icon');
    if (!expandBtn || !expandBtn.innerText) return;
    const row = expandBtn.closest('.schema-row');
    if (!row) return;
    const path = row.getAttribute('data-path');
    if (!path) return;

    const isExpanded = expandBtn.innerText === '▼';
    expandBtn.innerText = isExpanded ? '▶' : '▼';

    const allRows = document.querySelectorAll('.schema-row');
    allRows.forEach(r => {
      const rPath = r.getAttribute('data-path');
      if (rPath && rPath.startsWith(path + '.')) {
        r.style.display = isExpanded ? 'none' : 'table-row';
      }
    });
  });

  // Table Row selection
  document.querySelectorAll('.ep-row').forEach((row) => {
    row.addEventListener('click', () => {
      document.querySelectorAll('.ep-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      const idx = parseInt(row.getAttribute('data-idx') || '-1');
      if (idx >= 0 && idx < diffs.length) {
        renderDetail(diffs[idx]);
      }
    });
  });

  // Search filtering
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll('.ep-row').forEach((row) => {
        const text = row.getAttribute('data-search') || '';
        row.style.display = text.includes(q) ? 'table-row' : 'none';
      });
    });
  }

  // Columns toggle menu
  const columnsBtn = document.getElementById('columnsBtn');
  const columnsMenu = document.getElementById('columnsMenu');
  if (columnsBtn && columnsMenu) {
    columnsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      columnsMenu.classList.toggle('open');
    });
    document.addEventListener('click', () => columnsMenu.classList.remove('open'));
    columnsMenu.querySelectorAll('input').forEach(cb => {
      cb.addEventListener('change', () => {
        const colClass = cb.getAttribute('data-col');
        const show = cb.checked;
        document.querySelectorAll('.' + colClass).forEach(el => {
          el.style.display = show ? '' : 'none';
        });
        const enabled = Array.from(columnsMenu.querySelectorAll('input'))
          .filter(i => i.checked)
          .map(i => i.getAttribute('data-col'));
        vscodeApi.postMessage({ type: 'columnsChanged', columns: enabled });
      });
    });
  }

  // Drag Resizer (Horizontal)
  const resizer = document.getElementById('dragResizer');
  const leftPane = document.getElementById('leftPane');
  if (resizer && leftPane) {
    let isDragging = false;
    resizer.addEventListener('mousedown', (e) => {
      isDragging = true;
      resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const splitPane = document.getElementById('splitPane');
      if (!splitPane) return;
      const rect = splitPane.getBoundingClientRect();
      const leftWidth = e.clientX - rect.left;
      const pctVal = Math.max(15, Math.min(85, (leftWidth / rect.width) * 100));
      leftPane.style.width = pctVal + '%';
    });
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  initResizableColumns(document.getElementById('mainTable'));

  if (diffs.length > 0) {
    document.querySelector('.ep-row')?.click();
  }
})();
</script>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
