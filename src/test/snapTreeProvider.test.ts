import * as assert from 'assert';

import { formatSnapDate, SNAP_ITEM_CONTEXT, SnapTreeItem } from '../snap/snapTreeProvider';
import type { LoadedSnap } from '../snap/snapModel';

function makeSnap(overrides: Partial<LoadedSnap['meta']> = {}, index = 1): LoadedSnap {
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
    const result = formatSnapDate('2026-06-30T12:00:00.000Z');
    assert.ok(result.length > 0);
  });

  test('falls back to first 16 characters for an unparseable string', () => {
    const result = formatSnapDate('not-a-date-at-all');
    assert.strictEqual(result, 'not-a-date-at-al');
  });
});

suite('SnapTreeItem', () => {
  test('label contains the internalIndex and tag', () => {
    const item = new SnapTreeItem(makeSnap({ tag: 'v1.0.0' }, 3));
    assert.ok(String(item.label).includes('#3'));
    assert.ok(String(item.label).includes('v1.0.0'));
  });

  test('label shows "(untagged)" when the tag is empty', () => {
    const item = new SnapTreeItem(makeSnap({ tag: '' }, 1));
    assert.ok(String(item.label).includes('(untagged)'));
  });

  test('label shows "(untagged)" when the tag is whitespace-only', () => {
    const item = new SnapTreeItem(makeSnap({ tag: '   ' }, 1));
    assert.ok(String(item.label).includes('(untagged)'));
  });

  test('description includes total_requests and peak_rps', () => {
    const item = new SnapTreeItem(makeSnap({ total_requests: 26941, peak_rps: 650 }));
    assert.ok(String(item.description).includes('26,941'));
    assert.ok(String(item.description).includes('650'));
  });

  test('contextValue is the expected constant', () => {
    const item = new SnapTreeItem(makeSnap());
    assert.strictEqual(item.contextValue, SNAP_ITEM_CONTEXT);
  });

  test('command triggers gg.viewSnap with the item as argument', () => {
    const item = new SnapTreeItem(makeSnap());
    assert.strictEqual(item.command?.command, 'gg.viewSnap');
    assert.deepStrictEqual(item.command?.arguments, [item]);
  });

  test('snap reference is the LoadedSnap passed in', () => {
    const snap = makeSnap({ tag: 'release' });
    const item = new SnapTreeItem(snap);
    assert.strictEqual(item.snap, snap);
  });
});
