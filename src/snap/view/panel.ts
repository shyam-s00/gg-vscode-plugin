import * as vscode from 'vscode';

import { getNonce, readTemplate, resolveAssetUris } from '../../webview/webviewAssets';
import { getExtensionUri, getSnapDetailPanel, getSnapViewColumnPrefs, setSnapViewColumnPrefs } from '../snapDetailPanel';
import { endpointRequestCount } from '../snapModel';
import type { LoadedSnap, SnapEndpoint } from '../snapModel';

// ─────────────────────────────────────────────────────────────────────────────
// Public helpers — exported for testing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats an endpoint id ("METHOD:url") as "METHOD /path" for compact display.
 * Falls back to the raw id if the URL portion cannot be parsed.
 */
export function formatEndpointId(id: string): string {
  const colon = id.indexOf(':');
  if (colon < 0) {
    return id;
  }
  const method = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  try {
    const url = new URL(rest);
    return `${method} ${url.pathname}${url.search}`;
  } catch {
    return `${method} ${rest}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────────────

let _msgListener: vscode.Disposable | undefined;

/** Shows a single `.snap` file's contents in the shared snap detail panel. */
export function showSnapView(snap: LoadedSnap): void {
  const tag = snap.meta.tag.trim() || '(untagged)';
  const panel = getSnapDetailPanel(`Snapshot: ${tag}`);

  _msgListener?.dispose();
  _msgListener = panel.webview.onDidReceiveMessage((message: { type?: string; columns?: string[] }) => {
    if (message?.type === 'columnsChanged' && Array.isArray(message.columns)) {
      setSnapViewColumnPrefs(message.columns);
    }
  });

  panel.webview.html = buildSnapViewHtml(panel.webview, getExtensionUri(), snap, tag, getSnapViewColumnPrefs());
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML — exported for smoke-testing template correctness
// ─────────────────────────────────────────────────────────────────────────────

export interface ViewEndpointData {
  label: string;
  requests: number;
  errorRate: number;
  errorPct: string;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  payloadAvg: string;
  payloadP95: string;
  payloadMax: string;
  statusDist: Record<string, number>;
  bodyStored?: number;
  bodyObserved?: number;
  schema?: { fields: Record<string, { type: string; presence: number; stability?: string }> };
}

/** Toggleable table columns, in display order. "Endpoint" is always shown and isn't part of this list. */
const COLUMNS: { id: string; label: string }[] = [
  { id: 'col-requests', label: 'Requests' },
  { id: 'col-err', label: 'Error Rate' },
  { id: 'col-p99', label: 'P99' },
  { id: 'col-p95', label: 'P95' },
  { id: 'col-p50', label: 'P50' },
  { id: 'col-max', label: 'Max' },
  { id: 'col-payload-avg', label: 'Payload Avg' },
  { id: 'col-payload-p95', label: 'Payload P95' },
  { id: 'col-payload-max', label: 'Payload Max' },
];

function cellValue(colId: string, ep: ViewEndpointData): string {
  switch (colId) {
    case 'col-requests': return ep.requests.toLocaleString();
    case 'col-err': return ep.errorPct + '%';
    case 'col-p99': return ep.p99 + ' ms';
    case 'col-p95': return ep.p95 + ' ms';
    case 'col-p50': return ep.p50 + ' ms';
    case 'col-max': return ep.max + ' ms';
    case 'col-payload-avg': return ep.payloadAvg;
    case 'col-payload-p95': return ep.payloadP95;
    case 'col-payload-max': return ep.payloadMax;
    default: return '';
  }
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '—';
  if (bytes < 1024) return bytes.toFixed(2) + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/** Formats an ISO timestamp as "Jul 9, 2026 12:38:56" (local time). */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return iso.replace('T', ' ');
  }
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function buildSnapViewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  snap: LoadedSnap,
  tag: string,
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

  const eps: ViewEndpointData[] = snap.endpoints.map((ep: SnapEndpoint) => ({
    label: formatEndpointId(ep.id),
    requests: endpointRequestCount(ep),
    errorRate: ep.error_rate || 0,
    errorPct: (ep.error_rate * 100).toFixed(2),
    p50: ep.latency.p50,
    p95: ep.latency.p95,
    p99: ep.latency.p99,
    max: ep.latency.max,
    payloadAvg: formatBytes(ep.payload_size?.avg),
    payloadP95: formatBytes(ep.payload_size?.p95),
    payloadMax: formatBytes(ep.payload_size?.max),
    statusDist: ep.status_dist || {},
    bodyStored: ep.body_samples_stored,
    bodyObserved: ep.body_samples_observed,
    schema: ep.schema ? { fields: ep.schema.fields } : undefined,
  }));

  const startTime = formatDateTime(snap.meta.start_time);
  const configHash = snap.meta.config_hash ? snap.meta.config_hash.substring(0, 12) + '...' : '—';
  const sampling = snap.meta.snap_settings?.sample_rate !== undefined
    ? (snap.meta.snap_settings.sample_rate * 100) + '%'
    : '—';

  const columnsMenu = COLUMNS.map((c) => `<label><input type="checkbox" ${enabledColumns.has(c.id) ? 'checked' : ''} data-col="${c.id}"> ${escHtml(c.label)}</label>`).join('');
  const tableHeaderCols = COLUMNS.map((c) => `<th class="${c.id}"${enabledColumns.has(c.id) ? '' : ' style="display:none"'}>${escHtml(c.label)}</th>`).join('');
  const tableRows = eps.map((ep, i) => `
          <tr class="ep-row" data-idx="${i}" data-search="${escHtml(ep.label.toLowerCase())}">
            <td class="id-cell" title="${escHtml(ep.label)}">${escHtml(ep.label)}</td>
            ${COLUMNS.map((c) => `<td class="${c.id}"${enabledColumns.has(c.id) ? '' : ' style="display:none"'}>${cellValue(c.id, ep)}</td>`).join('')}
          </tr>`).join('');
  const emptyMessage = eps.length === 0 ? '<div class="empty">No endpoints recorded in this snapshot.</div>' : '';

  const { css, js } = resolveAssetUris(webview, extensionUri, 'snap/view', true);

  return readTemplate(extensionUri, 'snap/view', 'view.html')
    .replace('{{CSP}}', csp)
    .replace('{{CSS_URI}}', css.toString())
    .replace('{{TAG}}', escHtml(tag))
    .replace('{{DATE_TIME}}', escHtml(startTime))
    .replace('{{TOTAL_REQUESTS}}', snap.meta.total_requests.toLocaleString())
    .replace('{{PEAK_RPS}}', `${snap.meta.peak_rps.toFixed(1)} r/s`)
    .replace('{{PROFILE}}', escHtml(snap.meta.profile_name || '(legacy — no profile recorded)'))
    .replace('{{CONFIG_HASH}}', configHash)
    .replace('{{SAMPLING}}', sampling)
    .replace('{{COLUMNS_MENU}}', columnsMenu)
    .replace('{{TABLE_HEADER_COLS}}', tableHeaderCols)
    .replace('{{TABLE_ROWS}}', tableRows)
    .replace('{{EMPTY_MESSAGE}}', emptyMessage)
    .replace(/\{\{NONCE\}\}/g, nonce)
    .replace('{{EPS_JSON}}', JSON.stringify(eps))
    .replace('{{JS_URI}}', js!.toString());
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
