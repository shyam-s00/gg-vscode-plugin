import { getSnapDetailPanel } from './snapDetailPanel';
import { formatEndpointId } from './snapViewPanel';
import { endpointRequestCount } from './snapModel';
import type { LoadedSnap, SnapEndpoint } from './snapModel';

// ─────────────────────────────────────────────────────────────────────────────
// Diff model — exported for testing
// ─────────────────────────────────────────────────────────────────────────────

export type DiffVerdict = 'PASS' | 'WARN' | 'REGRESSION' | 'ADDED' | 'REMOVED';

export interface EndpointDiff {
  id: string;
  label: string;
  verdict: DiffVerdict;
  baseline?: SnapEndpoint;
  compare?: SnapEndpoint;
  /** % change in latency (positive = slower). Undefined for ADDED/REMOVED. */
  p50Delta?: number;
  p95Delta?: number;
  p99Delta?: number;
  maxDelta?: number;
  /** Absolute change in error rate (current − baseline). Undefined for ADDED/REMOVED. */
  errorRateDelta?: number;
  /** % change in average payload size. Undefined when baseline has no payload data. */
  avgPayloadDelta?: number;
}

/**
 * Computes per-endpoint diffs between two snapshots using the same default
 * thresholds as `gg snap assert`:
 *   - p99 latency > +20%  → REGRESSION
 *   - error rate delta > 0.05 (5 pp) → REGRESSION
 *   - p95 latency > +10%  → WARN
 *   - error rate delta > 0.01 (1 pp) → WARN
 *   - avg payload > +50%  → WARN
 */
