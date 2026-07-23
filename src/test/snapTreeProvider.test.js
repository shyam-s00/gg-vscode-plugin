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
const snapTreeProvider_1 = require("../snap/snapTreeProvider");
function makeSnap(overrides = {}, index = 1) {
    return {
        version: 1,
        meta: {
            tag: 'v1.0.0',
            start_time: '2026-06-30T12:00:00.000Z',
            end_time: '2026-06-30T12:05:00.000Z',
            peak_rps: 500,
            total_requests: 1500,
            ...overrides,
        },
        endpoints: [],
        filePath: '/snaps/run.snap',
        internalIndex: index,
    };
}
suite('formatSnapDate', () => {
    test('returns a non-empty string for a valid ISO timestamp', () => {
        const result = (0, snapTreeProvider_1.formatSnapDate)('2026-06-30T12:00:00.000Z');
        assert.ok(result.length > 0);
    });
    test('falls back to first 16 characters for an unparseable string', () => {
        const result = (0, snapTreeProvider_1.formatSnapDate)('not-a-date-at-all');
        assert.strictEqual(result, 'not-a-date-at-al');
    });
});
suite('SnapTreeItem', () => {
    test('label contains the internalIndex and tag', () => {
        const item = new snapTreeProvider_1.SnapTreeItem(makeSnap({ tag: 'v1.0.0' }, 3));
        assert.ok(String(item.label).includes('#3'));
        assert.ok(String(item.label).includes('v1.0.0'));
    });
    test('label shows "(untagged)" when the tag is empty', () => {
        const item = new snapTreeProvider_1.SnapTreeItem(makeSnap({ tag: '' }, 1));
        assert.ok(String(item.label).includes('(untagged)'));
    });
    test('label shows "(untagged)" when the tag is whitespace-only', () => {
        const item = new snapTreeProvider_1.SnapTreeItem(makeSnap({ tag: '   ' }, 1));
        assert.ok(String(item.label).includes('(untagged)'));
    });
    test('description includes total_requests and peak_rps', () => {
        const item = new snapTreeProvider_1.SnapTreeItem(makeSnap({ total_requests: 26941, peak_rps: 650 }));
        assert.ok(String(item.description).includes('26,941'));
        assert.ok(String(item.description).includes('650'));
    });
    test('contextValue is the expected constant', () => {
        const item = new snapTreeProvider_1.SnapTreeItem(makeSnap());
        assert.strictEqual(item.contextValue, snapTreeProvider_1.SNAP_ITEM_CONTEXT);
    });
    test('command triggers gg.viewSnap with the item as argument', () => {
        const item = new snapTreeProvider_1.SnapTreeItem(makeSnap());
        assert.strictEqual(item.command?.command, 'gg.viewSnap');
        assert.deepStrictEqual(item.command?.arguments, [item]);
    });
    test('snap reference is the LoadedSnap passed in', () => {
        const snap = makeSnap({ tag: 'release' });
        const item = new snapTreeProvider_1.SnapTreeItem(snap);
        assert.strictEqual(item.snap, snap);
    });
});
//# sourceMappingURL=snapTreeProvider.test.js.map