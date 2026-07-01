import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  buildAssertArgs,
  buildAssertResultHtml,
  parseAssertResult,
} from '../snap/snapAssertPanel';
import type { AssertOptions, AssertResult } from '../snap/snapAssertPanel';
import type { LoadedSnap } from '../snap/snapModel';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_OPTS: AssertOptions = {
  latencyRegressionPct: 20,
  errorRateDelta: 0.05,
  payloadSizeDeltaPct: 50,
  denyRemovedFields: false,
  failOnWarn: false,
};

function makeSnap(tag: string, filePath: string): LoadedSnap {
  return {
    version: 1,
    meta: { tag, start_time: '2026-01-01T00:00:00Z', end_time: '2026-01-01T00:05:00Z', peak_rps: 100, total_requests: 500 },
    endpoints: [],
    filePath,
    internalIndex: 1,
  };
}

const BASELINE = makeSnap('v1.0', '/snaps/v1.snap');
const COMPARE = makeSnap('v2.0', '/snaps/v2.snap');

const PASSED_RESULT: AssertResult = { passed: true, violations: [] };
const FAILED_RESULT: AssertResult = {
  passed: false,
  violations: [
    { endpoint_id: 'GET:http://localhost/users', verdict: 'REGRESSION', message: 'p99 latency increased by 25.3%' },
    { endpoint_id: 'POST:http://localhost/items', verdict: 'WARN', message: 'avg payload size increased by 60.0%' },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// parseAssertResult
// ─────────────────────────────────────────────────────────────────────────────

suite('parseAssertResult', () => {
  test('parses a passed result with no violations', () => {
    const json = JSON.stringify({ passed: true, violations: [] });
    const result = parseAssertResult(json);
    assert.ok(result);
    assert.strictEqual(result!.passed, true);
    assert.deepStrictEqual(result!.violations, []);
  });

  test('parses a failed result with violations', () => {
    const json = JSON.stringify({
      passed: false,
      violations: [
        { endpoint_id: 'GET:/x', verdict: 'REGRESSION', message: 'p99 increased by 25%' },
      ],
    });
    const result = parseAssertResult(json);
    assert.ok(result);
    assert.strictEqual(result!.passed, false);
    assert.strictEqual(result!.violations.length, 1);
    assert.strictEqual(result!.violations[0].verdict, 'REGRESSION');
  });

  test('returns undefined for empty stdout', () => {
    assert.strictEqual(parseAssertResult(''), undefined);
    assert.strictEqual(parseAssertResult('  '), undefined);
  });

  test('returns undefined for invalid JSON', () => {
    assert.strictEqual(parseAssertResult('not json'), undefined);
  });

  test('returns undefined when passed field is missing', () => {
    const json = JSON.stringify({ violations: [] });
    assert.strictEqual(parseAssertResult(json), undefined);
  });

  test('gracefully handles missing violations array', () => {
    const json = JSON.stringify({ passed: false });
    const result = parseAssertResult(json);
    assert.ok(result);
    assert.deepStrictEqual(result!.violations, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildAssertArgs
// ─────────────────────────────────────────────────────────────────────────────

suite('buildAssertArgs', () => {
  test('builds the minimal args from default options', () => {
    const args = buildAssertArgs(BASELINE, COMPARE, DEFAULT_OPTS);
    assert.ok(args.includes('--baseline'));
    assert.ok(args.includes('/snaps/v1.snap'));
    assert.ok(args.includes('--current'));
    assert.ok(args.includes('/snaps/v2.snap'));
    assert.ok(args.includes('--latency-regression'));
    assert.ok(args.includes('20'));
    assert.ok(args.includes('--error-rate-delta'));
    assert.ok(args.includes('0.05'));
    assert.ok(args.includes('--payload-size-delta'));
    assert.ok(args.includes('50'));
  });

  test('includes --deny-removed-fields when set', () => {
    const args = buildAssertArgs(BASELINE, COMPARE, { ...DEFAULT_OPTS, denyRemovedFields: true });
    assert.ok(args.includes('--deny-removed-fields'));
  });

  test('includes --fail-on-warn when set', () => {
    const args = buildAssertArgs(BASELINE, COMPARE, { ...DEFAULT_OPTS, failOnWarn: true });
    assert.ok(args.includes('--fail-on-warn'));
  });

  test('does not include optional flags when false', () => {
    const args = buildAssertArgs(BASELINE, COMPARE, DEFAULT_OPTS);
    assert.ok(!args.includes('--deny-removed-fields'));
    assert.ok(!args.includes('--fail-on-warn'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildAssertResultHtml
// ─────────────────────────────────────────────────────────────────────────────

suite('buildAssertResultHtml', () => {
  test('shows "passed" content for a clean result', () => {
    const html = buildAssertResultHtml(BASELINE, COMPARE, PASSED_RESULT, DEFAULT_OPTS);
    assert.ok(html.includes('passed'));
    assert.ok(!html.includes('REGRESSION'));
  });

  test('shows violation rows for a failed result', () => {
    const html = buildAssertResultHtml(BASELINE, COMPARE, FAILED_RESULT, DEFAULT_OPTS);
    assert.ok(html.includes('REGRESSION'));
    assert.ok(html.includes('WARN'));
    assert.ok(html.includes('p99 latency'));
  });

  test('shows both tag names in the result', () => {
    const html = buildAssertResultHtml(BASELINE, COMPARE, PASSED_RESULT, DEFAULT_OPTS);
    assert.ok(html.includes('v1.0'));
    assert.ok(html.includes('v2.0'));
  });

  test('shows the threshold options used', () => {
    const html = buildAssertResultHtml(BASELINE, COMPARE, PASSED_RESULT, DEFAULT_OPTS);
    assert.ok(html.includes('latency-regression'));
    assert.ok(html.includes('error-rate-delta'));
  });

  test('produces no unresolved template placeholders', () => {
    const html = buildAssertResultHtml(BASELINE, COMPARE, FAILED_RESULT, DEFAULT_OPTS);
    assert.ok(!html.includes('${'));
  });

  test('HTML-escapes tag names containing special chars', () => {
    const snap = makeSnap('<b>injection</b>', '/snaps/x.snap');
    const html = buildAssertResultHtml(snap, COMPARE, PASSED_RESULT, DEFAULT_OPTS);
    assert.ok(!html.includes('<b>injection</b>'));
    assert.ok(html.includes('&lt;b&gt;injection&lt;/b&gt;'));
  });
});
