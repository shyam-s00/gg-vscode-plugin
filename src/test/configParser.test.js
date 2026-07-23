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
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const configParser_1 = require("../configParser");
suite('configParser', () => {
    test('parses a full .gg.yaml document', () => {
        const parsed = (0, configParser_1.parseGgConfig)(`
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
        const parsed = (0, configParser_1.parseGgConfig)('config:\n  httpFile: "api.http"\n');
        assert.ok(parsed);
        assert.strictEqual(parsed?.config.httpFile, 'api.http');
        assert.deepStrictEqual(parsed?.stages, []);
        assert.strictEqual(parsed?.snap, undefined);
    });
    test('returns undefined for invalid YAML', () => {
        assert.strictEqual((0, configParser_1.parseGgConfig)('config: [unterminated'), undefined);
    });
    test('returns undefined when config.httpFile is missing', () => {
        assert.strictEqual((0, configParser_1.parseGgConfig)('config:\n  prometheus: true\n'), undefined);
        assert.strictEqual((0, configParser_1.parseGgConfig)('stages: []\n'), undefined);
        assert.strictEqual((0, configParser_1.parseGgConfig)(''), undefined);
    });
    test('isGgConfigFile matches the *.gg.yaml convention only', () => {
        assert.strictEqual((0, configParser_1.isGgConfigFile)('traffic-sim.gg.yaml'), true);
        assert.strictEqual((0, configParser_1.isGgConfigFile)('config.yaml'), false);
        assert.strictEqual((0, configParser_1.isGgConfigFile)('gg.yaml'), false);
        assert.strictEqual((0, configParser_1.isGgConfigFile)('request.http'), false);
    });
    test('resolveHttpFile resolves relative to the config file directory', () => {
        const parsed = (0, configParser_1.parseGgConfig)('config:\n  httpFile: "../requests/api.http"\n');
        assert.ok(parsed);
        const resolved = (0, configParser_1.resolveHttpFile)('/workspace/configs/traffic-sim.gg.yaml', parsed);
        assert.strictEqual(resolved, path.resolve('/workspace/requests/api.http'));
    });
    suite('findSiblingConfig', () => {
        let dir;
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
            const found = await (0, configParser_1.findSiblingConfig)(httpFile);
            assert.strictEqual(found, path.join(dir, 'traffic-sim.gg.yaml'));
        });
        test('returns undefined when no sibling config exists', async () => {
            const httpFile = path.join(dir, 'api.http');
            fs.writeFileSync(httpFile, 'GET https://example.com/\n');
            const found = await (0, configParser_1.findSiblingConfig)(httpFile);
            assert.strictEqual(found, undefined);
        });
        test('picks the alphabetically-first match when multiple exist', async () => {
            const httpFile = path.join(dir, 'api.http');
            fs.writeFileSync(httpFile, 'GET https://example.com/\n');
            fs.writeFileSync(path.join(dir, 'zzz.gg.yaml'), 'config:\n  httpFile: "api.http"\n');
            fs.writeFileSync(path.join(dir, 'aaa.gg.yaml'), 'config:\n  httpFile: "api.http"\n');
            const found = await (0, configParser_1.findSiblingConfig)(httpFile);
            assert.strictEqual(found, path.join(dir, 'aaa.gg.yaml'));
        });
    });
});
//# sourceMappingURL=configParser.test.js.map