"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const snapDiffPanel_1 = require("../snap/snapDiffPanel");
const snapViewPanel_1 = require("../snap/snapViewPanel");
// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────
function makeEndpoint(id, p99, errorRate = 0, sampleCount = 100) {
    return {
        id,
        status_dist: { '200': 1 - errorRate, ...(errorRate > 0 ? { '500': errorRate } : {}) },
        latency: { p50: p99 * 0.5, p95: p99 * 0.9, p99, max: p99 * 1.2 },
        error_rate: errorRate,
        sample_count: sampleCount,
    };
}
function makeSnap(tag, startTime, endpoints = [makeEndpoint('GET:http://localhost/api', 100)]) {
    return {
        version: 1,
        meta: { tag, start_time: startTime, end_time: startTime, peak_rps: 100, total_requests: 1000 },
        endpoints,
        filePath: `/snaps/${tag}.snap`,
        internalIndex: 1,
    };
}
const BASELINE = makeSnap('v1.0', '2026-06-01T10:00:00Z', [
    makeEndpoint('GET:http://localhost/users', 100, 0.01, 500),
    makeEndpoint('POST:http://localhost/items', 200, 0, 300),
    makeEndpoint('GET:http://localhost/old', 50, 0, 100),
]);
const COMPARE = makeSnap('v1.1', '2026-06-02T10:00:00Z', [
    makeEndpoint('GET:http://localhost/users', 130, 0.08, 510), // p99 +30% → REGRESSION; err 0.08 > 0.05 → REGRESSION
    makeEndpoint('POST:http://localhost/items', 190, 0, 310), // p99 -5% → improvement → PASS
    makeEndpoint('GET:http://localhost/new', 80, 0, 200), // new endpoint → ADDED
    // GET:http://localhost/old missing → REMOVED
]);
// ─────────────────────────────────────────────────────────────────────────────
// formatEndpointId
// ─────────────────────────────────────────────────────────────────────────────
suite('formatEndpointId', () => {
    test('extracts method and path from a full URL', () => {
        assert.strictEqual((0, snapViewPanel_1.formatEndpointId)('GET:http://localhost:8080/api/users'), 'GET /api/users');
    });
    test('includes query string in the formatted label', () => {
        assert.strictEqual((0, snapViewPanel_1.formatEndpointId)('GET:http://localhost/search?q=foo'), 'GET /search?q=foo');
    });
    test('returns raw value when URL is not parseable', () => {
        assert.strictEqual((0, snapViewPanel_1.formatEndpointId)('GET:/relative/path'), 'GET /relative/path');
    });
    test('returns the id unchanged when there is no colon separator', () => {
        assert.strictEqual((0, snapViewPanel_1.formatEndpointId)('no-colon-here'), 'no-colon-here');
    });
    test('handles POST with a full URL', () => {
        assert.strictEqual((0, snapViewPanel_1.formatEndpointId)('POST:http://api.example.com/v2/orders'), 'POST /v2/orders');
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// computeDiff
// ─────────────────────────────────────────────────────────────────────────────
suite('computeDiff', () => {
    test('marks an endpoint with p99 > +20% as REGRESSION', () => {
        const diffs = (0, snapDiffPanel_1.computeDiff)(BASELINE, COMPARE);
        const users = diffs.find((d) => d.id === 'GET:http://localhost/users');
        assert.ok(users);
        assert.strictEqual(users.verdict, 'REGRESSION');
        assert.ok(users.p99Delta !== undefined && users.p99Delta > 20);
    });
    test('marks an endpoint with improved latency as PASS', () => {
        const diffs = (0, snapDiffPanel_1.computeDiff)(BASELINE, COMPARE);
        const items = diffs.find((d) => d.id === 'POST:http://localhost/items');
        assert.ok(items);
        assert.strictEqual(items.verdict, 'PASS');
        assert.ok(items.p99Delta !== undefined && items.p99Delta < 0);
    });
    test('marks a new endpoint as ADDED', () => {
        const diffs = (0, snapDiffPanel_1.computeDiff)(BASELINE, COMPARE);
        const added = diffs.find((d) => d.id === 'GET:http://localhost/new');
        assert.ok(added);
        assert.strictEqual(added.verdict, 'ADDED');
        assert.ok(!added.baseline);
        assert.ok(added.compare);
    });
    test('marks a missing endpoint as REMOVED', () => {
        const diffs = (0, snapDiffPanel_1.computeDiff)(BASELINE, COMPARE);
        const removed = diffs.find((d) => d.id === 'GET:http://localhost/old');
        assert.ok(removed);
        assert.strictEqual(removed.verdict, 'REMOVED');
        assert.ok(removed.baseline);
        assert.ok(!removed.compare);
    });
    test('marks high error_rate delta as REGRESSION even if latency is fine', () => {
        const base = makeSnap('b', '2026-01-01T00:00:00Z', [makeEndpoint('GET:http://x/y', 100, 0.01)]);
        const cmp = makeSnap('c', '2026-01-02T00:00:00Z', [makeEndpoint('GET:http://x/y', 102, 0.10)]);
        const diffs = (0, snapDiffPanel_1.computeDiff)(base, cmp);
        assert.strictEqual(diffs[0].verdict, 'REGRESSION');
    });
    test('returns an empty array when both snaps have no endpoints', () => {
        const base = makeSnap('b', '2026-01-01T00:00:00Z', []);
        const cmp = makeSnap('c', '2026-01-02T00:00:00Z', []);
        assert.deepStrictEqual((0, snapDiffPanel_1.computeDiff)(base, cmp), []);
    });
    test('always orders oldest as baseline when inputs are swapped', () => {
        // showSnapDiff handles ordering, not computeDiff — but the diff itself
        // should still work correctly regardless of argument order.
        const diffs = (0, snapDiffPanel_1.computeDiff)(COMPARE, BASELINE);
        // Now COMPARE is passed as "baseline" → users endpoint regresses in the opposite direction
        const users = diffs.find((d) => d.id === 'GET:http://localhost/users');
        assert.ok(users && users.p99Delta !== undefined && users.p99Delta < 0);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// HTML smoke tests
// ─────────────────────────────────────────────────────────────────────────────
const FAKE_WEBVIEW = { cspSource: 'vscode-webview://fake' };
suite('buildSnapViewHtml', () => {
    test('contains the snapshot tag in the output', () => {
        const snap = makeSnap('v2.0', '2026-06-01T10:00:00Z');
        const html = (0, snapViewPanel_1.buildSnapViewHtml)(FAKE_WEBVIEW, snap, 'v2.0');
        assert.ok(html.includes('v2.0'));
    });
    test('contains a table row for each endpoint', () => {
        const snap = makeSnap('t', '2026-01-01T00:00:00Z', [
            makeEndpoint('GET:http://a/x', 10),
            makeEndpoint('POST:http://a/y', 20),
        ]);
        const html = (0, snapViewPanel_1.buildSnapViewHtml)(FAKE_WEBVIEW, snap, 't');
        assert.ok(html.includes('GET /x'));
        assert.ok(html.includes('POST /y'));
    });
    test('produces no unresolved template placeholders', () => {
        const html = (0, snapViewPanel_1.buildSnapViewHtml)(FAKE_WEBVIEW, makeSnap('t', '2026-01-01T00:00:00Z'), 't');
        assert.ok(!html.includes('${'), 'found an unresolved template placeholder');
    });
});
suite('buildSnapDiffHtml', () => {
    test('contains both tag names', () => {
        const html = (0, snapDiffPanel_1.buildSnapDiffHtml)(BASELINE, COMPARE, 'v1.0', 'v1.1');
        assert.ok(html.includes('v1.0'));
        assert.ok(html.includes('v1.1'));
    });
    test('shows a regression summary when regressions exist', () => {
        const html = (0, snapDiffPanel_1.buildSnapDiffHtml)(BASELINE, COMPARE, 'v1.0', 'v1.1');
        assert.ok(html.includes('regression'));
    });
    test('produces no unresolved template placeholders', () => {
        const html = (0, snapDiffPanel_1.buildSnapDiffHtml)(BASELINE, COMPARE, 'v1.0', 'v1.1');
        assert.ok(!html.includes('${'));
    });
});
//# sourceMappingURL=snapPanels.test.js.map