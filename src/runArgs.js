"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// Pure gg argv-building logic — kept free of vscode/child_process so it's
// directly unit-testable. See vscode-extension-plan.md "Ground truth" section
// for the exact flag shapes this mirrors.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProfileRunArgs = buildProfileRunArgs;
exports.buildConfigRunArgs = buildConfigRunArgs;
/**
 * Builds the argv for a profile-driven run against a `.http` file:
 *
 *   gg --profile <name> --http-file <path> [--peak-rps <n>] [--duration <d>]
 *      [--snap [--snap-tag <tag>]] --headless --reporter json [--heartbeat-interval <n>s]
 */
function buildProfileRunArgs(opts) {
    const args = ['--profile', opts.profileName, '--http-file', opts.httpFilePath];
    if (opts.peakRps !== undefined) {
        args.push('--peak-rps', String(opts.peakRps));
    }
    if (opts.duration) {
        args.push('--duration', opts.duration);
    }
    appendSnapAndReportingArgs(args, opts.snap, opts.heartbeatIntervalSeconds);
    return args;
}
/**
 * Builds the argv for a config-driven run, where the `.gg.yaml` is the single
 * source of truth (no profile/RPS/duration overrides):
 *
 *   gg <config.gg.yaml> [--snap [--snap-tag <tag>]] --headless --reporter json [--heartbeat-interval <n>s]
 */
function buildConfigRunArgs(opts) {
    const args = [opts.configPath];
    appendSnapAndReportingArgs(args, opts.snap, opts.heartbeatIntervalSeconds);
    return args;
}
function appendSnapAndReportingArgs(args, snap, heartbeatIntervalSeconds) {
    if (snap?.enabled) {
        args.push('--snap');
        if (snap.tag) {
            args.push('--snap-tag', snap.tag);
        }
    }
    // Every editor-initiated run is headless+JSON — the interactive TUI caused
    // IDE CPU/crash regressions when tried, so this is the only execution path.
    args.push('--headless', '--reporter', 'json');
    if (heartbeatIntervalSeconds && heartbeatIntervalSeconds > 0) {
        args.push('--heartbeat-interval', `${heartbeatIntervalSeconds}s`);
    }
}
//# sourceMappingURL=runArgs.js.map