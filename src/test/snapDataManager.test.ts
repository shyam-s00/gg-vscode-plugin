import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { defaultSnapshotsDir, loadSnaps, parseSnapFile, resolveSnapshotsDir } from '../snap/snapDataManager';
import { endpointRequestCount } from '../snap/snapModel';
import { formatSnapDate } from '../snap/snapTreeProvider';

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
    assert.ok(resolved.includes('snapshots'));
  });
});

suite('defaultSnapshotsDir', () => {
  test('returns a non-empty path containing "gg" and "snapshots"', () => {
    const dir = defaultSnapshotsDir();
    assert.ok(dir.length > 0);
    assert.ok(dir.includes('gg'), `expected "gg" in "${dir}"`);
    assert.ok(dir.includes('snapshots'), `expected "snapshots" in "${dir}"`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Real snap file shape — fixtures embedded verbatim from ~/dev/snap-gg/ to
// catch any drift between our type definitions and what gg actually emits.
//
// Key differences from the synthetic fixtures above:
//  · Timezone-offset timestamps (not UTC Z-suffix)
//  · config_hash present on meta
//  · Empty tag string ""
//  · sample_count per endpoint (not request_count)
//  · No payload_size, no schema, no snap_settings (minimal real-world output)
// ─────────────────────────────────────────────────────────────────────────────

const REAL_SNAP = `{
  "version": 1,
  "meta": {
    "tag": "",
    "start_time": "2026-03-20T20:57:58.274571-03:00",
    "end_time": "2026-03-20T20:59:18.471139-03:00",
    "peak_rps": 650,
    "total_requests": 26941,
    "config_hash": "sha256:9416f385646841cdd45897a8d85faf99f14c9ee93da06209f843027b11c1fa3c"
  },
  "endpoints": [
    {
      "id": "POST:http://localhost:8080/post-bench",
      "status_dist": { "200": 1 },
      "latency": { "p50": 100, "p95": 102, "p99": 102, "max": 106 },
      "error_rate": 0,
      "sample_count": 8980
    },
    {
      "id": "GET:http://localhost:8080/slow-get",
      "status_dist": { "200": 1 },
      "latency": { "p50": 500, "p95": 502, "p99": 503, "max": 507 },
      "error_rate": 0,
      "sample_count": 8980
    },
    {
      "id": "GET:http://localhost:8080/fast-get",
      "status_dist": { "200": 1 },
      "latency": { "p50": 50, "p95": 52, "p99": 53, "max": 59 },
      "error_rate": 0,
      "sample_count": 8981
    }
  ]
}`;

suite('real snap file format', () => {
  test('parseSnapFile succeeds on the exact JSON gg produces', () => {
    const model = parseSnapFile(REAL_SNAP);
    assert.ok(model, 'parseSnapFile returned undefined for a real snap');
    assert.strictEqual(model!.version, 1);
    assert.strictEqual(model!.meta.tag, '');
    assert.strictEqual(model!.meta.peak_rps, 650);
    assert.strictEqual(model!.meta.total_requests, 26941);
    assert.strictEqual(model!.meta.config_hash, 'sha256:9416f385646841cdd45897a8d85faf99f14c9ee93da06209f843027b11c1fa3c');
    assert.strictEqual(model!.endpoints.length, 3);
  });

  test('endpoint fields from the real file are parsed correctly', () => {
    const model = parseSnapFile(REAL_SNAP)!;
    const bench = model.endpoints.find((e) => e.id === 'POST:http://localhost:8080/post-bench');
    assert.ok(bench);
    assert.strictEqual(bench!.latency.p99, 102);
    assert.strictEqual(bench!.error_rate, 0);
    assert.strictEqual(bench!.sample_count, 8980);
    assert.strictEqual(bench!.request_count, undefined);
    assert.strictEqual(bench!.payload_size, undefined);
    assert.strictEqual(bench!.schema, undefined);
  });

  test('endpointRequestCount works with sample_count as gg emits it', () => {
    const model = parseSnapFile(REAL_SNAP)!;
    const ep = model.endpoints[0];
    assert.strictEqual(endpointRequestCount(ep), 8980);
  });

  test('formatSnapDate handles the timezone-offset timestamp format gg produces', () => {
    const result = formatSnapDate('2026-03-20T20:57:58.274571-03:00');
    // Must produce a non-empty human-readable string (not the raw fallback or "Invalid Date").
    assert.ok(result.length > 0);
    assert.ok(!result.includes('Invalid Date'), `got "${result}" instead of a formatted date`);
    assert.ok(!result.includes('2026-03-20T'), 'expected display format, not raw ISO string');
  });

  suite('loadSnaps with real-shaped content written to disk', () => {
    let dir: string;

    setup(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-real-snap-'));
      fs.writeFileSync(path.join(dir, 'run-20260320-235918.snap'), REAL_SNAP);
    });

    teardown(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test('loads and returns a LoadedSnap with correct metadata', async () => {
      const snaps = await loadSnaps(dir);
      assert.strictEqual(snaps.length, 1);
      assert.strictEqual(snaps[0].meta.total_requests, 26941);
      assert.strictEqual(snaps[0].meta.peak_rps, 650);
      assert.strictEqual(snaps[0].internalIndex, 1);
      assert.ok(snaps[0].filePath.endsWith('run-20260320-235918.snap'));
    });

    test('tag is empty string, not undefined, when gg omits the tag', async () => {
      const snaps = await loadSnaps(dir);
      assert.strictEqual(snaps[0].meta.tag, '');
    });

    test('all three endpoints from the real file are loaded', async () => {
      const snaps = await loadSnaps(dir);
      assert.strictEqual(snaps[0].endpoints.length, 3);
    });
  });
});
