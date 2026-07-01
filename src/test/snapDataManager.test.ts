import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { defaultSnapshotsDir, loadSnaps, parseSnapFile, resolveSnapshotsDir } from '../snap/snapDataManager';
import { endpointRequestCount } from '../snap/snapModel';

const SNAP_V1_MINIMAL = JSON.stringify({
  version: 1,
  meta: {
    tag: 'v1.0.0',
    start_time: '2026-03-20T20:57:58Z',
    end_time: '2026-03-20T20:59:18Z',
    peak_rps: 650,
    total_requests: 26941,
  },
  endpoints: [
    { id: 'GET:http://localhost:8080/api', status_dist: { '200': 1 }, latency: { p50: 50, p95: 52, p99: 53, max: 60 }, error_rate: 0, sample_count: 100 },
  ],
});

const SNAP_V1_WITH_SCHEMA = JSON.stringify({
  version: 1,
  meta: { tag: 'v2.0.0', start_time: '2026-03-21T10:00:00Z', end_time: '2026-03-21T10:01:00Z', peak_rps: 100, total_requests: 500 },
  endpoints: [
    {
      id: 'GET:http://localhost/users',
      status_dist: { '200': 0.99, '500': 0.01 },
      latency: { p50: 10, p95: 40, p99: 90, max: 200 },
      payload_size: { avg: 512, p95: 1024, max: 2048 },
      error_rate: 0.01,
      request_count: 495,
      body_samples_stored: 25,
      schema: {
        sample_count: 25,
        fields: {
          id: { type: 'number', presence: 1.0, stability: 'STABLE' },
          name: { type: 'string', presence: 0.95, stability: 'STABLE' },
        },
      },
    },
  ],
});

suite('resolveSnapshotsDir', () => {
  test('returns the override when non-empty', () => {
    assert.strictEqual(resolveSnapshotsDir('/custom/path'), '/custom/path');
    assert.strictEqual(resolveSnapshotsDir('  /trimmed  '), '/trimmed');
  });

  test('falls back to the platform default when the override is empty', () => {
    const resolved = resolveSnapshotsDir('');
    assert.ok(resolved.length > 0);
    assert.ok(resolved.includes('gg'));
    assert.ok(resolved.includes('snaps'));
  });
});

suite('defaultSnapshotsDir', () => {
  test('returns a non-empty path containing "gg" and "snaps"', () => {
    const dir = defaultSnapshotsDir();
    assert.ok(dir.length > 0);
    assert.ok(dir.includes('gg'), `expected "gg" in "${dir}"`);
    assert.ok(dir.includes('snaps'), `expected "snaps" in "${dir}"`);
  });

  test('starts from the user home directory', () => {
    const dir = defaultSnapshotsDir();
    assert.ok(dir.startsWith(os.homedir()) || dir.startsWith(process.env['APPDATA'] ?? ''));
  });
});

suite('parseSnapFile', () => {
  test('parses a minimal valid snap', () => {
    const model = parseSnapFile(SNAP_V1_MINIMAL);
    assert.ok(model);
    assert.strictEqual(model?.version, 1);
    assert.strictEqual(model?.meta.tag, 'v1.0.0');
    assert.strictEqual(model?.meta.peak_rps, 650);
    assert.strictEqual(model?.endpoints.length, 1);
    assert.strictEqual(model?.endpoints[0].id, 'GET:http://localhost:8080/api');
    assert.strictEqual(model?.endpoints[0].sample_count, 100);
  });

  test('parses a snap with schema, payload_size and request_count', () => {
    const model = parseSnapFile(SNAP_V1_WITH_SCHEMA);
    assert.ok(model);
    const ep = model?.endpoints[0];
    assert.strictEqual(ep?.payload_size?.avg, 512);
    assert.strictEqual(ep?.request_count, 495);
    assert.strictEqual(ep?.schema?.fields['id'].stability, 'STABLE');
    assert.strictEqual(ep?.schema?.fields['name'].presence, 0.95);
  });

  test('returns undefined for invalid JSON', () => {
    assert.strictEqual(parseSnapFile('not json'), undefined);
  });

  test('returns undefined when meta.start_time is missing', () => {
    const bad = JSON.stringify({ version: 1, meta: { tag: 'x' }, endpoints: [] });
    assert.strictEqual(parseSnapFile(bad), undefined);
  });

  test('returns undefined for empty input', () => {
    assert.strictEqual(parseSnapFile(''), undefined);
  });
});

suite('loadSnaps', () => {
  let dir: string;

  setup(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-snapdata-'));
  });

  teardown(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('returns an empty array when the directory does not exist', async () => {
    const result = await loadSnaps(path.join(dir, 'nonexistent'));
    assert.deepStrictEqual(result, []);
  });

  test('returns an empty array for an empty directory', async () => {
    const result = await loadSnaps(dir);
    assert.deepStrictEqual(result, []);
  });

  test('loads, sorts newest-first, and assigns internalIndex oldest=1', async () => {
    // Write two snaps; SNAP_V1_MINIMAL has an earlier start_time.
    fs.writeFileSync(path.join(dir, 'run-old.snap'), SNAP_V1_MINIMAL);
    fs.writeFileSync(path.join(dir, 'run-new.snap'), SNAP_V1_WITH_SCHEMA);
    // Write a non-snap file that should be skipped.
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'ignore me');

    const snaps = await loadSnaps(dir);

    assert.strictEqual(snaps.length, 2);
    // Newest first in display order.
    assert.strictEqual(snaps[0].meta.tag, 'v2.0.0');
    assert.strictEqual(snaps[1].meta.tag, 'v1.0.0');
    // But internalIndex is oldest=1, newest=N.
    assert.strictEqual(snaps[1].internalIndex, 1);
    assert.strictEqual(snaps[0].internalIndex, 2);
    // filePath is populated.
    assert.ok(snaps[0].filePath.endsWith('run-new.snap'));
    assert.ok(snaps[1].filePath.endsWith('run-old.snap'));
  });

  test('silently skips malformed snap files', async () => {
    fs.writeFileSync(path.join(dir, 'valid.snap'), SNAP_V1_MINIMAL);
    fs.writeFileSync(path.join(dir, 'corrupt.snap'), 'not valid json {{{');

    const snaps = await loadSnaps(dir);
    assert.strictEqual(snaps.length, 1);
    assert.strictEqual(snaps[0].meta.tag, 'v1.0.0');
  });
});

suite('endpointRequestCount', () => {
  test('returns sample_count when present', () => {
    const ep = { id: 'GET:/', status_dist: {}, latency: { p50: 0, p95: 0, p99: 0, max: 0 }, error_rate: 0, sample_count: 42 };
    assert.strictEqual(endpointRequestCount(ep), 42);
  });

  test('falls back to request_count when sample_count is absent', () => {
    const ep = { id: 'GET:/', status_dist: {}, latency: { p50: 0, p95: 0, p99: 0, max: 0 }, error_rate: 0, request_count: 99 };
    assert.strictEqual(endpointRequestCount(ep), 99);
  });

  test('returns 0 when both are absent', () => {
    const ep = { id: 'GET:/', status_dist: {}, latency: { p50: 0, p95: 0, p99: 0, max: 0 }, error_rate: 0 };
    assert.strictEqual(endpointRequestCount(ep), 0);
  });
});
