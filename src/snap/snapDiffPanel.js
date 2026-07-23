"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDiff = computeDiff;
exports.showSnapDiff = showSnapDiff;
exports.buildSnapDiffHtml = buildSnapDiffHtml;
const snapDetailPanel_1 = require("./snapDetailPanel");
const snapViewPanel_1 = require("./snapViewPanel");
/**
 * Computes per-endpoint diffs between two snapshots using the same default
 * thresholds as `gg snap assert`:
 *   - p99 latency > +20%  → REGRESSION
 *   - error rate delta > 0.05 (5 pp) → REGRESSION
 *   - p95 latency > +10%  → WARN
 *   - error rate delta > 0.01 (1 pp) → WARN
 *   - avg payload > +50%  → WARN
 */
function computeDiff(baseline, compare) {
    const baseMap = new Map(baseline.endpoints.map((e) => [e.id, e]));
    const cmpMap = new Map(compare.endpoints.map((e) => [e.id, e]));
    const allIds = new Set([...baseMap.keys(), ...cmpMap.keys()]);
    const diffs = [];
    for (const id of allIds) {
        const b = baseMap.get(id);
        const c = cmpMap.get(id);
        const label = (0, snapViewPanel_1.formatEndpointId)(id);
        if (!b) {
            diffs.push({ id, label, verdict: 'ADDED', compare: c });
            continue;
        }
        if (!c) {
            diffs.push({ id, label, verdict: 'REMOVED', baseline: b });
            continue;
        }
        const p50Delta = pctChange(b.latency.p50, c.latency.p50);
        const p95Delta = pctChange(b.latency.p95, c.latency.p95);
        const p99Delta = pctChange(b.latency.p99, c.latency.p99);
        const maxDelta = pctChange(b.latency.max, c.latency.max);
        const errorRateDelta = c.error_rate - b.error_rate;
        const avgPayloadDelta = b.payload_size?.avg !== null && b.payload_size?.avg !== undefined &&
            c.payload_size?.avg !== null && c.payload_size?.avg !== undefined
            ? pctChange(b.payload_size.avg, c.payload_size.avg)
            : undefined;
        let verdict = 'PASS';
        if (p99Delta > 20 || errorRateDelta > 0.05) {
            verdict = 'REGRESSION';
        }
        else if (p95Delta > 10 ||
            errorRateDelta > 0.01 ||
            (avgPayloadDelta !== undefined && avgPayloadDelta > 50)) {
            verdict = 'WARN';
        }
        else if (p95Delta < -10 || errorRateDelta < -0.01) {
            // Optional: Explicitly mark as improvement for UI colors if you want
            // For now we rely on PASS, but UI can style negatives as green.
            verdict = 'PASS';
        }
        diffs.push({
            id,
            label,
            verdict,
            baseline: b,
            compare: c,
            p50Delta,
            p95Delta,
            p99Delta,
            maxDelta,
            errorRateDelta,
            avgPayloadDelta,
        });
    }
    return diffs;
}
function pctChange(before, after) {
    if (before === 0) {
        return after === 0 ? 0 : 100;
    }
    return ((after - before) / before) * 100;
}
// ─────────────────────────────────────────────────────────────────────────────
// Panel
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Shows a comparison of two snapshots in the shared snap detail panel.
 * Automatically orders them oldest→newest regardless of selection order,
 * mirroring the JetBrains SnapDiffDialog behaviour.
 */
