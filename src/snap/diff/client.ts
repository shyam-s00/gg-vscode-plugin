import type { DiffRowData } from './panel';
import type { SnapFieldSchema } from '../snapModel';

declare global {
  interface Window {
    __GG_DIFFS__: DiffRowData[];
  }
}

interface TreeNode {
  name?: string;
  fullPath?: string;
  base?: SnapFieldSchema;
  cmp?: SnapFieldSchema;
  children: Record<string, TreeNode>;
}

const vscodeApi = acquireVsCodeApi();
const diffs: DiffRowData[] = window.__GG_DIFFS__;

function pct(n: number): string {
  return (n * 100).toFixed(0) + '%';
}

// Makes each <th> in a table individually drag-resizable. Freezes the
// browser's auto-computed widths first so switching to table-layout:fixed
// doesn't reflow the initial render.
function initResizableColumns(table: HTMLTableElement | null): void {
  if (!table || table.dataset.resizableInit) { return; }
  table.dataset.resizableInit = '1';
  const ths = Array.from(table.querySelectorAll('thead th'));
  ths.forEach((th) => {
    const thEl = th as HTMLElement;
    thEl.style.width = (thEl.offsetWidth || 120) + 'px';
    const handle = document.createElement('span');
    handle.className = 'col-resize-handle';
    thEl.appendChild(handle);

    let startX = 0;
    let startWidth = 0;

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(40, startWidth + (ev.clientX - startX));
      thEl.style.width = newWidth + 'px';
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
      startX = (e as MouseEvent).clientX;
      startWidth = thEl.offsetWidth;
      handle.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

function escHtml(s: unknown): string {
  if (!s) { return ''; }
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getTypeIcon(type: string): string {
  if (type === 'object') { return '{}'; }
  if (type === 'string') { return '≡'; }
  if (type === 'number') { return '123'; }
  if (type === 'boolean') { return '10|01'; }
  if (type === 'array') { return '[]'; }
  return '?';
}

function buildTree(baseFields: Record<string, SnapFieldSchema>, cmpFields: Record<string, SnapFieldSchema>): TreeNode {
  const root: TreeNode = { children: {} };
  const allKeys = new Set([...Object.keys(baseFields), ...Object.keys(cmpFields)]);

  for (const key of allKeys) {
    const parts = key.split('.');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!current.children[p]) {
        current.children[p] = { name: p, children: {}, fullPath: parts.slice(0, i + 1).join('.') };
      }
      if (i === parts.length - 1) {
        if (baseFields[key]) { current.children[p].base = baseFields[key]; }
        if (cmpFields[key]) { current.children[p].cmp = cmpFields[key]; }
      }
      current = current.children[p];
    }
  }
  return root;
}

function renderTreeNodes(node: TreeNode, depth = 0): string {
  let html = '';
  const keys = Object.keys(node.children || {}).sort();
  for (const k of keys) {
    const child = node.children[k];
    const hasChildren = Object.keys(child.children || {}).length > 0;

    const bField = child.base;
    const cField = child.cmp;
    const fieldData = cField || bField;

    const stab = fieldData?.stability || 'RARE';
    const typeStr = fieldData?.type || (hasChildren ? 'object' : 'unknown');

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

function renderStatusBlock(label: string, statusDist: Record<string, number>, errRate: number): { html: string; hasErr: boolean } {
  const rawStatuses = Object.entries(statusDist || {});
  const list: [string, number][] = [];
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
      if (code === 'ERR') { hasErr = true; }
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

function renderDetail(epDiff: DiffRowData): void {
  const detail = document.getElementById('detail');
  if (!detail) { return; }
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

function initVResizer(): void {
  const vResizer = document.getElementById('vDragResizer');
  const schemaContent = document.getElementById('schemaContent') as HTMLElement | null;
  const detailPane = document.getElementById('detail');
  if (!vResizer || !schemaContent || !detailPane) { return; }

  let isVDragging = false;
  vResizer.addEventListener('mousedown', () => {
    isVDragging = true;
    vResizer.classList.add('v-dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!isVDragging) { return; }
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
document.getElementById('detail')?.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const expandBtn = target.closest('.expand-icon') as HTMLElement | null;
  if (!expandBtn || !expandBtn.innerText) { return; }
  const row = expandBtn.closest('.schema-row');
  if (!row) { return; }
  const path = row.getAttribute('data-path');
  if (!path) { return; }

  const isExpanded = expandBtn.innerText === '▼';
  expandBtn.innerText = isExpanded ? '▶' : '▼';

  const allRows = document.querySelectorAll('.schema-row');
  allRows.forEach((r) => {
    const rPath = r.getAttribute('data-path');
    if (rPath && rPath.startsWith(path + '.')) {
      (r as HTMLElement).style.display = isExpanded ? 'none' : 'table-row';
    }
  });
});

// Table Row selection
document.querySelectorAll('.ep-row').forEach((row) => {
  row.addEventListener('click', () => {
    document.querySelectorAll('.ep-row').forEach((r) => r.classList.remove('selected'));
    row.classList.add('selected');
    const idx = parseInt(row.getAttribute('data-idx') || '-1', 10);
    if (idx >= 0 && idx < diffs.length) {
      renderDetail(diffs[idx]);
    }
  });
});

// Search filtering
const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const q = (e.target as HTMLInputElement).value.toLowerCase();
    document.querySelectorAll('.ep-row').forEach((row) => {
      const text = row.getAttribute('data-search') || '';
      (row as HTMLElement).style.display = text.includes(q) ? 'table-row' : 'none';
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
  columnsMenu.querySelectorAll('input').forEach((cb) => {
    cb.addEventListener('change', () => {
      const colClass = cb.getAttribute('data-col');
      const show = (cb as HTMLInputElement).checked;
      document.querySelectorAll('.' + colClass).forEach((el) => {
        (el as HTMLElement).style.display = show ? '' : 'none';
      });
      const enabled = Array.from(columnsMenu.querySelectorAll('input'))
        .filter((i) => (i as HTMLInputElement).checked)
        .map((i) => i.getAttribute('data-col'));
      vscodeApi.postMessage({ type: 'columnsChanged', columns: enabled });
    });
  });
}

// Drag Resizer (Horizontal)
const resizer = document.getElementById('dragResizer');
const leftPane = document.getElementById('leftPane') as HTMLElement | null;
if (resizer && leftPane) {
  let isDragging = false;
  resizer.addEventListener('mousedown', () => {
    isDragging = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) { return; }
    const splitPane = document.getElementById('splitPane');
    if (!splitPane) { return; }
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

initResizableColumns(document.getElementById('mainTable') as HTMLTableElement | null);

if (diffs.length > 0) {
  (document.querySelector('.ep-row') as HTMLElement | null)?.click();
}
