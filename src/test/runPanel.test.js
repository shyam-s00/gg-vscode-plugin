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
const runPanel_1 = require("../runPanel");
suite('runPanel state transitions', () => {
    test('createEmptyState starts idle with no stages/points', () => {
        const state = (0, runPanel_1.createEmptyState)();
        assert.strictEqual(state.status, 'idle');
        assert.deepStrictEqual(state.stages, []);
        assert.deepStrictEqual(state.points, []);
    });
    suite('applyHeartbeat — started', () => {
        test('resets state, sets running, profile, stages, and computed totalDurationSec', () => {
            const payload = {
                time: 't',
                event: 'started',
                profile: 'flash-sale',
                message: 'Load test started',
                total_stages: 2,
                stages: [
                    { name: 'Ramp-up', duration_seconds: 10, target_rps: 50 },
                    { name: 'Sustain', duration_seconds: 20, target_rps: 100 },
                ],
            };
            const next = (0, runPanel_1.applyHeartbeat)((0, runPanel_1.createEmptyState)(), payload, 1_000);
            assert.strictEqual(next.status, 'running');
            assert.strictEqual(next.profile, 'flash-sale');
            assert.strictEqual(next.message, 'Load test started');
            assert.strictEqual(next.totalStages, 2);
            assert.strictEqual(next.totalDurationSec, 30);
            assert.strictEqual(next.startedAtMs, 1_000);
            assert.deepStrictEqual(next.points, []);
        });
        test('leaves totalDurationSec undefined when no stages are present (pre-1.1.0 binaries)', () => {
            const next = (0, runPanel_1.applyHeartbeat)((0, runPanel_1.createEmptyState)(), { time: 't', event: 'started' }, 1_000);
            assert.strictEqual(next.totalDurationSec, undefined);
            assert.deepStrictEqual(next.stages, []);
        });
        test('discards any prior run state — a new started event always starts fresh', () => {
            const dirty = {
                status: 'finished',
                stages: [],
                points: [{ elapsedSec: 5, actualRps: 1, targetRps: 1 }],
                totalRequests: 999,
            };
            const next = (0, runPanel_1.applyHeartbeat)(dirty, { time: 't', event: 'started', profile: 'smoke' }, 2_000);
            assert.strictEqual(next.status, 'running');
            assert.strictEqual(next.totalRequests, undefined);
            assert.deepStrictEqual(next.points, []);
        });
    });
    suite('applyHeartbeat — heartbeat', () => {
        test('appends a chart point using elapsed time since startedAtMs and updates metrics', () => {
            const started = (0, runPanel_1.applyHeartbeat)((0, runPanel_1.createEmptyState)(), { time: 't0', event: 'started' }, 1_000);
            const next = (0, runPanel_1.applyHeartbeat)(started, {
                time: 't1',
                event: 'heartbeat',
                stage: 0,
                target_rps: 100,
                actual_rps: 87.5,
                total_requests: 500,
                success_count: 495,
                failure_count: 5,
                error_rate: 0.01,
                p50_ms: 10,
                p95_ms: 40,
                p99_ms: 90,
            }, 4_000);
            assert.strictEqual(next.currentStage, 0);
            assert.strictEqual(next.targetRps, 100);
            assert.strictEqual(next.actualRps, 87.5);
            assert.strictEqual(next.totalRequests, 500);
            assert.strictEqual(next.errorRate, 0.01);
            assert.strictEqual(next.p50, 10);
            assert.strictEqual(next.p95, 40);
            assert.strictEqual(next.p99, 90);
            assert.strictEqual(next.points.length, 1);
            assert.strictEqual(next.points[0].elapsedSec, 3); // (4000 - 1000) / 1000
            assert.strictEqual(next.points[0].actualRps, 87.5);
            assert.strictEqual(next.points[0].targetRps, 100);
        });
        test('accumulates multiple points across successive heartbeats', () => {
            let state = (0, runPanel_1.applyHeartbeat)((0, runPanel_1.createEmptyState)(), { time: 't0', event: 'started' }, 0);
            state = (0, runPanel_1.applyHeartbeat)(state, { time: 't1', event: 'heartbeat', actual_rps: 10, target_rps: 10 }, 1_000);
            state = (0, runPanel_1.applyHeartbeat)(state, { time: 't2', event: 'heartbeat', actual_rps: 20, target_rps: 20 }, 2_000);
            assert.strictEqual(state.points.length, 2);
            assert.strictEqual(state.points[0].elapsedSec, 1);
            assert.strictEqual(state.points[1].elapsedSec, 2);
        });
        test('defaults actualRps/targetRps to 0 in the chart point when absent from the payload', () => {
            const started = (0, runPanel_1.applyHeartbeat)((0, runPanel_1.createEmptyState)(), { time: 't0', event: 'started' }, 0);
            const next = (0, runPanel_1.applyHeartbeat)(started, { time: 't1', event: 'heartbeat' }, 1_000);
            assert.deepStrictEqual(next.points[0], { elapsedSec: 1, actualRps: 0, targetRps: 0 });
        });
    });
    suite('applyHeartbeat — terminal events', () => {
        test('finished sets status and message without touching accumulated points', () => {
            let state = (0, runPanel_1.applyHeartbeat)((0, runPanel_1.createEmptyState)(), { time: 't0', event: 'started' }, 0);
            state = (0, runPanel_1.applyHeartbeat)(state, { time: 't1', event: 'heartbeat', actual_rps: 1, target_rps: 1 }, 1_000);
            const next = (0, runPanel_1.applyHeartbeat)(state, { time: 't2', event: 'finished', message: 'Load test completed' }, 2_000);
            assert.strictEqual(next.status, 'finished');
            assert.strictEqual(next.message, 'Load test completed');
            assert.strictEqual(next.points.length, 1);
        });
        test('interrupted and error events set the corresponding status', () => {
            const base = (0, runPanel_1.applyHeartbeat)((0, runPanel_1.createEmptyState)(), { time: 't0', event: 'started' }, 0);
            assert.strictEqual((0, runPanel_1.applyHeartbeat)(base, { time: 't', event: 'interrupted', message: 'stopped' }).status, 'interrupted');
            assert.strictEqual((0, runPanel_1.applyHeartbeat)(base, { time: 't', event: 'error', message: 'boom' }).status, 'error');
        });
        test('snap sets snapMessage without changing status', () => {
            const running = (0, runPanel_1.applyHeartbeat)((0, runPanel_1.createEmptyState)(), { time: 't0', event: 'started' }, 0);
            const next = (0, runPanel_1.applyHeartbeat)(running, { time: 't1', event: 'snap', message: 'Snapshot saved' });
            assert.strictEqual(next.status, 'running');
            assert.strictEqual(next.snapMessage, 'Snapshot saved');
        });
    });
    suite('applyExit', () => {
        function runningState() {
            return (0, runPanel_1.applyHeartbeat)((0, runPanel_1.createEmptyState)(), { time: 't0', event: 'started' }, 0);
        }
        test('marks a still-running state finished on a clean exit', () => {
            const info = { code: 0, signal: null, stderrTail: [] };
            const next = (0, runPanel_1.applyExit)(runningState(), info);
            assert.strictEqual(next.status, 'finished');
            assert.strictEqual(next.stderrTail, undefined);
        });
        test('marks a still-running state errored on a non-zero exit, with a code-based message', () => {
            const info = { code: 1, signal: null, stderrTail: ['boom'] };
            const next = (0, runPanel_1.applyExit)(runningState(), info);
            assert.strictEqual(next.status, 'error');
            assert.strictEqual(next.message, 'gg exited with code 1');
            assert.deepStrictEqual(next.stderrTail, ['boom']);
        });
        test('uses a signal-based message when the process was killed by a signal', () => {
            const info = { code: null, signal: 'SIGTERM', stderrTail: [] };
            const next = (0, runPanel_1.applyExit)(runningState(), info);
            assert.strictEqual(next.status, 'error');
            assert.strictEqual(next.message, 'gg exited via signal SIGTERM');
        });
        test('does not override an already-terminal status from a heartbeat', () => {
            let state = runningState();
            state = (0, runPanel_1.applyHeartbeat)(state, { time: 't', event: 'finished', message: 'done' });
            const next = (0, runPanel_1.applyExit)(state, { code: 0, signal: null, stderrTail: [] });
            assert.strictEqual(next.status, 'finished');
            assert.strictEqual(next.message, 'done');
        });
        test('still attaches stderrTail on non-zero exit even when status was already terminal', () => {
            let state = runningState();
            state = (0, runPanel_1.applyHeartbeat)(state, { time: 't', event: 'error', message: 'gg-reported error' });
            const next = (0, runPanel_1.applyExit)(state, { code: 1, signal: null, stderrTail: ['panic: x'] });
            assert.strictEqual(next.status, 'error');
            assert.strictEqual(next.message, 'gg-reported error');
            assert.deepStrictEqual(next.stderrTail, ['panic: x']);
        });
        test('leaves an idle state alone on a clean exit (e.g. spawn never produced a started event)', () => {
            const next = (0, runPanel_1.applyExit)((0, runPanel_1.createEmptyState)(), { code: 0, signal: null, stderrTail: [] });
            assert.strictEqual(next.status, 'idle');
        });
    });
    suite('applySpawnError', () => {
        test('sets status to error with a descriptive message', () => {
            const next = (0, runPanel_1.applySpawnError)((0, runPanel_1.createEmptyState)(), new Error('ENOENT'));
            assert.strictEqual(next.status, 'error');
            assert.strictEqual(next.message, 'Failed to start gg: ENOENT');
        });
    });
    suite('renderHtml', () => {
        // The webview's own JS/canvas logic can't run outside a real webview, but
        // this at least catches template typos (unresolved `${...}`, mismatched
        // nonce, broken embedded JSON) that would otherwise only surface as a
        // silently blank panel at runtime.
        const fakeWebview = { cspSource: 'vscode-webview://fake' };
        test('produces a complete HTML document with no unresolved template placeholders', () => {
            const html = (0, runPanel_1.renderHtml)(fakeWebview, (0, runPanel_1.createEmptyState)());
            assert.ok(html.startsWith('<!DOCTYPE html>'));
            assert.ok(html.includes('</html>'));
            assert.ok(!html.includes('${'), 'found an unresolved template placeholder');
        });
        test('uses the same nonce in the CSP meta tag and the script tag', () => {
            const html = (0, runPanel_1.renderHtml)(fakeWebview, (0, runPanel_1.createEmptyState)());
            const cspNonceMatch = /script-src 'nonce-([^']+)'/.exec(html);
            const scriptNonceMatch = /<script nonce="([^"]+)">/.exec(html);
            assert.ok(cspNonceMatch && scriptNonceMatch);
            assert.strictEqual(cspNonceMatch[1], scriptNonceMatch[1]);
        });
        test('embeds the initial state as valid, matching JSON', () => {
            const state = {
                ...(0, runPanel_1.createEmptyState)(),
                status: 'running',
                profile: 'flash-sale',
                points: [{ elapsedSec: 1, actualRps: 10, targetRps: 20 }],
            };
            const html = (0, runPanel_1.renderHtml)(fakeWebview, state);
            const match = /let state = (\{.*?\});/.exec(html);
            assert.ok(match, 'could not find embedded initial state');
            const embedded = JSON.parse(match[1]);
            assert.deepStrictEqual(embedded, state);
        });
        test('references every statically-named DOM element id it queries by getElementById', () => {
            const html = (0, runPanel_1.renderHtml)(fakeWebview, (0, runPanel_1.createEmptyState)());
            const args = [...html.matchAll(/getElementById\(([^)]+)\)/g)].map((m) => m[1].trim());
            const staticIds = args.filter((arg) => /^'[^']+'$/.test(arg)).map((arg) => arg.slice(1, -1));
            assert.ok(staticIds.length > 0, 'expected at least one statically-named getElementById call');
            for (const id of staticIds) {
                assert.ok(html.includes(`id="${id}"`), `no element with id="${id}" found in the HTML`);
            }
        });
    });
});
//# sourceMappingURL=runPanel.test.js.map