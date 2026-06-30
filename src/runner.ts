import { ChildProcess, spawn } from 'child_process';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** A `gg --headless --reporter json` NDJSON heartbeat line. All fields besides `time`/`event` are optional. */
export interface HeartbeatPayload {
  time: string;
  event: 'started' | 'heartbeat' | 'finished' | 'interrupted' | 'snap' | 'error';
  stage?: number;
  total_stages?: number;
  stages?: HeartbeatStageInfo[];
  profile?: string;
  profile_scale?: number;
  target_rps?: number;
  actual_rps?: number;
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  error_rate?: number;
  p50_ms?: number;
  p95_ms?: number;
  p99_ms?: number;
  message?: string;
}

export interface HeartbeatStageInfo {
  name?: string;
  duration_seconds?: number;
  target_rps?: number;
}

export interface RunExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Last ~20 lines of stderr — useful for surfacing a crash reason alongside a non-zero exit. */
  stderrTail: string[];
}

export type Unsubscribe = () => void;

// ─────────────────────────────────────────────────────────────────────────────
// Internal: minimal typed pub/sub (deliberately not Node's EventEmitter —
// gg's own heartbeat `event` field can be the literal string "error", and
// EventEmitter treats an 'error' event with no listeners as fatal).
// ─────────────────────────────────────────────────────────────────────────────

class SimpleEmitter<T> {
  private readonly listeners = new Set<(value: T) => void>();

  on(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
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
export function consumeHeartbeatLines(buffer: string): { payloads: HeartbeatPayload[]; remainder: string } {
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';

  const payloads: HeartbeatPayload[] = [];
  for (const line of lines) {
    const payload = parseHeartbeatLine(line);
    if (payload) {
      payloads.push(payload);
    }
  }
  return { payloads, remainder };
}

function parseHeartbeatLine(line: string): HeartbeatPayload | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== 'object' || typeof (parsed as Record<string, unknown>).event !== 'string') {
    return undefined;
  }
  return parsed as HeartbeatPayload;
}

// ─────────────────────────────────────────────────────────────────────────────
// GgRunner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs `gg` headlessly (never via a terminal/TUI — see vscode-extension-plan.md
 * Phase 2 for why) and streams parsed heartbeat events to subscribers.
 *
 * Enforces a single active run: calling `start()` while a process is already
 * running kills it first, mirroring the JetBrains plugin's one-`activeHandler`
 * model. No vscode dependency, so it's directly unit-testable by spawning a
 * throwaway `node -e <script>` process in place of `gg`.
 */
export class GgRunner {
  private static readonly STDERR_TAIL_LIMIT = 20;
  private static readonly GRACEFUL_STOP_TIMEOUT_MS = 3000;

  private readonly _heartbeat = new SimpleEmitter<HeartbeatPayload>();
  private readonly _exit = new SimpleEmitter<RunExitInfo>();
  private readonly _spawnError = new SimpleEmitter<Error>();

  private _proc: ChildProcess | undefined;
  private _killTimer: NodeJS.Timeout | undefined;

  get isRunning(): boolean {
    return this._proc !== undefined;
  }

  onHeartbeat(listener: (payload: HeartbeatPayload) => void): Unsubscribe {
    return this._heartbeat.on(listener);
  }

  onExit(listener: (info: RunExitInfo) => void): Unsubscribe {
    return this._exit.on(listener);
  }

  onSpawnError(listener: (err: Error) => void): Unsubscribe {
    return this._spawnError.on(listener);
  }

  /** Starts a new headless run, killing any currently-active one first. */
  start(binaryPath: string, args: string[]): void {
    this.stop();

    const proc = spawn(binaryPath, args);
    this._proc = proc;

    // Buffers are per-process closures (not `this` fields) so a stale,
    // superseded process can never pollute the state of the run that
    // replaced it.
    let stdoutBuffer = '';
    const stderrLines: string[] = [];

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf-8');
      const { payloads, remainder } = consumeHeartbeatLines(stdoutBuffer);
      stdoutBuffer = remainder;
      payloads.forEach((p) => this._heartbeat.emit(p));
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString('utf-8').split('\n').filter((l) => l.length > 0);
      stderrLines.push(...lines);
      if (stderrLines.length > GgRunner.STDERR_TAIL_LIMIT) {
        stderrLines.splice(0, stderrLines.length - GgRunner.STDERR_TAIL_LIMIT);
      }
    });

    proc.on('error', (err: Error) => {
      if (this._proc === proc) {
        this._proc = undefined;
      }
      this._clearKillTimer();
      this._spawnError.emit(err);
    });

    proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
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
  stop(): void {
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
  dispose(): void {
    this.stop();
  }

  private _clearKillTimer(): void {
    if (this._killTimer) {
      clearTimeout(this._killTimer);
      this._killTimer = undefined;
    }
  }
}
