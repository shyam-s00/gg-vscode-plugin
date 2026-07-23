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
const snapPrunePanel_1 = require("../snap/snapPrunePanel");
// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_OPTS = {
    keepLast: 10,
    dryRun: true,
};
const DRY_RUN_RESULT = {
    dry_run: true,
    snap_dir: '/snaps',
    candidates: [
        { id: 1, tag: 'v1.0', date: '2026-01-01', reason: 'older than 7d' },
        { id: 2, tag: '', date: '2026-01-05', reason: 'keep-last exceeded' },
    ],
    deleted: 0,
    errors: [],
};
const DELETE_RESULT = {
    dry_run: false,
    snap_dir: '/snaps',
    candidates: [
        { id: 1, tag: 'v1.0', date: '2026-01-01', reason: 'older than 7d' },
    ],
    deleted: 1,
    errors: [],
};
// ─────────────────────────────────────────────────────────────────────────────
// parsePruneResult
// ─────────────────────────────────────────────────────────────────────────────
suite('parsePruneResult', () => {
    test('parses a dry-run result with candidates', () => {
        const json = JSON.stringify({ dry_run: true, snap_dir: '/snaps', candidates: [{ id: 1 }], deleted: 0, errors: [] });
        const result = (0, snapPrunePanel_1.parsePruneResult)(json);
        assert.ok(result);
        assert.strictEqual(result.dry_run, true);
        assert.strictEqual(result.deleted, 0);
        assert.strictEqual(result.candidates.length, 1);
    });
    test('parses an actual delete result', () => {
        const json = JSON.stringify({ dry_run: false, candidates: [{ id: 1 }], deleted: 1, errors: [] });
        const result = (0, snapPrunePanel_1.parsePruneResult)(json);
        assert.ok(result);
        assert.strictEqual(result.dry_run, false);
        assert.strictEqual(result.deleted, 1);
    });
    test('defaults missing candidates and errors arrays', () => {
        const json = JSON.stringify({ dry_run: true, deleted: 0 });
        const result = (0, snapPrunePanel_1.parsePruneResult)(json);
        assert.ok(result);
        assert.deepStrictEqual(result.candidates, []);
        assert.deepStrictEqual(result.errors, []);
    });
    test('returns undefined for empty stdout', () => {
        assert.strictEqual((0, snapPrunePanel_1.parsePruneResult)(''), undefined);
        assert.strictEqual((0, snapPrunePanel_1.parsePruneResult)('  '), undefined);
    });
    test('returns undefined for invalid JSON', () => {
        assert.strictEqual((0, snapPrunePanel_1.parsePruneResult)('{invalid'), undefined);
    });
    test('returns undefined when deleted field is missing', () => {
        const json = JSON.stringify({ dry_run: true, candidates: [] });
        assert.strictEqual((0, snapPrunePanel_1.parsePruneResult)(json), undefined);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// buildPruneArgs
// ─────────────────────────────────────────────────────────────────────────────
suite('buildPruneArgs', () => {
    test('always includes --snap-dir and --yes', () => {
        const args = (0, snapPrunePanel_1.buildPruneArgs)('/snaps', DEFAULT_OPTS);
        assert.ok(args.includes('--snap-dir'));
        assert.ok(args.includes('/snaps'));
        assert.ok(args.includes('--yes'));
    });
    test('includes --dry-run when dryRun is true', () => {
        const args = (0, snapPrunePanel_1.buildPruneArgs)('/snaps', { keepLast: 5, dryRun: true });
        assert.ok(args.includes('--dry-run'));
    });
    test('omits --dry-run when dryRun is false', () => {
        const args = (0, snapPrunePanel_1.buildPruneArgs)('/snaps', { keepLast: 5, dryRun: false });
        assert.ok(!args.includes('--dry-run'));
    });
    test('includes --keep-last when provided', () => {
        const args = (0, snapPrunePanel_1.buildPruneArgs)('/snaps', { keepLast: 10, dryRun: true });
        assert.ok(args.includes('--keep-last'));
        assert.ok(args.includes('10'));
    });
    test('includes --ids when provided', () => {
        const args = (0, snapPrunePanel_1.buildPruneArgs)('/snaps', { ids: '1,3,5', dryRun: true });
        assert.ok(args.includes('--ids'));
        assert.ok(args.includes('1,3,5'));
    });
    test('includes --older-than when provided', () => {
        const args = (0, snapPrunePanel_1.buildPruneArgs)('/snaps', { olderThan: '30d', dryRun: true });
        assert.ok(args.includes('--older-than'));
        assert.ok(args.includes('30d'));
    });
    test('includes --tag when provided', () => {
        const args = (0, snapPrunePanel_1.buildPruneArgs)('/snaps', { tag: 'v1.0', dryRun: true });
        assert.ok(args.includes('--tag'));
        assert.ok(args.includes('v1.0'));
    });
    test('omits optional flags when not set', () => {
        const args = (0, snapPrunePanel_1.buildPruneArgs)('/snaps', { dryRun: false });
        assert.ok(!args.includes('--ids'));
        assert.ok(!args.includes('--keep-last'));
        assert.ok(!args.includes('--older-than'));
        assert.ok(!args.includes('--tag'));
    });
    test('trims whitespace from ids before including', () => {
        const args = (0, snapPrunePanel_1.buildPruneArgs)('/snaps', { ids: '  ', dryRun: true });
        assert.ok(!args.includes('--ids'));
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// hasAtLeastOneFilter
// ─────────────────────────────────────────────────────────────────────────────
suite('hasAtLeastOneFilter', () => {
    test('returns false when no filter is set', () => {
        assert.strictEqual((0, snapPrunePanel_1.hasAtLeastOneFilter)({ dryRun: true }), false);
        assert.strictEqual((0, snapPrunePanel_1.hasAtLeastOneFilter)({ ids: '  ', dryRun: true }), false);
    });
    test('returns true when ids is set', () => {
        assert.strictEqual((0, snapPrunePanel_1.hasAtLeastOneFilter)({ ids: '1,2', dryRun: true }), true);
    });
    test('returns true when keepLast is set', () => {
        assert.strictEqual((0, snapPrunePanel_1.hasAtLeastOneFilter)({ keepLast: 5, dryRun: true }), true);
    });
    test('returns true when olderThan is set', () => {
        assert.strictEqual((0, snapPrunePanel_1.hasAtLeastOneFilter)({ olderThan: '30d', dryRun: true }), true);
    });
    test('returns true when tag is set', () => {
        assert.strictEqual((0, snapPrunePanel_1.hasAtLeastOneFilter)({ tag: 'v1', dryRun: true }), true);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// buildPruneResultHtml
// ─────────────────────────────────────────────────────────────────────────────
suite('buildPruneResultHtml', () => {
    test('shows dry-run preview copy when dry_run is true', () => {
        const html = (0, snapPrunePanel_1.buildPruneResultHtml)(DRY_RUN_RESULT, DEFAULT_OPTS);
        assert.ok(html.includes('Prune Preview'));
        assert.ok(html.includes('would be deleted'));
    });
    test('shows delete-complete copy when dry_run is false', () => {
        const html = (0, snapPrunePanel_1.buildPruneResultHtml)(DELETE_RESULT, { ...DEFAULT_OPTS, dryRun: false });
        assert.ok(html.includes('Prune Complete'));
        assert.ok(html.includes('deleted'));
    });
    test('renders a table row for each candidate', () => {
        const html = (0, snapPrunePanel_1.buildPruneResultHtml)(DRY_RUN_RESULT, DEFAULT_OPTS);
        assert.ok(html.includes('v1.0'));
        assert.ok(html.includes('older than 7d'));
    });
    test('shows filter summary', () => {
        const html = (0, snapPrunePanel_1.buildPruneResultHtml)(DRY_RUN_RESULT, { keepLast: 10, dryRun: true });
        assert.ok(html.includes('keep-last'));
    });
    test('produces no unresolved template placeholders', () => {
        const html = (0, snapPrunePanel_1.buildPruneResultHtml)(DRY_RUN_RESULT, DEFAULT_OPTS);
        assert.ok(!html.includes('${'));
    });
    test('HTML-escapes candidate values to prevent injection', () => {
        const result = {
            dry_run: true, snap_dir: '/s', deleted: 0, errors: [],
            candidates: [{ id: 1, tag: '<script>alert(1)</script>', reason: 'test' }],
        };
        const html = (0, snapPrunePanel_1.buildPruneResultHtml)(result, DEFAULT_OPTS);
        assert.ok(!html.includes('<script>'));
        assert.ok(html.includes('&lt;script&gt;'));
    });
});
//# sourceMappingURL=snapPrune.test.js.map