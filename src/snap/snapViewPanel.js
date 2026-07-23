"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatEndpointId = formatEndpointId;
exports.showSnapView = showSnapView;
exports.buildSnapViewHtml = buildSnapViewHtml;
const snapDetailPanel_1 = require("./snapDetailPanel");
const snapModel_1 = require("./snapModel");
// ─────────────────────────────────────────────────────────────────────────────
// Public helpers — exported for testing
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Formats an endpoint id ("METHOD:url") as "METHOD /path" for compact display.
 * Falls back to the raw id if the URL portion cannot be parsed.
 */
function formatEndpointId(id) {
    const colon = id.indexOf(':');
    if (colon < 0) {
        return id;
    }
    const method = id.slice(0, colon);
    const rest = id.slice(colon + 1);
    try {
        const url = new URL(rest);
        return `${method} ${url.pathname}${url.search}`;
    }
    catch {
        return `${method} ${rest}`;
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────────────
/** Shows a single `.snap` file's contents in the shared snap detail panel. */
function showSnapView(snap) {
    const tag = snap.meta.tag.trim() || '(untagged)';
    const panel = (0, snapDetailPanel_1.getSnapDetailPanel)(`Snapshot: ${tag}`);
    panel.webview.html = buildSnapViewHtml(panel.webview, snap, tag);
}
function formatBytes(bytes) {
    if (bytes === undefined || bytes === null)
        return '—';
    if (bytes < 1024)
        return bytes + ' B';
    if (bytes < 1024 * 1024)
        return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function buildSnapViewHtml(webview, snap, tag) {
    const nonce = getNonce();
    const csp = [
        "default-src 'none'",
        `style-src ${webview.cspSource} 'unsafe-inline'`,
        `script-src 'nonce-${nonce}'`,
    ].join('; ');
    const eps = snap.endpoints.map((ep) => ({
        label: formatEndpointId(ep.id),
        errorPct: (ep.error_rate * 100).toFixed(2),
        p95: ep.latency.p95,
        payloadAvg: formatBytes(ep.payload_size?.avg),
        requests: (0, snapModel_1.endpointRequestCount)(ep),
        statusDist: ep.status_dist,
        schema: ep.schema ? { fields: ep.schema.fields } : undefined,
    }));
    const startTime = snap.meta.start_time.replace('T', ' ');
    const configHash = snap.meta.config_hash || '—';
    const sampling = snap.meta.snap_settings?.sample_rate !== undefined
        ? (snap.meta.snap_settings.sample_rate * 100) + '%'
        : '—';
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="\${csp}">
<style>
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  
  /* Header styling matching JetBrains dashboard */
  .header { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
  .header-top h2 { margin: 0; font-size: 14px; display: flex; align-items: center; gap: 8px; }
  .header-top h2::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: #3fb950; }
  
  .header-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--vscode-panel-border); }
  .header-item { display: flex; flex-direction: column; gap: 4px; }
  .header-item .label { font-size: 10px; font-weight: 600; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.5px; }
  .header-item .value { font-size: 13px; font-weight: 500; }
  
  /* Toolbar styling */
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
  .search-box { flex: 1; display: flex; align-items: center; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 2px; padding: 4px 8px; }
  .search-box input { flex: 1; background: transparent; border: none; color: var(--vscode-input-foreground); font-family: inherit; font-size: 12px; outline: none; }
  .search-box input::placeholder { color: var(--vscode-input-placeholderForeground); }
  .btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border, transparent); padding: 4px 12px; font-size: 12px; border-radius: 2px; cursor: pointer; display: flex; align-items: center; gap: 4px; }
  .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }

  /* Main split pane */
  .split { display: flex; gap: 0; flex: 1; overflow: hidden; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  .pane { overflow: auto; }
  .left { flex: 0 0 55%; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); }
  .right { flex: 1; display: flex; flex-direction: column; background: var(--vscode-editorWidget-background); }
  
  /* Table styling */
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: var(--vscode-editor-background); padding: 8px 12px; text-align: left; font-weight: 600; position: sticky; top: 0; z-index: 1; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
  td { padding: 6px 12px; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
  
  .ep-row { cursor: pointer; }
  .ep-row:hover:not(.selected) { background: var(--vscode-list-hoverBackground); }
  .ep-row.selected { background: #0060C0; color: #ffffff; }
  td.id-cell { font-family: var(--vscode-editor-font-family); font-size: 12px; }
  
  /* Right pane details */
  .schema-header { padding: 8px 12px; font-size: 12px; font-weight: 600; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); position: sticky; top: 0; z-index: 1; }
  .schema-content { flex: 1; overflow: auto; }
  .status-dist-container { border-top: 1px solid var(--vscode-panel-border); }
  
  /* Schema Tree */
  .schema-table th { padding: 6px 12px; }
  .schema-table td { padding: 4px 12px; border-bottom: none; }
  .schema-row:hover { background: var(--vscode-list-hoverBackground); }
  .schema-row { font-family: var(--vscode-editor-font-family); }
  .indent { display: inline-block; width: 16px; }
  .expand-icon { cursor: pointer; display: inline-block; width: 16px; text-align: center; color: var(--vscode-descriptionForeground); user-select: none; }
  .type-icon { display: inline-block; width: 24px; text-align: center; font-weight: bold; font-size: 10px; margin-right: 8px; color: var(--vscode-descriptionForeground); opacity: 0.8; }
  .stability-STABLE { color: #3fb950; }
  .stability-VOLATILE { color: #f85149; }
  .stability-RARE { color: var(--vscode-descriptionForeground); opacity: 0.7; }
  
  /* Status Distribution Bar */
  .status-dist-header { padding: 8px 12px; font-size: 12px; font-weight: 600; }
  .status-dist-body { padding: 0 12px 12px 12px; display: flex; align-items: center; gap: 12px; }
  .bar-wrapper { flex: 1; background: var(--vscode-editor-background); height: 20px; border-radius: 2px; overflow: hidden; display: flex; }
  .bar-segment { height: 100%; }
  .bar-segment-200 { background: #3fb950; }
  .bar-segment-400 { background: #d29922; }
  .bar-segment-500 { background: #f85149; }
  .pct-label { font-weight: 600; font-size: 12px; }

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
</div>

<div class="split">
  <div class="pane left">
    <table id="mainTable">
      <thead><tr>
        <th>Endpoint</th>
        <th>Error Rate</th>
        <th>P95</th>
        <th>Payload Avg</th>
      </tr></thead>
      <tbody id="epTable">
        ${eps.map((ep, i) => , `
        <tr class="ep-row" data-idx="\${i}" data-search="\${escHtml(ep.label.toLowerCase())}">
          <td class="id-cell" title="\${escHtml(ep.label)}">\${escHtml(ep.label)}</td>
          <td>\${ep.errorPct}%</td>
          <td>\${ep.p95} ms</td>
          <td>\${ep.payloadAvg}</td>
        </tr>\`).join('')}
      </tbody>
    </table>
    ${eps.length === 0 ? '<div class="empty">No endpoints recorded in this snapshot.</div>' : ''}
  </div>
  <div class="right" id="detail">
    <div class="empty" style="margin-top: 40px;">Select an endpoint to see details.</div>
  </div>
</div>

<script nonce="\${nonce}">
(function () {
  const eps = ${JSON.stringify(eps)};
  let current = -1;

  function pct(n) { return (n * 100).toFixed(0) + '%'; }
  
  function getTypeIcon(type) {
    if (type === 'object') return '{}';
    if (type === 'string') return '≡';
    if (type === 'number') return '123';
    if (type === 'boolean') return '10|01';
    if (type === 'array') return '[]';
    return '?';
  }

  // Parses flat "a.b.c" keys into a tree structure for UI
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
      const expand = hasChildren ? '<span class="expand-icon" onclick="toggleNode(this, \\'' + child.fullPath + '\\')">▼</span>' : '<span class="expand-icon"></span>';
      
      const typeStr = child.type || (hasChildren ? 'object' : 'unknown');
      const presence = child.presence !== undefined ? (child.presence * 100).toFixed(0) + '%' : '—';
      
      html += '<tr class="schema-row" data-path="' + child.fullPath + '">';
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

  window.toggleNode = function(el, path) {
    const isExpanded = el.innerText === '▼';
    el.innerText = isExpanded ? '▶' : '▼';
    // Very simple toggling logic: hide all rows whose path starts with \`path.\`
    const rows = document.querySelectorAll('.schema-row');
    rows.forEach(r => {
      const rPath = r.getAttribute('data-path');
      if (rPath && rPath.startsWith(path + '.')) {
        r.style.display = isExpanded ? 'none' : 'table-row';
        // reset children expand icons if expanding
        if (!isExpanded) {
          const rExpand = r.querySelector('.expand-icon');
          if (rExpand && rExpand.innerText === '▶') {
            rExpand.innerText = '▼';
          }
        }
      }
    });
  };

  function renderDetail(ep) {
    const detail = document.getElementById('detail');
    let html = '';

    // Schema View (Top)
    let schemaBody = '<div class="empty" style="margin-top: 40px;">No schema data.</div>';
    if (ep.schema && Object.keys(ep.schema.fields).length > 0) {
      const tree = buildTree(ep.schema.fields);
      schemaBody = '<table class="schema-table"><thead><tr><th>Field</th><th>Type</th><th>Presence %</th><th>Stability</th></tr></thead><tbody>' +
        renderTreeNodes(tree) +
        '</tbody></table>';
    }
    
    html += '<div class="schema-header">Inferred JSON Schema</div>';
    html += '<div class="schema-content">' + schemaBody + '</div>';

    // Status Code Dist (Bottom)
    html += '<div class="status-dist-container">';
    html += '<div class="status-dist-header">Status Code Distribution</div>';
    html += '<div class="status-dist-body">';
    
    const statuses = Object.entries(ep.statusDist).sort((a, b) => b[1] - a[1]);
    if (statuses.length) {
      const mainStatus = statuses[0];
      const code = mainStatus[0];
      const p = mainStatus[1];
      const cls = code.startsWith('5') ? 'bar-segment-500' : code.startsWith('4') ? 'bar-segment-400' : 'bar-segment-200';
      
      html += '<span style="font-size: 12px; font-weight: 600;">' + code + '</span>';
      html += '<div class="bar-wrapper"><div class="bar-segment ' + cls + '" style="width: ' + (p * 100) + '%;"></div></div>';
      html += '<span class="pct-label">' + pct(p) + '</span>';
    } else {
      html += '<div class="empty" style="padding: 0;">No status data.</div>';
    }
    html += '</div></div>'; // end body/container

    detail.innerHTML = html;
  }

  // Row selection
  document.querySelectorAll('.ep-row').forEach((row, i) => {
    row.addEventListener('click', () => {
      document.querySelectorAll('.ep-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      current = i;
      renderDetail(eps[i]);
    });
  });

  // Search filtering
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    let firstVisible = null;
    document.querySelectorAll('.ep-row').forEach((row) => {
      if (row.getAttribute('data-search').includes(q)) {
        row.style.display = 'table-row';
        if (!firstVisible) firstVisible = row;
      } else {
        row.style.display = 'none';
      }
    });
    // Optional: auto-select first visible if current is hidden
  });

  if (eps.length > 0) {
    document.querySelector('.ep-row')?.click();
  }
})();
</script>
</body>
</html>\`;
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
    );
}
//# sourceMappingURL=snapViewPanel.js.map