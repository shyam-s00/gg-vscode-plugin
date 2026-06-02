import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ConfigManager } from './config';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// Release asset format: gg-{tag}-{os}-{arch}.tar.gz  (Windows: .zip)
// Example: gg-v0.9.1-darwin-arm64.tar.gz
// ─────────────────────────────────────────────────────────────────────────────

const GITHUB_OWNER = 'shyam-s00';
const GITHUB_REPO  = 'gopher-glide';
const BINARY_NAME  = 'gg';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  prerelease: boolean;
  assets: GitHubAsset[];
}

interface GitHubAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

interface ResolvedPlatform {
  /** OS identifier used in release asset names. */
  os: 'darwin' | 'linux' | 'windows';
  arch: 'amd64' | 'arm64';
  /** Extension for the extracted binary (empty on Unix, '.exe' on Windows). */
  binExt: '' | '.exe';
  /** Extension for the release archive. */
  archiveExt: '.tar.gz' | '.zip';
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform helpers
// ─────────────────────────────────────────────────────────────────────────────

function detectPlatform(): ResolvedPlatform {
  const plat: ResolvedPlatform['os'] =
    process.platform === 'darwin' ? 'darwin' :
      process.platform === 'win32' ? 'windows' :
        'linux';

  const arch: ResolvedPlatform['arch'] =
    process.arch === 'arm64' ? 'arm64' : 'amd64';

  const isWindows = plat === 'windows';
  return {
    os: plat,
    arch,
    binExt:     isWindows ? '.exe'    : '',
    archiveExt: isWindows ? '.zip'    : '.tar.gz',
  };
}

/**
 * Builds the GitHub release asset filename.
 * Format: `gg-{tag}-{os}-{arch}{archiveExt}`
 * Example: `gg-v0.9.1-darwin-arm64.tar.gz`
 */
function assetName(p: ResolvedPlatform, tagName: string): string {
  return `${BINARY_NAME}-${tagName}-${p.os}-${p.arch}${p.archiveExt}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Network helpers
// ─────────────────────────────────────────────────────────────────────────────

/** GET `url`, following up to 5 redirects. Returns the response body as a string. */
function httpsGetText(url: string, redirectsLeft = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) {
      return reject(new Error('Too many redirects'));
    }
    https
      .get(url, { headers: { 'User-Agent': 'vscode-gopher-glide', Accept: 'application/vnd.github.v3+json' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(httpsGetText(res.headers.location, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/** Downloads a URL to `destPath`, reporting byte progress via `onProgress`. */
function downloadFile(
  url: string,
  destPath: string,
  onProgress: (downloaded: number, total: number) => void,
  redirectsLeft = 5,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) {
      return reject(new Error('Too many redirects'));
    }
    https
      .get(url, { headers: { 'User-Agent': 'vscode-gopher-glide' } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(downloadFile(res.headers.location, destPath, onProgress, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} during download`));
        }

        const total = parseInt(res.headers['content-length'] ?? '0', 10);
        let downloaded = 0;
        const tmpPath = `${destPath}.tmp`;
        const out = fs.createWriteStream(tmpPath);

        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          onProgress(downloaded, total);
        });
        res.pipe(out);

        out.on('finish', () =>
          out.close(() =>
            fs.rename(tmpPath, destPath, (err) => (err ? reject(err) : resolve())),
          ),
        );
        out.on('error', (err) => {
          fs.unlink(tmpPath, () => reject(err));
        });
      })
      .on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub API
// ─────────────────────────────────────────────────────────────────────────────

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
  const body = await httpsGetText(url);
  return JSON.parse(body) as GitHubRelease;
}

// ─────────────────────────────────────────────────────────────────────────────
// Binary helpers
// ─────────────────────────────────────────────────────────────────────────────

function execBinary(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    childProcess.execFile(bin, args, { timeout: 8_000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout.trim()),
    ),
  );
}

/**
 * Parses a raw version string (e.g. "gg version 1.2.3", "v1.2.3", "1.2.3")
 * into a bare semver like "1.2.3". Returns '' if unparseable.
 */
