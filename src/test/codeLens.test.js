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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const codeLens_1 = require("../codeLens");
const NOOP_TOKEN = new vscode.CancellationTokenSource().token;
async function openTempFile(dir, name, content) {
    const filePath = path.join(dir, name);
    fs.writeFileSync(filePath, content);
    return vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
}
suite('findFirstTopLevelKeyLine', () => {
    test('finds the first non-indented, non-comment key line', () => {
        const text = '# a comment\n  indented: not this\nconfig:\n  httpFile: "a.http"\n';
        assert.strictEqual((0, codeLens_1.findFirstTopLevelKeyLine)(text), 2);
    });
    test('returns 0 for an empty document', () => {
        assert.strictEqual((0, codeLens_1.findFirstTopLevelKeyLine)(''), 0);
    });
    test('returns 0 when nothing looks like a top-level key', () => {
        assert.strictEqual((0, codeLens_1.findFirstTopLevelKeyLine)('# just comments\n  # more comments\n'), 0);
    });
});
suite('GgHttpCodeLensProvider', () => {
    let dir;
    let provider;
    setup(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-codelens-http-'));
        provider = new codeLens_1.GgHttpCodeLensProvider();
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
        // 2 requests × 2 lenses each (▶ Run GG + ⚙ Generate Config, no sibling) = 4
        assert.strictEqual(lenses.length, 4);
        assert.strictEqual(lenses[0].command?.title, '▶ Run GG');
        assert.strictEqual(lenses[0].command?.command, 'gg.run');
        assert.deepStrictEqual(lenses[0].command?.arguments, [doc.uri]);
        assert.strictEqual(lenses[0].range.start.line, 1);
        assert.strictEqual(lenses[1].command?.command, 'gg.generateConfig');
        assert.strictEqual(lenses[2].range.start.line, 4);
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
    test('shows "Generate Config" instead of "Run (Config)" when no sibling .gg.yaml exists', async () => {
        const doc = await openTempFile(dir, 'api.http', 'GET https://example.com/\n');
        const lenses = await provider.provideCodeLenses(doc, NOOP_TOKEN);
        // 1 request × 2 lenses: ▶ Run GG + ⚙ Generate Config
        assert.strictEqual(lenses.length, 2);
        assert.strictEqual(lenses[0].command?.command, 'gg.run');
        assert.strictEqual(lenses[1].command?.command, 'gg.generateConfig');
        assert.strictEqual(lenses[1].command?.title, '⚙ Generate Config');
    });
});
suite('GgYamlCodeLensProvider', () => {
    let dir;
    let provider;
    setup(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gg-codelens-yaml-'));
        provider = new codeLens_1.GgYamlCodeLensProvider();
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
        const lenses = provider.provideCodeLenses(doc, NOOP_TOKEN);
        assert.strictEqual(lenses.length, 1);
        assert.strictEqual(lenses[0].command?.title, '▶ Run GG');
        assert.strictEqual(lenses[0].command?.command, 'gg.runConfig');
        assert.deepStrictEqual(lenses[0].command?.arguments, [doc.uri]);
        assert.strictEqual(lenses[0].range.start.line, 0);
    });
    test('still shows the lens (anchored at line 0) for an incomplete/invalid config', async () => {
        const doc = await openTempFile(dir, 'traffic-sim.gg.yaml', '# nothing useful yet\n');
        const lenses = provider.provideCodeLenses(doc, NOOP_TOKEN);
        assert.strictEqual(lenses.length, 1);
        assert.strictEqual(lenses[0].range.start.line, 0);
    });
});
//# sourceMappingURL=codeLens.test.js.map