function showSnapDiff(a, b) {
    const [baseline, compare] = a.meta.start_time <= b.meta.start_time ? [a, b] : [b, a];
    const bTag = baseline.meta.tag.trim() || '(untagged)';
    const cTag = compare.meta.tag.trim() || '(untagged)';
    const panel = (0, snapDetailPanel_1.getSnapDetailPanel)(`Diff: ${bTag} ↔ ${cTag}`);
    panel.webview.html = buildSnapDiffHtml(baseline, compare, bTag, cTag);
}
// ─────────────────────────────────────────────────────────────────────────────
// HTML — exported for smoke-testing
// ─────────────────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
    if (bytes === undefined || bytes === null)
        return '—';
    if (bytes < 1024)
        return bytes + ' B';
    if (bytes < 1024 * 1024)
        return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function formatLatency(ms) {
    if (ms === undefined)
        return '—';
    return ms.toFixed(1) + 'ms';
}
function formatPct(frac) {
    if (frac === undefined)
        return '—';
    return (frac * 100).toFixed(2) + '%';
}
function buildSnapDiffHtml(baseline, compare, bTag, cTag) {
    const diffs = computeDiff(baseline, compare);
    // We need to pass data to JS for the right pane schema tree + status diff rendering
    const jsData = diffs.map(d => ({
        label: d.label,
        verdict: d.verdict,
        baseSchema: d.baseline?.schema?.fields || {},
        cmpSchema: d.compare?.schema?.fields || {},
        baseStatus: d.baseline?.status_dist || {},
        cmpStatus: d.compare?.status_dist || {}
    }));
    const rows = diffs.map((d, i) => {
        let err = '—';
        let p95 = '—';
        let payload = '—';
        let isRemoved = d.verdict === 'REMOVED';
        let isAdded = d.verdict === 'ADDED';
        if (isRemoved) {
            err = ;
            `\${formatPct(d.baseline?.error_rate)} GONE\`;
      p95 = \`\${formatLatency(d.baseline?.latency.p95)} GONE\`;
      payload = \`\${formatBytes(d.baseline?.payload_size?.max)} GONE\`;
    } else if (isAdded) {
      err = formatPct(d.compare?.error_rate);
      p95 = formatLatency(d.compare?.latency.p95);
      payload = formatBytes(d.compare?.payload_size?.max);
    } else {
      err = formatPct(d.compare?.error_rate);
      p95 = formatLatency(d.compare?.latency.p95);
      payload = formatBytes(d.compare?.payload_size?.max);
    }

    const rowClass = \`ep-row \${isRemoved ? 'removed' : ''} \${isAdded ? 'added' : ''} \${d.verdict === 'REGRESSION' ? 'regression' : ''} \${d.verdict === 'WARN' ? 'warning' : ''} \${d.p95Delta !== undefined && d.p95Delta < -10 ? 'improvement' : ''}\`;
    
    return \`<tr class="\${rowClass}" data-idx="\${i}" data-search="\${escHtml(d.label.toLowerCase())}">
      <td class="id-cell" title="\${escHtml(d.label)}">\${escHtml(d.label)}</td>
      <td>\${err}</td>
      <td>\${p95}</td>
      <td>\${payload}</td>
    </tr>\`;
  });

  const bStart = baseline.meta.start_time.slice(0, 19).replace('T', ' ');
  const cStart = compare.meta.start_time.slice(0, 19).replace('T', ' ');
  
  const bHash = baseline.meta.config_hash || '—';
  const cHash = compare.meta.config_hash || '—';
  
  const mismatchWarning = (baseline.meta.config_hash !== compare.meta.config_hash) && baseline.meta.config_hash && compare.meta.config_hash;

  return /* html */ \`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 16px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  
  .warning-banner { background: rgba(210,153,34,0.15); border-left: 4px solid #d29922; color: #d29922; padding: 12px; font-weight: 600; font-size: 13px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .warning-banner::before { content: '⚠️'; }

  /* Diff Header Table */
  .diff-header-table { width: 100%; max-width: 800px; margin-bottom: 16px; border-collapse: collapse; font-size: 13px; }
  .diff-header-table th { text-align: left; padding: 6px 12px; border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; color: var(--vscode-descriptionForeground); }
  .diff-header-table td { padding: 6px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
  .diff-header-table tr td:first-child { font-weight: 600; color: var(--vscode-descriptionForeground); width: 150px; }

  /* Toolbar styling */
  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
  .search-box { flex: 1; display: flex; align-items: center; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 2px; padding: 4px 8px; }
  .search-box input { flex: 1; background: transparent; border: none; color: var(--vscode-input-foreground); font-family: inherit; font-size: 12px; outline: none; }
  .search-box input::placeholder { color: var(--vscode-input-placeholderForeground); }
  .btn { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border, transparent); padding: 4px 12px; font-size: 12px; border-radius: 2px; cursor: pointer; display: flex; align-items: center; gap: 4px; }
  
  /* Main split pane */
  .split { display: flex; gap: 0; flex: 1; overflow: hidden; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  .pane { overflow: auto; }
  .left { flex: 0 0 55%; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); display: flex; flex-direction: column; }
  .right { flex: 1; display: flex; flex-direction: column; background: var(--vscode-editorWidget-background); }
  
  .table-container { flex: 1; overflow: auto; }
  
  /* Table styling */
  table.main-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.main-table th { background: var(--vscode-editor-background); padding: 8px 12px; text-align: left; font-weight: 600; position: sticky; top: 0; z-index: 1; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
  table.main-table td { padding: 6px 12px; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
  
  .ep-row { cursor: pointer; }
  .ep-row:hover:not(.selected) { background: var(--vscode-list-hoverBackground); }
  .ep-row.selected { background: #0060C0; color: #ffffff !important; }
  .ep-row.selected td { color: #ffffff !important; }
  
  td.id-cell { font-family: var(--vscode-editor-font-family); font-size: 12px; }

  /* Legend Colors */
  .legend { padding: 8px 12px; font-size: 11px; font-weight: 600; display: flex; gap: 12px; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
  .legend-item { display: flex; align-items: center; gap: 4px; }
  .legend-color-regression { color: #f85149; }
  .legend-color-warning { color: #d29922; }
  .legend-color-improvement { color: #3fb950; }
  .legend-color-added { color: #58a6ff; }
  .legend-color-removed { color: var(--vscode-descriptionForeground); opacity: 0.7; }
  
  /* Row color overrides based on state */
  .regression td { color: #f85149; }
  .warning td { color: #d29922; }
  .improvement td { color: #3fb950; }
  .added td { color: #58a6ff; }
  .removed td { color: var(--vscode-descriptionForeground); opacity: 0.6; }

  /* Right pane details */
  .schema-header { padding: 8px 12px; font-size: 12px; font-weight: 600; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); position: sticky; top: 0; z-index: 1; }
  .schema-content { flex: 1; overflow: auto; }
  .status-dist-container { border-top: 1px solid var(--vscode-panel-border); }
  
  /* Schema Tree */
  .schema-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .schema-table th { padding: 6px 12px; text-align: left; position: sticky; top: 0; background: var(--vscode-editorWidget-background); border-bottom: 1px solid var(--vscode-panel-border); }
  .schema-table td { padding: 4px 12px; border-bottom: none; }
  .schema-row:hover { background: var(--vscode-list-hoverBackground); }
  .schema-row { font-family: var(--vscode-editor-font-family); }
  .indent { display: inline-block; width: 16px; }
  .expand-icon { cursor: pointer; display: inline-block; width: 16px; text-align: center; color: var(--vscode-descriptionForeground); user-select: none; }
  .type-icon { display: inline-block; width: 24px; text-align: center; font-weight: bold; font-size: 10px; margin-right: 8px; color: var(--vscode-descriptionForeground); opacity: 0.8; }
  .stability-STABLE { color: #3fb950; }
  .stability-VOLATILE { color: #d29922; }
  .stability-RARE { color: var(--vscode-descriptionForeground); opacity: 0.7; }
  
  .diff-arrow-up { color: #d29922; margin-left: 4px; font-size: 10px; }
  .diff-arrow-down { color: #f85149; margin-left: 4px; font-size: 10px; }
  
  /* Status Distribution Bar */
  .status-dist-header { padding: 8px 12px; font-size: 12px; font-weight: 600; }
  .status-dist-body { padding: 0 12px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
  .status-dist-row { display: flex; align-items: center; gap: 12px; width: 100%; }
  .status-dist-label { width: 60px; font-size: 11px; color: var(--vscode-descriptionForeground); text-transform: uppercase; font-weight: 600; text-align: right; }
  .bar-wrapper { flex: 1; background: var(--vscode-editor-background); height: 20px; border-radius: 2px; overflow: hidden; display: flex; }
  .bar-segment { height: 100%; }
  .bar-segment-200 { background: #3fb950; }
  .bar-segment-400 { background: #d29922; }
  .bar-segment-500 { background: #f85149; }
  .pct-label { width: 40px; font-weight: 600; font-size: 12px; }

  .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 20px; font-size: 12px; text-align: center; }
</style>
</head>
<body>

\${mismatchWarning ? \`<div class="warning-banner">Configuration mismatch: snapshot configurations do not match and may lead to inconsistent results. Re-running the baseline with the target's configuration is recommended.</div>\` : ''}

<table class="diff-header-table">
  <thead>
    <tr><th></th><th>Baseline</th><th>Target</th></tr>
  </thead>
  <tbody>
    <tr><td>Tag</td><td>\${escHtml(bTag)}</td><td>\${escHtml(cTag)}</td></tr>
    <tr><td>Date / Time</td><td>\${escHtml(bStart)}</td><td>\${escHtml(cStart)}</td></tr>
    <tr><td>Total Requests</td><td>\${baseline.meta.total_requests.toLocaleString()}</td><td>\${compare.meta.total_requests.toLocaleString()}</td></tr>
    <tr><td>Peak RPS</td><td>\${baseline.meta.peak_rps.toFixed(1)} r/s</td><td>\${compare.meta.peak_rps.toFixed(1)} r/s</td></tr>
    <tr><td>Profile</td><td>config: \${bHash.substring(0,14)}...</td><td>config: \${cHash.substring(0,14)}...</td></tr>
  </tbody>
</table>

<div class="toolbar">
  <div class="search-box">
    <span style="opacity: 0.5; margin-right: 6px;">🔍</span>
    <input type="text" id="searchInput" placeholder="Filter endpoints..." />
  </div>
  <button class="btn" id="columnsBtn">Columns ▾</button>
</div>

<div class="split">
  <div class="pane left">
    <div class="table-container">
      <table class="main-table" id="mainTable">
        <thead><tr>
          <th>Endpoint</th>
          <th>Error Rate</th>
          <th>P95</th>
          <th>Payload Max</th>
        </tr></thead>
        <tbody id="epTable">
          \${rows.join('')}
        </tbody>
      </table>
    </div>
    <div class="legend">
      <span class="legend-color-regression">Regression</span>
      <span class="legend-color-warning">Payload warning</span>
      <span class="legend-color-improvement">Improvement</span>
      <span class="legend-color-added">Added</span>
      <span class="legend-color-removed">Removed</span>
    </div>
  </div>
  <div class="right" id="detail">
    <div class="empty" style="margin-top: 40px;">Select an endpoint to see details.</div>
  </div>
</div>

<script>
(function () {
  const diffs = ${JSON.stringify(jsData)};
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

  function buildTree(baseFields, cmpFields) {
    const root = { children: {} };
    
    // Merge keys from both schemas
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
          current.children[p].base = baseFields[key];
          current.children[p].cmp = cmpFields[key];
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
      
      // Use cmp field mostly, fallback to base
      const fieldData = cField || bField || {};
      
      const stab = fieldData.stability || 'RARE';
      const typeStr = fieldData.type || (hasChildren ? 'object' : 'unknown');
      
      const indent = '<span class="indent"></span>'.repeat(depth);
      const expand = hasChildren ? '<span class="expand-icon" onclick="toggleNode(this, \\'' + child.fullPath + '\\')">▼</span>' : '<span class="expand-icon"></span>';
      
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

      html += '<tr class="schema-row" data-path="' + child.fullPath + '">';
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

  window.toggleNode = function(el, path) {
    const isExpanded = el.innerText === '▼';
    el.innerText = isExpanded ? '▶' : '▼';
    const rows = document.querySelectorAll('.schema-row');
    rows.forEach(r => {
      const rPath = r.getAttribute('data-path');
      if (rPath && rPath.startsWith(path + '.')) {
        r.style.display = isExpanded ? 'none' : 'table-row';
        if (!isExpanded) {
          const rExpand = r.querySelector('.expand-icon');
          if (rExpand && rExpand.innerText === '▶') {
            rExpand.innerText = '▼';
          }
        }
      }
    });
  };
  
  function renderStatusBarRow(label, statusDist) {
    const statuses = Object.entries(statusDist).sort((a, b) => b[1] - a[1]);
    let content = '';
    if (statuses.length) {
      const mainStatus = statuses[0];
      const code = mainStatus[0];
      const p = mainStatus[1];
      const cls = code.startsWith('5') ? 'bar-segment-500' : code.startsWith('4') ? 'bar-segment-400' : 'bar-segment-200';
      
      content += '<div class="bar-wrapper"><div class="bar-segment ' + cls + '" style="width: ' + (p * 100) + '%;"></div></div>';
      content += '<span class="pct-label">' + pct(p) + '</span>';
    } else {
      content += '<div class="bar-wrapper"></div><span class="pct-label">—</span>';
    }
    return '<div class="status-dist-row"><div class="status-dist-label">' + label + '</div>' + content + '</div>';
  }

  function renderDetail(epDiff) {
    const detail = document.getElementById('detail');
    let html = '';

    // Schema View (Top)
    let schemaBody = '<div class="empty" style="margin-top: 40px;">No schema data.</div>';
    if (Object.keys(epDiff.baseSchema).length > 0 || Object.keys(epDiff.cmpSchema).length > 0) {
      const tree = buildTree(epDiff.baseSchema, epDiff.cmpSchema);
      schemaBody = '<table class="schema-table"><thead><tr><th>Field</th><th>Type</th><th>Presence %</th><th>Stability</th></tr></thead><tbody>' +
        renderTreeNodes(tree) +
        '</tbody></table>';
    }
    
    html += '<div class="schema-header">Inferred JSON Schema (diff)</div>';
    html += '<div class="schema-content">' + schemaBody + '</div>';

    // Status Code Dist (Bottom)
    html += '<div class="status-dist-container">';
    html += '<div class="status-dist-header">Status Code Distribution</div>';
    html += '<div class="status-dist-body">';
    
    html += renderStatusBarRow('Baseline', epDiff.baseStatus);
    html += renderStatusBarRow('Target', epDiff.cmpStatus);
    
    html += '</div></div>'; // end body/container

    detail.innerHTML = html;
  }

  // Row selection
  document.querySelectorAll('.ep-row').forEach((row) => {
    row.addEventListener('click', () => {
      document.querySelectorAll('.ep-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      const idx = parseInt(row.getAttribute('data-idx'));
      if (idx >= 0 && idx < diffs.length) {
        renderDetail(diffs[idx]);
      }
    });
  });

  // Search filtering
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.ep-row').forEach((row) => {
      if (row.getAttribute('data-search').includes(q)) {
        row.style.display = 'table-row';
      } else {
        row.style.display = 'none';
      }
    });
  });

  if (diffs.length > 0) {
    document.querySelector('.ep-row')?.click();
  }
})();
</script>
</body>
</html>\`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtDelta(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  const str = \`\${sign}\${pct.toFixed(1)}%\`;
  if (pct > 10) {
    return \`<span class="reg-val">\${str}</span>\`;
  }
  if (pct < -1) {
    return \`<span class="imp-val">\${str}</span>\`;
  }
  if (pct > 3) {
    return \`<span class="wrn-val">\${str}</span>\`;
  }
  return str;
}

function fmtErrDelta(delta: number): string {
  if (delta === 0) {
    return '—';
  }
  const sign = delta > 0 ? '+' : '';
  const str = \`\${sign}\${(delta * 100).toFixed(2)}pp\`;
  if (delta > 0.01) {
    return \`<span class="reg-val">\${str}</span>\`;
  }
  if (delta < 0) {
    return \`<span class="imp-val">\${str}</span>\`;
  }
  return \`<span class="wrn-val">\${str}</span>\`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
            ;
        }
    });
}
//# sourceMappingURL=snapDiffPanel.js.map