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
exports.defaultSnapshotsDir = defaultSnapshotsDir;
exports.resolveSnapshotsDir = resolveSnapshotsDir;
exports.parseSnapFile = parseSnapFile;
exports.loadSnaps = loadSnaps;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
// ─────────────────────────────────────────────────────────────────────────────
// Platform default snapshot directory
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Returns the directory where `gg` stores snapshots, matching the CLI's own
 * `ResolveSnapDir` logic exactly (verified against the gg source):
 *
 *  Priority:
 *   1. `GG_SNAP_DIR` environment variable (same as CLI priority #2)
 *   2. `os.UserConfigDir()/gg/snapshots`:
 *      - macOS:   ~/Library/Application Support/gg/snapshots
 *      - Windows: %APPDATA%\gg\snapshots
 *      - Linux:   $XDG_CONFIG_HOME/gg/snapshots  (falls back to ~/.config/gg/snapshots)
 *
 * The subdirectory is "snapshots" (not "snaps") and the base is the user
 * *config* dir (not data/cache), matching the Go `os.UserConfigDir()` semantics.
 */
function defaultSnapshotsDir() {
    const envDir = process.env['GG_SNAP_DIR'];
    if (envDir) {
        return envDir;
    }
    const home = os.homedir();
    switch (process.platform) {
        case 'darwin':
            return path.join(home, 'Library', 'Application Support', 'gg', 'snapshots');
        case 'win32':
            return path.join(process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming'), 'gg', 'snapshots');
        default: {
            const xdgConfig = process.env['XDG_CONFIG_HOME'];
            const base = xdgConfig && path.isAbsolute(xdgConfig) ? xdgConfig : path.join(home, '.config');
            return path.join(base, 'gg', 'snapshots');
        }
    }
}
/**
 * Returns `override` if non-empty, otherwise the platform default.
 * Pass `config.snapshotsDir` as the override value.
 */
function resolveSnapshotsDir(override) {
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
function parseSnapFile(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== 'object') {
        return undefined;
    }
    const raw = parsed;
    const meta = raw.meta;
    if (!meta || typeof meta.start_time !== 'string') {
        return undefined;
    }
    return raw;
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
async function loadSnaps(dir) {
    let entries;
    try {
        entries = await fs.promises.readdir(dir);
    }
    catch {
        return [];
    }
    const snapFiles = entries.filter((name) => name.endsWith('.snap'));
    const loaded = [];
    for (const name of snapFiles) {
        const filePath = path.join(dir, name);
        let text;
        try {
            text = await fs.promises.readFile(filePath, 'utf-8');
        }
        catch {
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
//# sourceMappingURL=snapDataManager.js.map