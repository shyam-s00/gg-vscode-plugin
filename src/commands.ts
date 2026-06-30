import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ConfigManager } from './config';
import { findSiblingConfig, isGgConfigFile, parseGgConfig } from './configParser';
import type { Installer } from './installer';
import { BUILT_IN_PROFILES, byCategory, GgProfile, loadCustomProfiles } from './profileCatalog';
import { buildConfigRunArgs, buildProfileRunArgs, SnapOptions } from './runArgs';
import type { GgRunner, HeartbeatPayload, RunExitInfo } from './runner';

const LAST_PROFILE_KEY = 'gg.lastProfile';
const HTTP_EXTENSIONS = new Set(['.http', '.rest']);
const DURATION_RE = /^(\d+(h|m|s|ms))+$/;

// ─────────────────────────────────────────────────────────────────────────────
// RunCommands
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registers `gg.run` and `gg.runConfig` and drives the UX flow for each:
 * profile picking (with category grouping + last-used memory), peak RPS /
 * duration overrides, and the snap checkbox+tag prompt — then hands off to
 * `GgRunner` to actually run `gg` headlessly.
 *
 * Output is rendered into a plain Output Channel for now — Phase 2.5 replaces
 * this rendering with a native Webview dashboard subscribed to the same
 * `GgRunner` events; the run/UX flow here won't need to change.
 */
