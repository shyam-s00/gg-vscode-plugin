"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GgRunner = void 0;
exports.consumeHeartbeatLines = consumeHeartbeatLines;
const child_process_1 = require("child_process");
// ─────────────────────────────────────────────────────────────────────────────
// Internal: minimal typed pub/sub (deliberately not Node's EventEmitter —
// gg's own heartbeat `event` field can be the literal string "error", and
// EventEmitter treats an 'error' event with no listeners as fatal).
// ─────────────────────────────────────────────────────────────────────────────
class SimpleEmitter {
    listeners = new Set();
    on(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    emit(value) {
        for (const listener of this.listeners) {
            listener(value);
        }
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Stdout line buffering — pure, exported for direct unit testing.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Splits accumulated stdout text into complete lines, parsing each as a
 * heartbeat JSON payload. Non-JSON lines (stray text, partial writes) and
 * JSON lines without a string `event` field are silently skipped. The final
 * element of `buffer` after the last `\n` is returned as `remainder` so
 * callers can prepend it to the next chunk — gg's writes don't align with
 * any particular chunk boundary.
 */
function consumeHeartbeatLines(buffer) {
    const lines = buffer.split('\n');
    const remainder = lines.pop() ?? '';
    const payloads = [];
    for (const line of lines) {
        const payload = parseHeartbeatLine(line);
        if (payload) {
            payloads.push(payload);
        }
    }
    return { payloads, remainder };
}
function parseHeartbeatLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
        return undefined;
    }
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.event !== 'string') {
        return undefined;
    }
    return parsed;
}
// ─────────────────────────────────────────────────────────────────────────────
// GgRunner
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Runs `gg` headlessly (never via a terminal/TUI — the interactive TUI approach
 * was tried and caused IDE CPU/crash regressions) and streams parsed heartbeat
 * events to subscribers.
 *
 * Enforces a single active run: calling `start()` while a process is already
 * running kills it first, mirroring the JetBrains plugin's one-`activeHandler`
 * model. No vscode dependency, so it's directly unit-testable by spawning a
 * throwaway `node -e <script>` process in place of `gg`.
 */
class GgRunner {
    static STDERR_TAIL_LIMIT = 20;
    static GRACEFUL_STOP_TIMEOUT_MS = 3000;
    _heartbeat = new SimpleEmitter();
    _exit = new SimpleEmitter();
    _spawnError = new SimpleEmitter();
    _proc;
    _killTimer;
    get isRunning() {
        return this._proc !== undefined;
    }
    onHeartbeat(listener) {
        return this._heartbeat.on(listener);
    }
    onExit(listener) {
        return this._exit.on(listener);
    }
    onSpawnError(listener) {
        return this._spawnError.on(listener);
    }
    /** Starts a new headless run, killing any currently-active one first. */
    start(binaryPath, args) {
        this.stop();
        const proc = (0, child_process_1.spawn)(binaryPath, args);
        this._proc = proc;
        // Buffers are per-process closures (not `this` fields) so a stale,
        // superseded process can never pollute the state of the run that
        // replaced it.
        let stdoutBuffer = '';
        const stderrLines = [];
        proc.stdout?.on('data', (chunk) => {
            stdoutBuffer += chunk.toString('utf-8');
            const { payloads, remainder } = consumeHeartbeatLines(stdoutBuffer);
            stdoutBuffer = remainder;
            payloads.forEach((p) => this._heartbeat.emit(p));
        });
        proc.stderr?.on('data', (chunk) => {
            const lines = chunk.toString('utf-8').split('\n').filter((l) => l.length > 0);
            stderrLines.push(...lines);
            if (stderrLines.length > GgRunner.STDERR_TAIL_LIMIT) {
                stderrLines.splice(0, stderrLines.length - GgRunner.STDERR_TAIL_LIMIT);
            }
        });
        proc.on('error', (err) => {
            if (this._proc === proc) {
                this._proc = undefined;
            }
            this._clearKillTimer();
            this._spawnError.emit(err);
        });
        proc.on('close', (code, signal) => {
            if (stdoutBuffer.trim()) {
                const { payloads } = consumeHeartbeatLines(`${stdoutBuffer}\n`);
                payloads.forEach((p) => this._heartbeat.emit(p));
            }
            if (this._proc === proc) {
                this._proc = undefined;
            }
            this._clearKillTimer();
            this._exit.emit({ code, signal, stderrTail: stderrLines });
        });
    }
    /**
     * Gracefully stops the active process (SIGINT), escalating to SIGTERM if it
     * hasn't exited within {@link GgRunner.GRACEFUL_STOP_TIMEOUT_MS}. Safe to
     * call when nothing is running.
     *
     * Note: Windows has no real POSIX signal delivery, so both signals
     * terminate the process immediately there rather than allowing graceful
     * shutdown — that's a platform limitation, not something this class works
     * around.
     */
    stop() {
        if (!this._proc) {
            return;
        }
        this._proc.kill('SIGINT');
        this._clearKillTimer();
        this._killTimer = setTimeout(() => {
            this._proc?.kill('SIGTERM');
        }, GgRunner.GRACEFUL_STOP_TIMEOUT_MS);
    }
    /** Duck-typed `vscode.Disposable` (this module deliberately has no vscode dependency). */
    dispose() {
        this.stop();
    }
    _clearKillTimer() {
        if (this._killTimer) {
            clearTimeout(this._killTimer);
            this._killTimer = undefined;
        }
    }
}
exports.GgRunner = GgRunner;
//# sourceMappingURL=runner.js.map