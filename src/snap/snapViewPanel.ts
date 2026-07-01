import * as vscode from 'vscode';

import { getSnapDetailPanel } from './snapDetailPanel';
import { endpointRequestCount } from './snapModel';
import type { LoadedSnap, SnapEndpoint } from './snapModel';

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

/** Shows a single `.snap` file's contents in the shared snap detail panel. */
export function showSnapView(snap: LoadedSnap): void {
  const tag = snap.meta.tag.trim() || '(untagged)';
  const panel = getSnapDetailPanel(`Snapshot: ${tag}`);
  panel.webview.html = buildSnapViewHtml(panel.webview, snap, tag);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML — exported for smoke-testing template correctness
// ─────────────────────────────────────────────────────────────────────────────

/** Serialised form of an endpoint passed to the webview. */
interface ViewEndpointData {
  label: string;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  errorPct: string;
  requests: number;
  statusDist: Record<string, number>;
  schema?: { fields: Record<string, { type: string; presence: number; stability?: string }> };
}

export function buildSnapViewHtml(
  webview: vscode.Webview,
  snap: LoadedSnap,
  tag: string,
): string {
  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  const eps: ViewEndpointData[] = snap.endpoints.map((ep: SnapEndpoint) => ({
    label: formatEndpointId(ep.id),
    p50: ep.latency.p50,
    p95: ep.latency.p95,
    p99: ep.latency.p99,
    max: ep.latency.max,
    errorPct: (ep.error_rate * 100).toFixed(2),
    requests: endpointRequestCount(ep),
    statusDist: ep.status_dist,
    schema: ep.schema
      ? { fields: ep.schema.fields }
      : undefined,
  }));

  const metaLine = [
    `Started: ${snap.meta.start_time.slice(0, 16).replace('T', ' ')}`,
    `Ended: ${snap.meta.end_time.slice(0, 16).replace('T', ' ')}`,
    `Peak RPS: ${snap.meta.peak_rps}`,
    `Total: ${snap.meta.total_requests.toLocaleString()} requests`,
  ].join('  ·  ');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 12px 16px; }
  .header { margin-bottom: 10px; }
  .header h2 { margin: 0 0 3px 0; font-size: 15px; }
  .header .meta { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .split { display: flex; gap: 12px; height: calc(100vh - 70px); }
  .pane { overflow: auto; }
  .left { flex: 0 0 55%; }
  .right { flex: 1; border-left: 1px solid var(--vscode-panel-border); padding-left: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: var(--vscode-editorWidget-background); padding: 6px 8px; text-align: left; font-weight: 600; position: sticky; top: 0; z-index: 1; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
  td { padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
  .ep-row { cursor: pointer; }
  .ep-row:hover:not(.selected) { background: var(--vscode-list-hoverBackground); }
  .ep-row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  td.id-cell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; font-family: var(--vscode-editor-font-family); font-size: 11px; }
  .bad { color: #f85149; }
  .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--vscode-descriptionForeground); letter-spacing: 0.5px; margin: 12px 0 6px 0; }
  .status-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .schema-table th, .schema-table td { padding: 4px 8px; }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 12px 0; font-size: 12px; }
  .stability-STABLE { color: #3fb950; }
  .stability-VOLATILE { color: #f85149; }
</style>
</head>
<body>
<div class="header">
  <h2>Snapshot: ${escHtml(tag)}</h2>
  <div class="meta">${escHtml(metaLine)}</div>
</div>
<div class="split">
  <div class="pane left">
    <table>
      <thead><tr>
        <th>Endpoint</th>
        <th>p50</th><th>p95</th><th>p99</th><th>max</th>
        <th>Error%</th><th>Requests</th>
      </tr></thead>
      <tbody id="epTable">
        ${eps.map((ep, i) => `
        <tr class="ep-row" data-idx="${i}">
          <td class="id-cell" title="${escHtml(ep.label)}">${escHtml(ep.label)}</td>
          <td>${ep.p50}ms</td><td>${ep.p95}ms</td><td>${ep.p99}ms</td><td>${ep.max}ms</td>
          <td class="${parseFloat(ep.errorPct) > 0 ? 'bad' : ''}">${ep.errorPct}%</td>
          <td>${ep.requests.toLocaleString()}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${eps.length === 0 ? '<div class="empty">No endpoints recorded in this snapshot.</div>' : ''}
  </div>
  <div class="pane right" id="detail">
    <div class="empty">Select an endpoint to see details.</div>
  </div>
</div>
<script nonce="${nonce}">
(function () {
  const eps = ${JSON.stringify(eps)};
  let current = -1;

  function pct(n) { return (n * 100).toFixed(1) + '%'; }

  function renderDetail(ep) {
    const detail = document.getElementById('detail');
    let html = '';

    html += '<div class="section-title">Status Distribution</div>';
    const statuses = Object.entries(ep.statusDist).sort((a, b) => b[1] - a[1]);
    if (statuses.length) {
      html += statuses.map(([code, frac]) =>
        '<div class="status-row"><span>' + code + '</span><span>' + pct(frac) + '</span></div>'
      ).join('');
    } else {
      html += '<div class="empty">No status data.</div>';
    }

    if (ep.schema && Object.keys(ep.schema.fields).length > 0) {
      html += '<div class="section-title" style="margin-top:16px">Inferred Schema</div>';
      html += '<table class="schema-table"><thead><tr><th>Field</th><th>Type</th><th>Presence</th><th>Stability</th></tr></thead><tbody>';
      for (const [name, f] of Object.entries(ep.schema.fields)) {
        const stab = f.stability || '';
        html += '<tr><td>' + name + '</td><td>' + f.type + '</td><td>' + pct(f.presence) +
          '</td><td class="stability-' + stab + '">' + (stab || '—') + '</td></tr>';
      }
      html += '</tbody></table>';
    }

    detail.innerHTML = html;
  }

  document.querySelectorAll('.ep-row').forEach((row, i) => {
    row.addEventListener('click', () => {
      document.querySelectorAll('.ep-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      current = i;
      renderDetail(eps[i]);
    });
  });

  if (eps.length > 0) {
    document.querySelector('.ep-row')?.click();
  }
})();
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

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