export function computeDiff(baseline: LoadedSnap, compare: LoadedSnap): EndpointDiff[] {
  const baseMap = new Map(baseline.endpoints.map((e) => [e.id, e]));
  const cmpMap = new Map(compare.endpoints.map((e) => [e.id, e]));
  const allIds = new Set([...baseMap.keys(), ...cmpMap.keys()]);

  const diffs: EndpointDiff[] = [];

  for (const id of allIds) {
    const b = baseMap.get(id);
    const c = cmpMap.get(id);
    const label = formatEndpointId(id);

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
    const avgPayloadDelta =
      b.payload_size?.avg !== null && b.payload_size?.avg !== undefined &&
        c.payload_size?.avg !== null && c.payload_size?.avg !== undefined
        ? pctChange(b.payload_size.avg, c.payload_size.avg)
        : undefined;

    let verdict: DiffVerdict = 'PASS';
    if (p99Delta > 20 || errorRateDelta > 0.05) {
      verdict = 'REGRESSION';
    } else if (
      p95Delta > 10 ||
      errorRateDelta > 0.01 ||
      (avgPayloadDelta !== undefined && avgPayloadDelta > 50)
    ) {
      verdict = 'WARN';
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

function pctChange(before: number, after: number): number {
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
export function showSnapDiff(a: LoadedSnap, b: LoadedSnap): void {
  const [baseline, compare] =
    a.meta.start_time <= b.meta.start_time ? [a, b] : [b, a];

  const bTag = baseline.meta.tag.trim() || '(untagged)';
  const cTag = compare.meta.tag.trim() || '(untagged)';

  const panel = getSnapDetailPanel(`Diff: ${bTag} ↔ ${cTag}`);
  panel.webview.html = buildSnapDiffHtml(baseline, compare, bTag, cTag);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML — exported for smoke-testing
// ─────────────────────────────────────────────────────────────────────────────

export function buildSnapDiffHtml(
  baseline: LoadedSnap,
  compare: LoadedSnap,
  bTag: string,
  cTag: string,
): string {
  const diffs = computeDiff(baseline, compare);

  const rows = diffs.map((d) => {
    const verdictClass = `verdict-${d.verdict}`;
    const verdictBadge = `<span class="badge ${verdictClass}">${d.verdict}</span>`;

    let p50Cell = '—', p95Cell = '—', p99Cell = '—', maxCell = '—', errCell = '—', payloadCell = '—';
    let baseReq = '—', cmpReq = '—';

    if (d.verdict === 'ADDED') {
      baseReq = '—';
      cmpReq = endpointRequestCount(d.compare!).toLocaleString();
    } else if (d.verdict === 'REMOVED') {
      baseReq = endpointRequestCount(d.baseline!).toLocaleString();
      cmpReq = '—';
    } else {
      baseReq = endpointRequestCount(d.baseline!).toLocaleString();
      cmpReq = endpointRequestCount(d.compare!).toLocaleString();

      p50Cell = fmtDelta(d.p50Delta!);
      p95Cell = fmtDelta(d.p95Delta!);
      p99Cell = fmtDelta(d.p99Delta!);
      maxCell = fmtDelta(d.maxDelta!);
      errCell = fmtErrDelta(d.errorRateDelta!);
      payloadCell = d.avgPayloadDelta !== undefined ? fmtDelta(d.avgPayloadDelta) : '—';
    }

    return `<tr class="${verdictClass}">
      <td class="ep-cell" title="${escHtml(d.label)}">${escHtml(d.label)}</td>
      <td class="center">${verdictBadge}</td>
      <td class="center delta">${p50Cell}</td>
      <td class="center delta">${p95Cell}</td>
      <td class="center delta">${p99Cell}</td>
      <td class="center delta">${maxCell}</td>
      <td class="center delta">${errCell}</td>
      <td class="center delta">${payloadCell}</td>
      <td class="center num">${baseReq}</td>
      <td class="center num">${cmpReq}</td>
    </tr>`;
  });

  const bStart = baseline.meta.start_time.slice(0, 16).replace('T', ' ');
  const cStart = compare.meta.start_time.slice(0, 16).replace('T', ' ');
  const regression = diffs.filter((d) => d.verdict === 'REGRESSION').length;
  const warn = diffs.filter((d) => d.verdict === 'WARN').length;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 12px 16px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
  .header h2 { margin: 0 0 3px 0; font-size: 15px; }
  .header .meta { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .summary { font-size: 12px; margin-bottom: 10px; display: flex; gap: 12px; }
  .summary .reg { color: #f85149; font-weight: 600; }
  .summary .wrn { color: #d29922; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: var(--vscode-editorWidget-background); padding: 6px 8px; text-align: center; font-weight: 600; position: sticky; top: 0; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; }
  th.left-align { text-align: left; }
  td { padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); }
  td.center { text-align: center; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.ep-cell { font-family: var(--vscode-editor-font-family); font-size: 11px; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.delta { font-variant-numeric: tabular-nums; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; letter-spacing: 0.3px; }
  .verdict-REGRESSION td { background: rgba(248,81,73,0.07); }
  .verdict-WARN td { background: rgba(210,153,34,0.07); }
  .verdict-ADDED td { background: rgba(88,166,255,0.07); }
  .verdict-REMOVED td { background: rgba(139,148,158,0.07); opacity: 0.7; }
  .verdict-REGRESSION .badge { background: rgba(248,81,73,0.2); color: #f85149; }
  .verdict-WARN .badge { background: rgba(210,153,34,0.2); color: #d29922; }
  .verdict-ADDED .badge { background: rgba(88,166,255,0.2); color: #58a6ff; }
  .verdict-REMOVED .badge { background: rgba(139,148,158,0.2); color: #8b949e; }
  .verdict-PASS .badge { background: rgba(63,185,80,0.15); color: #3fb950; }
  .reg-val { color: #f85149; }
  .imp-val { color: #3fb950; }
  .wrn-val { color: #d29922; }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 20px 0; font-size: 12px; }
</style>
</head>
<body>
<div class="header">
  <div>
    <h2>Snapshot Diff</h2>
    <div class="meta"><strong>A (baseline):</strong> ${escHtml(bTag)} &nbsp;·&nbsp; ${escHtml(bStart)}</div>
    <div class="meta"><strong>B (compare):</strong> ${escHtml(cTag)} &nbsp;·&nbsp; ${escHtml(cStart)}</div>
  </div>
</div>
${regression > 0 || warn > 0 ? `
<div class="summary">
  ${regression > 0 ? `<span class="reg">⛔ ${regression} regression${regression > 1 ? 's' : ''}</span>` : ''}
  ${warn > 0 ? `<span class="wrn">⚠ ${warn} warning${warn > 1 ? 's' : ''}</span>` : ''}
</div>` : ''}
${diffs.length === 0
  ? '<div class="empty">No endpoints found in either snapshot.</div>'
  : `<table>
  <thead><tr>
    <th class="left-align">Endpoint</th>
    <th>Status</th>
    <th>p50 Δ</th><th>p95 Δ</th><th>p99 Δ</th><th>max Δ</th>
    <th>Err% Δ</th><th>Payload Δ</th>
    <th>Req (A)</th><th>Req (B)</th>
  </tr></thead>
  <tbody>${rows.join('')}</tbody>
</table>`}
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtDelta(pct: number): string {
  const sign = pct > 0 ? '+' : '';
  const str = `${sign}${pct.toFixed(1)}%`;
  if (pct > 10) {
    return `<span class="reg-val">${str}</span>`;
  }
  if (pct < -1) {
    return `<span class="imp-val">${str}</span>`;
  }
  if (pct > 3) {
    return `<span class="wrn-val">${str}</span>`;
  }
  return str;
}

function fmtErrDelta(delta: number): string {
  if (delta === 0) {
    return '—';
  }
  const sign = delta > 0 ? '+' : '';
  const str = `${sign}${(delta * 100).toFixed(2)}pp`;
  if (delta > 0.01) {
    return `<span class="reg-val">${str}</span>`;
  }
  if (delta < 0) {
    return `<span class="imp-val">${str}</span>`;
  }
  return `<span class="wrn-val">${str}</span>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
