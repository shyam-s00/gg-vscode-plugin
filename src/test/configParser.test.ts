import * as assert from 'assert';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import {
  findSiblingConfig,
  isGgConfigFile,
  parseGgConfig,
  resolveHttpFile,
} from '../config/configParser';

suite('configParser', () => {
  test('parses a full .gg.yaml document', () => {
    const parsed = parseGgConfig(`
config:
  httpFile: "request.http"
  prometheus: false
  breaker_threshold_pct: 20.0
  jitter: 0.1
  time_scale: 1.0
snap:
  sample_rate: 0.05
  max_samples: 200
  max_body_kb: 0
stages:
  - name: "Ramp Up"
    duration: 10s
    target_rps: 75
  - duration: 15s
    target_rps: 500
`);

    assert.ok(parsed);
    assert.strictEqual(parsed?.config.httpFile, 'request.http');
    assert.strictEqual(parsed?.config.breaker_threshold_pct, 20.0);
    assert.strictEqual(parsed?.config.jitter, 0.1);
    assert.strictEqual(parsed?.snap?.sample_rate, 0.05);
    assert.strictEqual(parsed?.stages.length, 2);
    assert.strictEqual(parsed?.stages[0].name, 'Ramp Up');
    assert.strictEqual(parsed?.stages[0].duration, '10s');
    assert.strictEqual(parsed?.stages[1].name, undefined);
    assert.strictEqual(parsed?.stages[1].target_rps, 500);
  });

  test('parses a minimal document with only config.httpFile', () => {
    const parsed = parseGgConfig('config:\n  httpFile: "api.http"\n');
    assert.ok(parsed);
    assert.strictEqual(parsed?.config.httpFile, 'api.http');
    assert.deepStrictEqual(parsed?.stages, []);
    assert.strictEqual(parsed?.snap, undefined);
  });

  test('returns undefined for invalid YAML', () => {
    assert.strictEqual(parseGgConfig('config: [unterminated'), undefined);
  });

  test('returns undefined when config.httpFile is missing', () => {
    assert.strictEqual(parseGgConfig('config:\n  prometheus: true\n'), undefined);
    assert.strictEqual(parseGgConfig('stages: []\n'), undefined);
    assert.strictEqual(parseGgConfig(''), undefined);
  });

  test('isGgConfigFile matches the *.gg.yaml convention only', () => {
    assert.strictEqual(isGgConfigFile('traffic-sim.gg.yaml'), true);
    assert.strictEqual(isGgConfigFile('config.yaml'), false);
    assert.strictEqual(isGgConfigFile('gg.yaml'), false);
    assert.strictEqual(isGgConfigFile('request.http'), false);
  });

  test('resolveHttpFile resolves relative to the config file directory', () => {
    const parsed = parseGgConfig('config:\n  httpFile: "../requests/api.http"\n');
    assert.ok(parsed);
    const resolved = resolveHttpFile('/workspace/configs/traffic-sim.gg.yaml', parsed!);
    assert.strictEqual(resolved, path.resolve('/workspace/requests/api.http'));
  });

  suite('findSiblingConfig', () => {
    let dir: string;

    setup(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-config-parser-test-'));
    });

    teardown(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    test('finds a sibling *.gg.yaml file', async () => {
      const httpFile = path.join(dir, 'api.http');
      fs.writeFileSync(httpFile, 'GET https://example.com/\n');
      fs.writeFileSync(path.join(dir, 'traffic-sim.gg.yaml'), 'config:\n  httpFile: "api.http"\n');

      const found = await findSiblingConfig(httpFile);
      assert.strictEqual(found, path.join(dir, 'traffic-sim.gg.yaml'));
    });

    test('returns undefined when no sibling config exists', async () => {
      const httpFile = path.join(dir, 'api.http');
      fs.writeFileSync(httpFile, 'GET https://example.com/\n');

      const found = await findSiblingConfig(httpFile);
      assert.strictEqual(found, undefined);
    });

    test('picks the alphabetically-first match when multiple exist', async () => {
      const httpFile = path.join(dir, 'api.http');
      fs.writeFileSync(httpFile, 'GET https://example.com/\n');
      fs.writeFileSync(path.join(dir, 'zzz.gg.yaml'), 'config:\n  httpFile: "api.http"\n');
      fs.writeFileSync(path.join(dir, 'aaa.gg.yaml'), 'config:\n  httpFile: "api.http"\n');

      const found = await findSiblingConfig(httpFile);
      assert.strictEqual(found, path.join(dir, 'aaa.gg.yaml'));
    });
  });
});
