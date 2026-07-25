import * as assert from 'assert';

import { buildConfigRunArgs, buildProfileRunArgs } from '../run/runArgs';

suite('runArgs', () => {
  suite('buildProfileRunArgs', () => {
    test('builds the minimal argv with no overrides, no snap, no heartbeat', () => {
      const args = buildProfileRunArgs({ profileName: 'flash-sale', httpFilePath: '/a/b.http' });
      assert.deepStrictEqual(args, [
        '--profile', 'flash-sale',
        '--http-file', '/a/b.http',
        '--headless', '--reporter', 'json',
      ]);
    });

    test('adds --peak-rps and --duration overrides when provided', () => {
      const args = buildProfileRunArgs({
        profileName: 'load',
        httpFilePath: 'api.http',
        peakRps: 3000,
        duration: '2m',
      });
      assert.deepStrictEqual(args, [
        '--profile', 'load',
        '--http-file', 'api.http',
        '--peak-rps', '3000',
        '--duration', '2m',
        '--headless', '--reporter', 'json',
      ]);
    });

    test('adds --snap and --snap-tag when snap is enabled with a tag', () => {
      const args = buildProfileRunArgs({
        profileName: 'soak',
        httpFilePath: 'api.http',
        snap: { enabled: true, tag: 'v1.2.0' },
      });
      assert.deepStrictEqual(args, [
        '--profile', 'soak',
        '--http-file', 'api.http',
        '--snap', '--snap-tag', 'v1.2.0',
        '--headless', '--reporter', 'json',
      ]);
    });

    test('adds --snap without --snap-tag when no tag is given', () => {
      const args = buildProfileRunArgs({
        profileName: 'soak',
        httpFilePath: 'api.http',
        snap: { enabled: true },
      });
      assert.deepStrictEqual(args, [
        '--profile', 'soak',
        '--http-file', 'api.http',
        '--snap',
        '--headless', '--reporter', 'json',
      ]);
    });

    test('omits --snap entirely when snap.enabled is false', () => {
      const args = buildProfileRunArgs({
        profileName: 'soak',
        httpFilePath: 'api.http',
        snap: { enabled: false, tag: 'ignored' },
      });
      assert.ok(!args.includes('--snap'));
      assert.ok(!args.includes('--snap-tag'));
    });

    test('adds --heartbeat-interval only when > 0', () => {
      const withInterval = buildProfileRunArgs({
        profileName: 'smoke',
        httpFilePath: 'api.http',
        heartbeatIntervalSeconds: 2,
      });
      assert.deepStrictEqual(withInterval.slice(-2), ['--heartbeat-interval', '2s']);

      const withoutInterval = buildProfileRunArgs({
        profileName: 'smoke',
        httpFilePath: 'api.http',
        heartbeatIntervalSeconds: 0,
      });
      assert.ok(!withoutInterval.includes('--heartbeat-interval'));
    });
  });

  suite('buildConfigRunArgs', () => {
    test('builds the minimal argv with just the config path', () => {
      const args = buildConfigRunArgs({ configPath: 'traffic-sim.gg.yaml' });
      assert.deepStrictEqual(args, ['traffic-sim.gg.yaml', '--headless', '--reporter', 'json']);
    });

    test('adds snap and heartbeat flags when provided', () => {
      const args = buildConfigRunArgs({
        configPath: 'traffic-sim.gg.yaml',
        snap: { enabled: true, tag: 'pr-42' },
        heartbeatIntervalSeconds: 5,
      });
      assert.deepStrictEqual(args, [
        'traffic-sim.gg.yaml',
        '--snap', '--snap-tag', 'pr-42',
        '--headless', '--reporter', 'json',
        '--heartbeat-interval', '5s',
      ]);
    });
  });
});
