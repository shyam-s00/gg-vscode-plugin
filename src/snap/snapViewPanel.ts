import * as vscode from 'vscode';

import { getSnapDetailPanel, getSnapViewColumnPrefs, setSnapViewColumnPrefs } from './snapDetailPanel';
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

  panel.webview.html = buildSnapViewHtml(panel.webview, snap, tag, getSnapViewColumnPrefs());
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML — exported for smoke-testing template correctness
// ─────────────────────────────────────────────────────────────────────────────

interface ViewEndpointData {
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

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  
  /* Header styling */
  .header { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
  .header-top h2 { margin: 0; font-size: 14px; display: flex; align-items: center; gap: 8px; }
  .header-top h2::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #3fb950; }
  
  .header-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--vscode-panel-border); }
  .header-item { display: flex; flex-direction: column; gap: 4px; }
  .header-item .label { font-size: 10px; font-weight: 600; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; }
  .header-item .value { font-size: 13px; font-weight: 500; }
  
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

  /* Main split pane */
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

  /* Table styling */
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
  
  /* Right pane details */
  .schema-header { padding: 8px 12px; font-size: 12px; font-weight: 600; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); position: sticky; top: 0; z-index: 1; flex: none; }
  .schema-content { flex: 1; min-height: 80px; overflow: auto; }
  .status-dist-container { flex: 1; min-height: 100px; overflow: auto; border-top: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; }
  
  /* Schema Tree */
  .schema-table th { padding: 6px 12px; }
  .schema-table td { padding: 4px 12px; border-bottom: none; }
  .schema-row { font-family: var(--vscode-editor-font-family); }
  .indent { display: inline-block; width: 16px; }
  .expand-icon { cursor: pointer; display: inline-block; width: 16px; text-align: center; color: var(--vscode-descriptionForeground); user-select: none; font-weight: bold; }
  .type-icon { display: inline-block; width: 24px; text-align: center; font-weight: bold; font-size: 10px; margin-right: 8px; color: var(--vscode-descriptionForeground); opacity: 0.8; }
  .stability-STABLE { color: #3fb950; }
  .stability-VOLATILE { color: #f85149; }
  .stability-RARE { color: var(--vscode-descriptionForeground); opacity: 0.7; }
  
  /* Separate Status Code Rows */
  .status-dist-header { padding: 8px 12px; font-size: 12px; font-weight: 600; flex: none; }
  .status-dist-body { padding: 0 12px 12px 12px; display: flex; flex-direction: column; gap: 8px; flex: 1; overflow: auto; }
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
<div class="header">
  <div class="header-top">
    <h2>Snap: ${escHtml(tag)}</h2>
  </div>
  <div class="header-grid">
    <div class="header-item">
      <div class="label">DATE / TIME</div>
      <div class="value">${escHtml(startTime)}</div>
    </div>
    <div class="header-item">
      <div class="label">TOTAL REQUESTS</div>
      <div class="value">${snap.meta.total_requests.toLocaleString()}</div>
    </div>
    <div class="header-item">
      <div class="label">PEAK RPS</div>
      <div class="value">${snap.meta.peak_rps.toFixed(1)} r/s</div>
    </div>
    <div class="header-item">
      <div class="label">PROFILE</div>
      <div class="value">(legacy — no profile recorded)</div>
    </div>
    <div class="header-item">
      <div class="label">CONFIG HASH</div>
      <div class="value">${configHash}</div>
    </div>
    <div class="header-item">
      <div class="label">SAMPLING</div>
      <div class="value">${sampling}</div>
    </div>
  </div>
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
        <thead><tr>
          <th>Endpoint</th>
          ${COLUMNS.map((c) => `<th class="${c.id}"${enabledColumns.has(c.id) ? '' : ' style="display:none"'}>${escHtml(c.label)}</th>`).join('')}
        </tr></thead>
        <tbody id="epTable">
          ${eps.map((ep, i) => `
          <tr class="ep-row" data-idx="${i}" data-search="${escHtml(ep.label.toLowerCase())}">
            <td class="id-cell" title="${escHtml(ep.label)}">${escHtml(ep.label)}</td>
            ${COLUMNS.map((c) => `<td class="${c.id}"${enabledColumns.has(c.id) ? '' : ' style="display:none"'}>${cellValue(c.id, ep)}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>
      ${eps.length === 0 ? '<div class="empty">No endpoints recorded in this snapshot.</div>' : ''}
    </div>
  </div>
  <div class="resizer" id="dragResizer"></div>
  <div class="pane right" id="detail">
    <div class="empty" style="margin-top: 40px;">Select an endpoint to see details.</div>
  </div>
</div>

<script nonce="${nonce}">
(function () {
  const vscodeApi = acquireVsCodeApi();
  const eps = ${JSON.stringify(eps)};

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

  function buildTree(fields) {
    const root = { children: {} };
    for (const [key, val] of Object.entries(fields)) {
      const parts = key.split('.');
      let current = root;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!current.children[p]) {
          current.children[p] = { name: p, children: {}, fullPath: parts.slice(0, i+1).join('.') };
        }
        if (i === parts.length - 1) {
          Object.assign(current.children[p], val);
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
      const stab = child.stability || 'RARE';
      
      const indent = '<span class="indent"></span>'.repeat(depth);
      const expand = hasChildren ? '<span class="expand-icon">▼</span>' : '<span class="expand-icon"></span>';
      
      const typeStr = child.type || (hasChildren ? 'object' : 'unknown');
      const presence = child.presence !== undefined ? (child.presence * 100).toFixed(0) + '%' : '—';
      
      html += '<tr class="schema-row" data-path="' + escHtml(child.fullPath) + '">';
      html += '<td>' + indent + expand + '<span class="type-icon">' + getTypeIcon(typeStr) + '</span>' + escHtml(k) + '</td>';
      html += '<td>' + typeStr + '</td>';
      html += '<td>' + presence + '</td>';
      html += '<td class="stability-' + stab + '">' + stab + '</td>';
      html += '</tr>';
      
      if (hasChildren) {
        html += renderTreeNodes(child, depth + 1);
      }
    }
    return html;
  }

  function renderDetail(ep) {
    const detail = document.getElementById('detail');
    if (!detail) return;
    let html = '';

    let schemaBody = '<div class="empty" style="margin-top: 40px;">No schema data.</div>';
    if (ep.schema && ep.schema.fields && Object.keys(ep.schema.fields).length > 0) {
      const tree = buildTree(ep.schema.fields);
      schemaBody = '<table class="schema-table"><thead><tr><th>Field</th><th>Type</th><th>Presence %</th><th>Stability</th></tr></thead><tbody>' +
        renderTreeNodes(tree) +
        '</tbody></table>';
    }
    
    let schemaHeader = '<div class="schema-header">Inferred JSON Schema</div>';
    if (ep.bodyStored !== undefined && ep.bodyObserved !== undefined && ep.bodyObserved > 0) {
      const pctVal = Math.round((ep.bodyStored / ep.bodyObserved) * 100);
      schemaHeader += '<div style="padding: 4px 12px; font-size: 11px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border);">Body Samples: ' + ep.bodyStored + ' stored / ' + ep.bodyObserved + ' observed (' + pctVal + '% of traffic sampled)</div>';
    }
    
    html += schemaHeader;
    html += '<div class="schema-content" id="schemaContent">' + schemaBody + '</div>';
    html += '<div class="v-resizer" id="vDragResizer"></div>';

    html += '<div class="status-dist-container" id="statusContainer">';
    html += '<div class="status-dist-header">Status Code Distribution</div>';
    html += '<div class="status-dist-body">';
    
    // Status Code Calculation (Separate rows for each status code)
    const rawStatuses = Object.entries(ep.statusDist || {});
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
    if (!errInList && (ep.errorRate > 0 || sum < 0.99)) {
      const impliedErr = Math.max(ep.errorRate, Math.max(0, 1.0 - sum));
      if (impliedErr > 0.001) {
        list.push(['ERR', impliedErr]);
      }
    }

    list.sort((a, b) => b[1] - a[1]);
    
    if (list.length) {
      let hasErr = false;
      
      for (const [code, p] of list) {
        if (code === 'ERR') hasErr = true;
        const cls = code.startsWith('5') || code === 'ERR' ? 'bar-segment-500' : code.startsWith('4') ? 'bar-segment-400' : 'bar-segment-200';
        
        html += '<div class="status-code-row">';
        html += '  <div class="status-code-label">' + code + '</div>';
        html += '  <div class="bar-wrapper"><div class="bar-segment ' + cls + '" style="width: ' + (p * 100) + '%;"></div></div>';
        html += '  <div class="status-code-pct">' + pct(p) + '</div>';
        html += '</div>';
      }
      
      if (hasErr || ep.errorRate > 0) {
        html += '<div style="margin-top: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic;">* ERR - connection failures (timeouts, refused, DNS) with no HTTP status code</div>';
      }
    } else {
      html += '<div class="empty" style="padding: 0;">No status data.</div>';
    }
    html += '</div></div>';

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
  document.querySelectorAll('.ep-row').forEach((row, i) => {
    row.addEventListener('click', () => {
      document.querySelectorAll('.ep-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      renderDetail(eps[i]);
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

  if (eps.length > 0) {
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
