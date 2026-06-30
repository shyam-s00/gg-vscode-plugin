// ─────────────────────────────────────────────────────────────────────────────
// Pure gg argv-building logic — kept free of vscode/child_process so it's
// directly unit-testable. See vscode-extension-plan.md "Ground truth" section
// for the exact flag shapes this mirrors.
// ─────────────────────────────────────────────────────────────────────────────

export interface SnapOptions {
  enabled: boolean;
  /** Omit to let gg use its own default tag. */
  tag?: string;
}

export interface ProfileRunOptions {
  profileName: string;
  httpFilePath: string;
  /** Overrides the profile's default peak RPS (`--peak-rps`). */
  peakRps?: number;
  /** Overrides the profile's default duration (`--duration`), e.g. "2m". */
  duration?: string;
  snap?: SnapOptions;
  /** Seconds; 0/undefined means "use gg's own default (5s)". */
  heartbeatIntervalSeconds?: number;
}

export interface ConfigRunOptions {
  configPath: string;
  snap?: SnapOptions;
  /** Seconds; 0/undefined means "use gg's own default (5s)". */
  heartbeatIntervalSeconds?: number;
}

/**
 * Builds the argv for a profile-driven run against a `.http` file:
 *
 *   gg --profile <name> --http-file <path> [--peak-rps <n>] [--duration <d>]
 *      [--snap [--snap-tag <tag>]] --headless --reporter json [--heartbeat-interval <n>s]
 */
export function buildProfileRunArgs(opts: ProfileRunOptions): string[] {
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
export function buildConfigRunArgs(opts: ConfigRunOptions): string[] {
  const args = [opts.configPath];
  appendSnapAndReportingArgs(args, opts.snap, opts.heartbeatIntervalSeconds);
  return args;
}

function appendSnapAndReportingArgs(
  args: string[],
  snap: SnapOptions | undefined,
  heartbeatIntervalSeconds: number | undefined,
): void {
  if (snap?.enabled) {
    args.push('--snap');
    if (snap.tag) {
      args.push('--snap-tag', snap.tag);
    }
  }

  // Every editor-initiated run is headless+JSON — the integrated-terminal/TUI
  // path was tried and removed upstream (see vscode-extension-plan.md Phase 2).
  args.push('--headless', '--reporter', 'json');

  if (heartbeatIntervalSeconds && heartbeatIntervalSeconds > 0) {
    args.push('--heartbeat-interval', `${heartbeatIntervalSeconds}s`);
  }
}
