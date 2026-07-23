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

interface ViewEndpointData {
  label: string;
  errorRate: number;
  errorPct: string;
  p95: number;
  payloadAvg: string;
  requests: number;
  statusDist: Record<string, number>;
  bodyStored?: number;
  bodyObserved?: number;
  schema?: { fields: Record<string, { type: string; presence: number; stability?: string }> };
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function buildSnapViewHtml(
  webview: vscode.Webview,
  snap: LoadedSnap,
  tag: string,
): string {
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
    errorRate: ep.error_rate || 0,
    errorPct: (ep.error_rate * 100).toFixed(2),
    p95: ep.latency.p95,
    payloadAvg: formatBytes(ep.payload_size?.avg),
    requests: endpointRequestCount(ep),
    statusDist: ep.status_dist || {},
    bodyStored: ep.body_samples_stored,
    bodyObserved: ep.body_samples_observed,
    schema: ep.schema ? { fields: ep.schema.fields } : undefined,
  }));

  const startTime = snap.meta.start_time.replace('T', ' ');
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
  
  /* Toolbar styling */
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; position: relative; }
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
  .left { width: 55%; min-width: 200px; max-width: 80%; flex: none; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); display: flex; flex-direction: column; }
  .right { flex: 1; min-width: 200px; display: flex; flex-direction: column; background: var(--vscode-editorWidget-background); overflow: hidden; }
  
  /* Horizontal Drag Resizer */
  .resizer { width: 6px; background: var(--vscode-panel-border); cursor: col-resize; flex: none; user-select: none; transition: background 0.15s; z-index: 10; }
  .resizer:hover, .resizer.dragging { background: var(--vscode-focusBorder, #007acc); }

  /* Vertical Drag Resizer */
  .v-resizer { height: 6px; background: var(--vscode-panel-border); cursor: row-resize; flex: none; user-select: none; transition: background 0.15s; z-index: 10; }
  .v-resizer:hover, .v-resizer.v-dragging { background: var(--vscode-focusBorder, #007acc); }

  /* Table styling */
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: var(--vscode-editor-background); padding: 8px 12px; text-align: left; font-weight: 600; position: sticky; top: 0; z-index: 1; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
  td { padding: 6px 12px; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
  
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
      <div class="label">PROFILE</div>
      <div class="value">(legacy — no profile recorded)</div>
    </div>
    <div class="header-item">
      <div class="label">TOTAL REQUESTS</div>
      <div class="value">${snap.meta.total_requests.toLocaleString()}</div>
    </div>
    <div class="header-item">
      <div class="label">CONFIG HASH</div>
      <div class="value">${configHash}</div>
    </div>
    <div class="header-item">
      <div class="label">PEAK RPS</div>
      <div class="value">${snap.meta.peak_rps.toFixed(1)} r/s</div>
    </div>
    <div class="header-item">
      <div class="label">SAMPLING</div>
      <div class="value">${sampling}</div>
    </div>
  </div>
</div>

<div class="toolbar">
  <div class="search-box">
    <span style="opacity: 0.5; margin-right: 6px;">🔍</span>
    <input type="text" id="searchInput" placeholder="Filter endpoints..." />
  </div>
  <button class="btn" id="columnsBtn">Columns ▾</button>
  <div class="columns-menu" id="columnsMenu">
    <label><input type="checkbox" checked data-col="col-err"> Error Rate</label>
    <label><input type="checkbox" checked data-col="col-p95"> P95 Latency</label>
    <label><input type="checkbox" checked data-col="col-payload"> Payload Avg</label>
  </div>
</div>

<div class="split" id="splitPane">
  <div class="pane left" id="leftPane">
    <table id="mainTable">
      <thead><tr>
        <th>Endpoint</th>
        <th class="col-err">Error Rate</th>
        <th class="col-p95">P95</th>
        <th class="col-payload">Payload Avg</th>
      </tr></thead>
      <tbody id="epTable">
        ${eps.map((ep, i) => `
        <tr class="ep-row" data-idx="${i}" data-search="${escHtml(ep.label.toLowerCase())}">
          <td class="id-cell" title="${escHtml(ep.label)}">${escHtml(ep.label)}</td>
          <td class="col-err">${ep.errorPct}%</td>
          <td class="col-p95">${ep.p95} ms</td>
          <td class="col-payload">${ep.payloadAvg}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${eps.length === 0 ? '<div class="empty">No endpoints recorded in this snapshot.</div>' : ''}
  </div>
  <div class="resizer" id="dragResizer"></div>
  <div class="pane right" id="detail">
    <div class="empty" style="margin-top: 40px;">Select an endpoint to see details.</div>
  </div>
</div>

<script nonce="${nonce}">
(function () {
  const eps = ${JSON.stringify(eps)};

  function pct(n) { return (n * 100).toFixed(0) + '%'; }
  
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
