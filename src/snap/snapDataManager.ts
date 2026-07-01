import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { LoadedSnap, SnapModel } from './snapModel';

// ─────────────────────────────────────────────────────────────────────────────
// Platform default snapshot directory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the platform-appropriate default snapshots directory that `gg` itself
 * uses. Exported for unit testing.
 *
 * - macOS:   ~/Library/Application Support/gg/snaps
 * - Windows: %APPDATA%\gg\snaps
 * - Linux:   $XDG_DATA_HOME/gg/snaps  (falls back to ~/.local/share/gg/snaps)
 */
export function defaultSnapshotsDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'gg', 'snaps');
    case 'win32':
      return path.join(process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming'), 'gg', 'snaps');
    default: {
      const xdgData = process.env['XDG_DATA_HOME'];
      const base = xdgData && path.isAbsolute(xdgData)
        ? xdgData
        : path.join(home, '.local', 'share');
      return path.join(base, 'gg', 'snaps');
    }
  }
}

/**
 * Returns `override` if non-empty, otherwise the platform default.
 * Pass `config.snapshotsDir` as the override value.
 */
export function resolveSnapshotsDir(override: string): string {
  return override.trim() || defaultSnapshotsDir();
}

// ─────────────────────────────────────────────────────────────────────────────
// Parsing — exported for direct testing without file I/O
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses raw `.snap` JSON text into a `SnapModel`.
 * Returns `undefined` on invalid JSON or if the document doesn't look like a
 * gg snapshot (no `meta.start_time`), so callers can skip unknown files
 * without throwing.
 */
export function parseSnapFile(text: string): SnapModel | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== 'object') {
    return undefined;
  }

  const raw = parsed as Record<string, unknown>;
  const meta = raw.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta.start_time !== 'string') {
    return undefined;
  }

  return raw as unknown as SnapModel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans `dir` for `*.snap` files, parses each one, sorts them newest-first by
 * `meta.start_time`, and assigns a stable `internalIndex` (oldest = 1,
 * newest = N) so `--ids` arguments to `gg snap assert`/`prune` stay valid
 * regardless of display order.
 *
 * Non-parseable files are silently skipped — forward-compatible with any
 * new files gg might write to the same directory in the future.
 */
export async function loadSnaps(dir: string): Promise<LoadedSnap[]> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return [];
  }

  const snapFiles = entries.filter((name) => name.endsWith('.snap'));

  const loaded: LoadedSnap[] = [];
  for (const name of snapFiles) {
    const filePath = path.join(dir, name);
    let text: string;
    try {
      text = await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      continue;
    }
    const model = parseSnapFile(text);
    if (!model) {
      continue;
    }
    loaded.push({ ...model, filePath, internalIndex: 0 });
  }

  // Sort ascending by start_time to assign indices (oldest = 1, newest = N).
  loaded.sort((a, b) => a.meta.start_time.localeCompare(b.meta.start_time));
  loaded.forEach((snap, idx) => {
    snap.internalIndex = idx + 1;
  });

  // Reverse to display newest-first.
  loaded.reverse();
  return loaded;
}
