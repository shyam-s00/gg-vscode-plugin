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
const runArgs_1 = require("../runArgs");
suite('runArgs', () => {
    suite('buildProfileRunArgs', () => {
        test('builds the minimal argv with no overrides, no snap, no heartbeat', () => {
            const args = (0, runArgs_1.buildProfileRunArgs)({ profileName: 'flash-sale', httpFilePath: '/a/b.http' });
            assert.deepStrictEqual(args, [
                '--profile', 'flash-sale',
                '--http-file', '/a/b.http',
                '--headless', '--reporter', 'json',
            ]);
        });
        test('adds --peak-rps and --duration overrides when provided', () => {
            const args = (0, runArgs_1.buildProfileRunArgs)({
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
            const args = (0, runArgs_1.buildProfileRunArgs)({
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
            const args = (0, runArgs_1.buildProfileRunArgs)({
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
            const args = (0, runArgs_1.buildProfileRunArgs)({
                profileName: 'soak',
                httpFilePath: 'api.http',
                snap: { enabled: false, tag: 'ignored' },
            });
            assert.ok(!args.includes('--snap'));
            assert.ok(!args.includes('--snap-tag'));
        });
        test('adds --heartbeat-interval only when > 0', () => {
            const withInterval = (0, runArgs_1.buildProfileRunArgs)({
                profileName: 'smoke',
                httpFilePath: 'api.http',
                heartbeatIntervalSeconds: 2,
            });
            assert.deepStrictEqual(withInterval.slice(-2), ['--heartbeat-interval', '2s']);
            const withoutInterval = (0, runArgs_1.buildProfileRunArgs)({
                profileName: 'smoke',
                httpFilePath: 'api.http',
                heartbeatIntervalSeconds: 0,
            });
            assert.ok(!withoutInterval.includes('--heartbeat-interval'));
        });
    });
    suite('buildConfigRunArgs', () => {
        test('builds the minimal argv with just the config path', () => {
            const args = (0, runArgs_1.buildConfigRunArgs)({ configPath: 'traffic-sim.gg.yaml' });
            assert.deepStrictEqual(args, ['traffic-sim.gg.yaml', '--headless', '--reporter', 'json']);
        });
        test('adds snap and heartbeat flags when provided', () => {
            const args = (0, runArgs_1.buildConfigRunArgs)({
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
//# sourceMappingURL=runArgs.test.js.map