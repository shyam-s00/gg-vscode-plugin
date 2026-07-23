"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSnapCommand = runSnapCommand;
const child_process_1 = require("child_process");
// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────
const SNAP_TIMEOUT_MS = 30_000;
/**
 * Runs `gg snap <args>` as a one-shot subprocess and returns the captured
 * stdout, stderr, and exit code.
 *
 * Never throws on non-zero exit — the exit code carries semantic meaning for
 * several subcommands (`assert` exits 1 on violations, `prune` reports errors
 * inline), so callers must always check `result.code` themselves.
 *
 * Always passes `--reporter json` if not already present in `args`, so callers
 * can safely `JSON.parse(result.stdout)` without knowing which subcommand
 * produced the output.
 */
function runSnapCommand(binaryPath, args) {
    const finalArgs = ['snap', ...args];
    if (!finalArgs.includes('--reporter')) {
        finalArgs.push('--reporter', 'json');
    }
    return new Promise((resolve) => {
        (0, child_process_1.execFile)(binaryPath, finalArgs, { timeout: SNAP_TIMEOUT_MS }, (err, stdout, stderr) => {
            resolve({
                stdout,
                stderr,
                // err.code can be a string (e.g. 'ENOENT') for spawn errors or a
                // number for process exit codes — normalise to a plain number.
                code: typeof err?.code === 'number' ? err.code : (err ? 1 : 0),
            });
        });
    });
}
//# sourceMappingURL=snapCliRunner.js.map