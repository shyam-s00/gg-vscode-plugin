import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { findFirstTopLevelKeyLine, GgHttpCodeLensProvider, GgYamlCodeLensProvider } from '../codeLens';

const NOOP_TOKEN = new vscode.CancellationTokenSource().token;

async function openTempFile(dir: string, name: string, content: string): Promise<vscode.TextDocument> {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  return vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
}

suite('findFirstTopLevelKeyLine', () => {
  test('finds the first non-indented, non-comment key line', () => {
    const text = '# a comment\n  indented: not this\nconfig:\n  httpFile: "a.http"\n';
    assert.strictEqual(findFirstTopLevelKeyLine(text), 2);
  });

  test('returns 0 for an empty document', () => {
    assert.strictEqual(findFirstTopLevelKeyLine(''), 0);
  });

  test('returns 0 when nothing looks like a top-level key', () => {
    assert.strictEqual(findFirstTopLevelKeyLine('# just comments\n  # more comments\n'), 0);
  });
});

suite('GgHttpCodeLensProvider', () => {
  let dir: string;
  let provider: GgHttpCodeLensProvider;

  setup(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-codelens-http-'));
    provider = new GgHttpCodeLensProvider();
  });

  teardown(() => {
    provider.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('adds one "Run GG" lens per request, anchored at the request line', async () => {
    const doc = await openTempFile(dir, 'api.http', [
      '### First',
      'GET https://example.com/a',
      '',
      '### Second',
      'POST https://example.com/b',
    ].join('\n'));

    const lenses = await provider.provideCodeLenses(doc, NOOP_TOKEN);
    assert.strictEqual(lenses.length, 2);
    assert.strictEqual(lenses[0].command?.title, '▶ Run GG');
    assert.strictEqual(lenses[0].command?.command, 'gg.run');
    assert.deepStrictEqual(lenses[0].command?.arguments, [doc.uri]);
    assert.strictEqual(lenses[0].range.start.line, 1);
    assert.strictEqual(lenses[1].range.start.line, 4);
  });

  test('returns no lenses for a file with no parseable request', async () => {
    const doc = await openTempFile(dir, 'empty.http', '# just a comment\n');
    const lenses = await provider.provideCodeLenses(doc, NOOP_TOKEN);
    assert.strictEqual(lenses.length, 0);
  });

  test('adds a "Run GG (Config)" lens alongside "Run GG" when a sibling .gg.yaml exists', async () => {
    fs.writeFileSync(path.join(dir, 'traffic-sim.gg.yaml'), 'config:\n  httpFile: "api.http"\n');
    const doc = await openTempFile(dir, 'api.http', 'GET https://example.com/\n');

    const lenses = await provider.provideCodeLenses(doc, NOOP_TOKEN);
    assert.strictEqual(lenses.length, 2);
    assert.strictEqual(lenses[0].command?.command, 'gg.run');
    assert.strictEqual(lenses[1].command?.command, 'gg.runConfig');
    assert.strictEqual(lenses[1].command?.title, '▶ Run GG (Config)');
    assert.strictEqual(lenses[1].range.start.line, lenses[0].range.start.line);
  });

  test('does not add a config lens when no sibling .gg.yaml exists', async () => {
    const doc = await openTempFile(dir, 'api.http', 'GET https://example.com/\n');
    const lenses = await provider.provideCodeLenses(doc, NOOP_TOKEN);
    assert.strictEqual(lenses.length, 1);
    assert.strictEqual(lenses[0].command?.command, 'gg.run');
  });
});

suite('GgYamlCodeLensProvider', () => {
  let dir: string;
  let provider: GgYamlCodeLensProvider;

  setup(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-codelens-yaml-'));
    provider = new GgYamlCodeLensProvider();
  });

  teardown(() => {
    provider.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('adds a single "Run GG" lens at the first top-level key', async () => {
    const doc = await openTempFile(dir, 'traffic-sim.gg.yaml', [
      'config:',
      '  httpFile: "api.http"',
      'stages:',
      '  - duration: 10s',
      '    target_rps: 50',
    ].join('\n'));

    const lenses = provider.provideCodeLenses(doc, NOOP_TOKEN) as vscode.CodeLens[];
    assert.strictEqual(lenses.length, 1);
    assert.strictEqual(lenses[0].command?.title, '▶ Run GG');
    assert.strictEqual(lenses[0].command?.command, 'gg.runConfig');
    assert.deepStrictEqual(lenses[0].command?.arguments, [doc.uri]);
    assert.strictEqual(lenses[0].range.start.line, 0);
  });

  test('still shows the lens (anchored at line 0) for an incomplete/invalid config', async () => {
    const doc = await openTempFile(dir, 'traffic-sim.gg.yaml', '# nothing useful yet\n');
    const lenses = provider.provideCodeLenses(doc, NOOP_TOKEN) as vscode.CodeLens[];
    assert.strictEqual(lenses.length, 1);
    assert.strictEqual(lenses[0].range.start.line, 0);
  });
});