function parseVersion(raw: string): string {
  const m = raw.match(/v?(\d+\.\d+[\.\d]*)/);
  return m ? m[1] : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Installer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages the lifecycle of the `gg` CLI binary:
 *
 *  - Detects the current OS / arch.
 *  - Stores managed binaries in `context.globalStorageUri` (persists across
 *    extension updates and VS Code restarts).
 *  - Respects `gg.installationMode` ('auto' | 'manual' | 'pathOnly').
 *  - Downloads the latest GitHub release when the binary is missing.
 *  - Compares the installed version against the latest release (optional
 *    auto-check gated by `gg.autoUpdateCheck`).
 *  - Plugs a real implementation into the `gg.checkForUpdates` command stub
 *    that was registered by `ConfigManager`.
 */
export class Installer implements vscode.Disposable {
  private readonly _platform: ResolvedPlatform;
  /** Path where the extension-managed binary is stored. */
  private readonly _storageBinPath: string;

  constructor(
    context: vscode.ExtensionContext,
    private readonly configMgr: ConfigManager,
  ) {
    this._platform = detectPlatform();

    // Ensure storage directory exists
    const storageDir = context.globalStorageUri.fsPath;
    fs.mkdirSync(storageDir, { recursive: true });
    this._storageBinPath = path.join(
      storageDir,
      `${BINARY_NAME}${this._platform.binExt}`,
    );

    // Replace ConfigManager's checkForUpdates stub with real logic
    configMgr.setUpdateChecker(() => this.checkForUpdates({ silent: false }));
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Entry point called on extension activation.
   *
   * Flow:
   *  1. If `installationMode` is 'pathOnly' → do nothing.
   *  2. Try the effective binary path (setting → $GG_PATH → 'gg' on $PATH).
   *  3. If unreachable → download & install.
   *  4. Else if `autoUpdateCheck` is enabled → compare versions silently.
   */
  async ensureInstalled(): Promise<void> {
    const { installationMode, autoUpdateCheck } = this.configMgr.config;

    if (installationMode === 'pathOnly') {
      return;
    }

    const effective = this.configMgr.effectiveBinaryPath;
    const available = await this._isBinaryAvailable(effective);

    if (!available) {
      await this._install({ reason: 'missing' });
    } else if (autoUpdateCheck) {
      await this.checkForUpdates({ silent: true });
    }
  }

  /**
   * Compares the installed version with the latest GitHub release.
   *
   * @param silent – When true, only shows a notification if an update is
   *   available. When false, always notifies the user.
   */
  async checkForUpdates({ silent }: { silent: boolean }): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Gopher-Glide: Checking for updates…',
      },
      async () => {
        try {
          const effective = this.configMgr.effectiveBinaryPath;

          const [rawVersion, release] = await Promise.all([
            this._getInstalledVersion(effective),
            fetchLatestRelease(),
          ]);

          const installed = parseVersion(rawVersion);
          const latest = parseVersion(release.tag_name);

          if (!installed) {
            // Binary is reachable but version couldn't be parsed — treat as missing
            await this._install({ reason: 'missing', release });
            return;
          }

          if (latest && installed !== latest) {
            await this._promptUpdate({ installed, latest, release });
          } else if (!silent) {
            vscode.window.showInformationMessage(
              `Gopher-Glide: gg is up to date (${installed || release.tag_name}). ✅`,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!silent) {
            vscode.window.showWarningMessage(
              `Gopher-Glide: Could not check for updates — ${msg}`,
            );
          } else {
            console.warn('[Gopher-Glide] Update check failed (silent):', msg);
          }
        }
      },
    );
  }

  dispose(): void {
    // Installer holds no long-lived resources
  }

  // ── Private — binary availability ─────────────────────────────────────────

  private async _isBinaryAvailable(binPath: string): Promise<boolean> {
    try {
      await execBinary(binPath, ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  private async _getInstalledVersion(binPath: string): Promise<string> {
    try {
      return await execBinary(binPath, ['--version']);
    } catch {
      return '';
    }
  }

  // ── Private — installation ─────────────────────────────────────────────────

  /**
   * Orchestrates the download/install flow respecting `installationMode`.
   * If `release` is already known (e.g. from a previous API call) it is
   * reused to avoid a second round trip.
   */
  private async _install({
    reason,
    release,
  }: {
    reason: 'missing' | 'update';
    release?: GitHubRelease;
  }): Promise<void> {
    const { installationMode } = this.configMgr.config;

    // Manual mode: ask the user before doing anything
    if (installationMode === 'manual') {
      const prompt =
        reason === 'missing'
          ? 'The gg CLI was not found. Would you like Gopher-Glide to download it automatically?'
          : 'A new version of gg is available. Would you like to update now?';
      const choice = await vscode.window.showInformationMessage(
        `Gopher-Glide: ${prompt}`,
        'Download',
        'Not Now',
      );
      if (choice !== 'Download') {
        return;
      }
    }

    try {
      const resolvedRelease = release ?? await fetchLatestRelease();
      const expectedName = assetName(this._platform, resolvedRelease.tag_name);
      const asset = resolvedRelease.assets.find((a) => a.name === expectedName);

      if (!asset) {
        vscode.window.showErrorMessage(
          `Gopher-Glide: No release asset found for your platform ` +
          `(${this._platform.os}/${this._platform.arch}). ` +
          'Please install gg manually and set gg.binaryPath.',
        );
        return;
      }

      const archivePath = this._archivePath(resolvedRelease.tag_name);
      await this._downloadWithProgress(asset, archivePath, resolvedRelease.tag_name);
      await this._extractArchive(archivePath);
      await fs.promises.unlink(archivePath).catch(() => undefined); // clean up archive
      await this._makeExecutable(this._storageBinPath);
      await this._persistStoragePath();

      vscode.window.showInformationMessage(
        `Gopher-Glide: gg ${resolvedRelease.tag_name} installed successfully! 🚀`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(
        `Gopher-Glide: Installation failed — ${msg}`,
      );
    }
  }

  /** Shows a user-facing notification for an available update. */
  private async _promptUpdate({
    installed,
    latest,
    release,
  }: {
    installed: string;
    latest: string;
    release: GitHubRelease;
  }): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
      `Gopher-Glide: gg ${latest} is available (you have ${installed}).`,
      'Update Now',
      'Release Notes',
      'Skip',
    );

    if (choice === 'Update Now') {
      await this._install({ reason: 'update', release });
    } else if (choice === 'Release Notes') {
      await vscode.env.openExternal(vscode.Uri.parse(release.html_url));
    }
  }

  // ── Private — download & extraction ──────────────────────────────────────

  /** Returns the temp path where the release archive is downloaded. */
  private _archivePath(tagName: string): string {
    return `${this._storageBinPath}-${tagName}${this._platform.archiveExt}`;
  }

  private async _downloadWithProgress(
    asset: GitHubAsset,
    archivePath: string,
    tagName: string,
  ): Promise<void> {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Gopher-Glide: Downloading gg ${tagName}`,
        cancellable: false,
      },
      async (progress) => {
        let lastPct = 0;
        await downloadFile(
          asset.browser_download_url,
          archivePath,
          (downloaded, total) => {
            if (total <= 0) {
              return;
            }
            const pct = Math.round((downloaded / total) * 100);
            if (pct > lastPct) {
              progress.report({ increment: pct - lastPct, message: `${pct}%` });
              lastPct = pct;
            }
          },
        );
      },
    );
  }

  /**
   * Extracts the downloaded archive and places the `gg` binary at
   * `_storageBinPath`. Uses the system `tar` on macOS/Linux and
   * PowerShell's `Expand-Archive` on Windows.
   */
  private _extractArchive(archivePath: string): Promise<void> {
    const destDir = path.dirname(this._storageBinPath);
    const isWindows = process.platform === 'win32';

    // Build the extraction command
    const [cmd, args] = isWindows
      ? [
          'powershell',
          [
            '-NoProfile', '-NonInteractive', '-Command',
            `Expand-Archive -Force -Path '${archivePath}' -DestinationPath '${destDir}'`,
          ],
        ]
      : [
          'tar',
          // -x extract, -z gunzip, -f file, -C output dir, --strip-components=0
          ['-xzf', archivePath, '-C', destDir],
        ];

    return new Promise((resolve, reject) =>
      childProcess.execFile(cmd, args, { timeout: 30_000 }, (err, _stdout, stderr) => {
        if (err) {
          reject(new Error(`Extraction failed: ${stderr || err.message}`));
        } else {
          resolve();
        }
      }),
    );
  }

  /** Sets the executable bit on Unix; no-op on Windows. */
  private async _makeExecutable(binPath: string): Promise<void> {
    if (process.platform !== 'win32') {
      await fs.promises.chmod(binPath, 0o755);
    }
  }

  /**
   * Persists the managed binary path into `gg.binaryPath` (global scope)
   * so `effectiveBinaryPath` picks it up immediately — but only when the
   * user hasn't set a manual override.
   */
  private async _persistStoragePath(): Promise<void> {
    if (!this.configMgr.config.binaryPath) {
      await vscode.workspace
        .getConfiguration('gg')
        .update('binaryPath', this._storageBinPath, vscode.ConfigurationTarget.Global);
    }
  }
}