export class RunCommands implements vscode.Disposable {
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _output: vscode.OutputChannel;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly configMgr: ConfigManager,
    private readonly installer: Installer,
    private readonly runner: GgRunner,
  ) {
    this._output = vscode.window.createOutputChannel('Gopher-Glide');

    this._disposables.push(
      this._output,
      { dispose: this.runner.onHeartbeat((p) => this._renderHeartbeat(p)) },
      { dispose: this.runner.onExit((info) => this._renderExit(info)) },
      { dispose: this.runner.onSpawnError((err) => this._renderSpawnError(err)) },
      vscode.commands.registerCommand('gg.run', (uri?: vscode.Uri) => this._cmdRun(uri)),
      vscode.commands.registerCommand('gg.runConfig', (uri?: vscode.Uri) => this._cmdRunConfig(uri)),
    );
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
    this._disposables.length = 0;
  }

  // ── gg.run — profile-driven run for a .http file ──────────────────────────

  private async _cmdRun(uri?: vscode.Uri): Promise<void> {
    const httpFile = this._resolveHttpFileTarget(uri);
    if (!httpFile) {
      vscode.window.showErrorMessage('Gopher-Glide: Open or select a .http file to run.');
      return;
    }

    await this.installer.ensureInstalled();
    const binPath = this.configMgr.effectiveBinaryPath;

    const customProfiles = await loadCustomProfiles(binPath);
    const allProfiles: GgProfile[] = [...BUILT_IN_PROFILES, ...customProfiles];

    const lastProfile = this.context.workspaceState.get<string>(LAST_PROFILE_KEY);
    const defaultProfileName = lastProfile ?? (this.configMgr.config.defaultProfile || undefined);

    const profile = await pickProfile(allProfiles, defaultProfileName);
    if (!profile) {
      return;
    }

    const rpsResult = await promptPeakRpsOverride(profile);
    if (rpsResult.cancelled) {
      return;
    }

    const durationResult = await promptDurationOverride(profile);
    if (durationResult.cancelled) {
      return;
    }

    const snap = await promptSnapOptions();
    if (!snap) {
      return;
    }

    await this.context.workspaceState.update(LAST_PROFILE_KEY, profile.name);

    const args = buildProfileRunArgs({
      profileName: profile.name,
      httpFilePath: httpFile,
      peakRps: rpsResult.value,
      duration: durationResult.value,
      snap,
      heartbeatIntervalSeconds: this.configMgr.config.heartbeatIntervalSeconds,
    });

    this._runHeadless(binPath, args);
  }

  // ── gg.runConfig — config-driven run for a .gg.yaml (or .http w/ sibling) ──

  private async _cmdRunConfig(uri?: vscode.Uri): Promise<void> {
    const configPath = await this._resolveConfigTarget(uri);
    if (!configPath) {
      vscode.window.showErrorMessage(
        'Gopher-Glide: No valid .gg.yaml config found (directly, or as a sibling of this .http file).',
      );
      return;
    }

    await this.installer.ensureInstalled();
    const binPath = this.configMgr.effectiveBinaryPath;

    const snap = await promptSnapOptions();
    if (!snap) {
      return;
    }

    const args = buildConfigRunArgs({
      configPath,
      snap,
      heartbeatIntervalSeconds: this.configMgr.config.heartbeatIntervalSeconds,
    });

    this._runHeadless(binPath, args);
  }

  // ── Target resolution ──────────────────────────────────────────────────────

  private _resolveHttpFileTarget(uri?: vscode.Uri): string | undefined {
    const target = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!target) {
      return undefined;
    }
    return HTTP_EXTENSIONS.has(path.extname(target).toLowerCase()) ? target : undefined;
  }

  /** Resolves a `.gg.yaml` directly, or via a sibling lookup from a `.http` file — and validates it parses. */
  private async _resolveConfigTarget(uri?: vscode.Uri): Promise<string | undefined> {
    const target = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!target) {
      return undefined;
    }

    let configPath: string | undefined;
    if (isGgConfigFile(path.basename(target))) {
      configPath = target;
    } else if (HTTP_EXTENSIONS.has(path.extname(target).toLowerCase())) {
      configPath = await findSiblingConfig(target);
    }
    if (!configPath) {
      return undefined;
    }

    const text = await fs.promises.readFile(configPath, 'utf-8').catch(() => undefined);
    return text !== undefined && parseGgConfig(text) ? configPath : undefined;
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  private _runHeadless(binPath: string, args: string[]): void {
    this._output.clear();
    this._output.show(true);
    this._output.appendLine(`$ ${binPath} ${args.join(' ')}`);
    this.runner.start(binPath, args);
  }

  // ── Output Channel rendering of GgRunner events ────────────────────────────
  // Temporary presentation layer — Phase 2.5's Webview dashboard subscribes to
  // the same three GgRunner events and replaces this with charts/metric cards.

  private _renderHeartbeat(payload: HeartbeatPayload): void {
    const parts = [`[${payload.event}]`];
    if (payload.message) {
      parts.push(payload.message);
    }
    if (payload.profile) {
      parts.push(`profile=${payload.profile}`);
    }
    if (payload.actual_rps !== undefined) {
      parts.push(`actual=${payload.actual_rps}rps`);
    }
    if (payload.target_rps !== undefined) {
      parts.push(`target=${payload.target_rps}rps`);
    }
    if (payload.error_rate !== undefined) {
      parts.push(`errors=${(payload.error_rate * 100).toFixed(2)}%`);
    }
    this._output.appendLine(parts.join(' '));
  }

  private _renderExit(info: RunExitInfo): void {
    const signalSuffix = info.signal ? ` (signal ${info.signal})` : '';
    this._output.appendLine(`\n[Gopher-Glide] gg exited with code ${info.code}${signalSuffix}`);
    if (info.code !== 0 && info.stderrTail.length > 0) {
      this._output.appendLine('--- stderr tail ---');
      info.stderrTail.forEach((line) => this._output.appendLine(line));
    }
  }

  private _renderSpawnError(err: Error): void {
    this._output.appendLine(`\n[Gopher-Glide] Failed to start gg: ${err.message}`);
    vscode.window.showErrorMessage(`Gopher-Glide: Failed to start gg — ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UX flow helpers
// ─────────────────────────────────────────────────────────────────────────────

interface ProfilePickItem extends vscode.QuickPickItem {
  profile?: GgProfile;
}

/** Category-grouped QuickPick over `profiles`, pre-highlighting `defaultProfileName` if present. */
function pickProfile(profiles: GgProfile[], defaultProfileName: string | undefined): Promise<GgProfile | undefined> {
  const items: ProfilePickItem[] = [];
  for (const [category, list] of byCategory(profiles)) {
    items.push({ label: category, kind: vscode.QuickPickItemKind.Separator });
    for (const profile of list) {
      items.push({
        label: profile.name,
        description: `${profile.defaultPeakRps} rps · ${profile.defaultDuration}`,
        detail: profile.description,
        profile,
      });
    }
  }

  const qp = vscode.window.createQuickPick<ProfilePickItem>();
  qp.title = 'Gopher-Glide: Select a profile';
  qp.items = items;
  qp.ignoreFocusOut = true;
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;

  if (defaultProfileName) {
    const defaultItem = items.find((i) => i.profile?.name === defaultProfileName);
    if (defaultItem) {
      qp.activeItems = [defaultItem];
    }
  }

  return new Promise((resolve) => {
    qp.onDidAccept(() => {
      const selected = qp.selectedItems[0];
      qp.hide();
      resolve(selected?.profile);
    });
    qp.onDidHide(() => {
      qp.dispose();
      resolve(undefined);
    });
    qp.show();
  });
}

interface OverrideResult<T> {
  cancelled: boolean;
  value?: T;
}

async function promptPeakRpsOverride(profile: GgProfile): Promise<OverrideResult<number>> {
  const raw = await vscode.window.showInputBox({
    title: 'Gopher-Glide: Peak RPS override (optional)',
    prompt: `Leave empty to use ${profile.name}'s default (${profile.defaultPeakRps} rps)`,
    placeHolder: String(profile.defaultPeakRps),
    ignoreFocusOut: true,
    validateInput: (value) => (!value.trim() || /^\d+$/.test(value.trim())
      ? undefined
      : 'Enter a positive integer, or leave empty'),
  });
  if (raw === undefined) {
    return { cancelled: true };
  }
  const trimmed = raw.trim();
  return { cancelled: false, value: trimmed ? parseInt(trimmed, 10) : undefined };
}

