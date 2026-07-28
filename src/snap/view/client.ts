import type { ViewEndpointData } from './panel';

declare global {
  interface Window {
    __GG_EPS__: ViewEndpointData[];
  }
}

interface SchemaFieldValue {
  type: string;
  presence: number;
  stability?: string;
}

interface TreeNode {
  name?: string;
  fullPath?: string;
  type?: string;
  presence?: number;
  stability?: string;
  children: Record<string, TreeNode>;
}

const vscodeApi = acquireVsCodeApi();
const eps: ViewEndpointData[] = window.__GG_EPS__;

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

function buildTree(fields: Record<string, SchemaFieldValue>): TreeNode {
  const root: TreeNode = { children: {} };
  for (const [key, val] of Object.entries(fields)) {
    const parts = key.split('.');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!current.children[p]) {
        current.children[p] = { name: p, children: {}, fullPath: parts.slice(0, i + 1).join('.') };
      }
      if (i === parts.length - 1) {
        Object.assign(current.children[p], val);
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

function renderDetail(ep: ViewEndpointData): void {
  const detail = document.getElementById('detail');
  if (!detail) { return; }
  let html = '';

  let schemaBody = '<div class="empty" style="margin-top: 40px;">No schema data.</div>';
  if (ep.schema && ep.schema.fields && Object.keys(ep.schema.fields).length > 0) {
    const tree = buildTree(ep.schema.fields as unknown as Record<string, SchemaFieldValue>);
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
      if (code === 'ERR') { hasErr = true; }
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
document.querySelectorAll('.ep-row').forEach((row, i) => {
  row.addEventListener('click', () => {
    document.querySelectorAll('.ep-row').forEach((r) => r.classList.remove('selected'));
    row.classList.add('selected');
    renderDetail(eps[i]);
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

if (eps.length > 0) {
  (document.querySelector('.ep-row') as HTMLElement | null)?.click();
}
