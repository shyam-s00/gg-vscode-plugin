import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { resolveHttpFileFromLine } from '../providers/definitionProvider';

suite('resolveHttpFileFromLine', () => {
  let dir: string;

  setup(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-definition-provider-'));
    fs.writeFileSync(path.join(dir, 'request.http'), 'GET https://example.com/\n');
  });

  teardown(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('resolves a quoted httpFile value when cursor is in the value', () => {
    const configPath = path.join(dir, 'traffic-sim.gg.yaml');
    const line = '  httpFile: "request.http"';
    const result = resolveHttpFileFromLine(configPath, line, 14);
    assert.strictEqual(result, path.join(dir, 'request.http'));
  });

  test('resolves an unquoted httpFile value', () => {
    const configPath = path.join(dir, 'traffic-sim.gg.yaml');
    const line = '  httpFile: request.http';
    const result = resolveHttpFileFromLine(configPath, line, 14);
    assert.strictEqual(result, path.join(dir, 'request.http'));
  });

  test('returns undefined when cursor is on the key, not the value', () => {
    const configPath = path.join(dir, 'traffic-sim.gg.yaml');
    const line = '  httpFile: "request.http"';
    const result = resolveHttpFileFromLine(configPath, line, 4);
    assert.strictEqual(result, undefined);
  });

  test('returns undefined when the referenced file does not exist on disk', () => {
    const configPath = path.join(dir, 'traffic-sim.gg.yaml');
    const line = '  httpFile: "missing.http"';
    const result = resolveHttpFileFromLine(configPath, line, 14);
    assert.strictEqual(result, undefined);
  });

  test('returns undefined for unrelated YAML lines', () => {
    const configPath = path.join(dir, 'traffic-sim.gg.yaml');
    assert.strictEqual(resolveHttpFileFromLine(configPath, '  prometheus: false', 5), undefined);
    assert.strictEqual(resolveHttpFileFromLine(configPath, 'stages:', 0), undefined);
    assert.strictEqual(resolveHttpFileFromLine(configPath, '', 0), undefined);
  });
});