async function promptDurationOverride(profile: GgProfile): Promise<OverrideResult<string>> {
  const raw = await vscode.window.showInputBox({
    title: 'Gopher-Glide: Duration override (optional)',
    prompt: `Leave empty to use ${profile.name}'s default (${profile.defaultDuration}). Examples: 30s, 2m, 1h30m`,
    placeHolder: profile.defaultDuration,
    ignoreFocusOut: true,
    validateInput: (value) => (!value.trim() || DURATION_RE.test(value.trim())
      ? undefined
      : 'Enter a Go-style duration (e.g. 30s, 2m, 1h30m), or leave empty'),
  });
  if (raw === undefined) {
    return { cancelled: true };
  }
  const trimmed = raw.trim();
  return { cancelled: false, value: trimmed || undefined };
}

/** Returns `undefined` if the user cancelled the flow at any point. */
async function promptSnapOptions(): Promise<SnapOptions | undefined> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: 'No', picked: true, description: 'Run without capturing a snapshot' },
      { label: 'Yes', description: 'Capture a snapshot after this run (--snap)' },
    ],
    { title: 'Gopher-Glide: Capture a snapshot after this run?', ignoreFocusOut: true },
  );
  if (!choice) {
    return undefined;
  }
  if (choice.label === 'No') {
    return { enabled: false };
  }

  const tag = await vscode.window.showInputBox({
    title: 'Gopher-Glide: Snapshot tag (optional)',
    prompt: "Leave empty to use gg's default tag",
    ignoreFocusOut: true,
  });
  if (tag === undefined) {
    return undefined;
  }
  return { enabled: true, tag: tag.trim() || undefined };
}
