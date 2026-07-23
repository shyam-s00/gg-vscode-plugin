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
const definitionProvider_1 = require("../definitionProvider");
suite('resolveHttpFileFromLine', () => {
    let dir;
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
        const result = (0, definitionProvider_1.resolveHttpFileFromLine)(configPath, line, 14);
        assert.strictEqual(result, path.join(dir, 'request.http'));
    });
    test('resolves an unquoted httpFile value', () => {
        const configPath = path.join(dir, 'traffic-sim.gg.yaml');
        const line = '  httpFile: request.http';
        const result = (0, definitionProvider_1.resolveHttpFileFromLine)(configPath, line, 14);
        assert.strictEqual(result, path.join(dir, 'request.http'));
    });
    test('returns undefined when cursor is on the key, not the value', () => {
        const configPath = path.join(dir, 'traffic-sim.gg.yaml');
        const line = '  httpFile: "request.http"';
        const result = (0, definitionProvider_1.resolveHttpFileFromLine)(configPath, line, 4);
        assert.strictEqual(result, undefined);
    });
    test('returns undefined when the referenced file does not exist on disk', () => {
        const configPath = path.join(dir, 'traffic-sim.gg.yaml');
        const line = '  httpFile: "missing.http"';
        const result = (0, definitionProvider_1.resolveHttpFileFromLine)(configPath, line, 14);
        assert.strictEqual(result, undefined);
    });
    test('returns undefined for unrelated YAML lines', () => {
        const configPath = path.join(dir, 'traffic-sim.gg.yaml');
        assert.strictEqual((0, definitionProvider_1.resolveHttpFileFromLine)(configPath, '  prometheus: false', 5), undefined);
        assert.strictEqual((0, definitionProvider_1.resolveHttpFileFromLine)(configPath, 'stages:', 0), undefined);
        assert.strictEqual((0, definitionProvider_1.resolveHttpFileFromLine)(configPath, '', 0), undefined);
    });
});
//# sourceMappingURL=definitionProvider.test.js.map