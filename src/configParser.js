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
exports.parseGgConfig = parseGgConfig;
exports.isGgConfigFile = isGgConfigFile;
exports.resolveHttpFile = resolveHttpFile;
exports.findSiblingConfig = findSiblingConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const yaml_1 = require("yaml");
const GG_YAML_SUFFIX = '.gg.yaml';
// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Parses raw `.gg.yaml` text into a typed `GgConfigFile`.
 *
 * Returns `undefined` when the document isn't valid YAML, or doesn't have a
 * `config.httpFile` string — the one field gg always requires — rather than
 * throwing, so callers (CodeLens providers, definition providers) can treat
 * "not a gg config" as a normal case instead of a try/catch.
 */
function parseGgConfig(text) {
    let doc;
    try {
        doc = (0, yaml_1.parse)(text);
    }
    catch {
        return undefined;
    }
    if (!doc || typeof doc !== 'object') {
        return undefined;
    }
    const raw = doc;
    const config = raw.config;
    if (!config || typeof config !== 'object' || typeof config.httpFile !== 'string') {
        return undefined;
    }
    const configRec = config;
    return {
        config: {
            httpFile: configRec.httpFile,
            prometheus: asBoolean(configRec.prometheus),
            prometheus_port: asNumber(configRec.prometheus_port),
            breaker_threshold_pct: asNumber(configRec.breaker_threshold_pct),
            jitter: asNumber(configRec.jitter),
            time_scale: asNumber(configRec.time_scale),
        },
        snap: parseSnapSection(raw.snap),
        stages: parseStages(raw.stages),
    };
}
function parseSnapSection(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const s = value;
    return {
        sample_rate: asNumber(s.sample_rate),
        max_samples: asNumber(s.max_samples),
        max_body_kb: asNumber(s.max_body_kb),
    };
}
function parseStages(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((item) => !!item && typeof item === 'object')
        .map((item) => ({
        name: typeof item.name === 'string' ? item.name : undefined,
        duration: typeof item.duration === 'string' ? item.duration : String(item.duration ?? ''),
        target_rps: asNumber(item.target_rps) ?? 0,
    }));
}
function asNumber(value) {
    return typeof value === 'number' ? value : undefined;
}
function asBoolean(value) {
    return typeof value === 'boolean' ? value : undefined;
}
// ─────────────────────────────────────────────────────────────────────────────
// File resolution
// ─────────────────────────────────────────────────────────────────────────────
/** True if `fileName` matches the `*.gg.yaml` convention (e.g. `traffic-sim.gg.yaml`). */
function isGgConfigFile(fileName) {
    return fileName.endsWith(GG_YAML_SUFFIX);
}
/**
 * Resolves a parsed config's `httpFile` to an absolute path, relative to the
 * directory containing the `.gg.yaml` file — matching how `gg` itself
 * resolves `httpFile` at run time.
 */
function resolveHttpFile(configPath, parsed) {
    return path.resolve(path.dirname(configPath), parsed.config.httpFile);
}
/**
 * Finds a sibling `*.gg.yaml` file for a given `.http` file: same directory,
 * any file ending in `.gg.yaml`. Returns the first match in alphabetical
 * order, or `undefined` if none exist. Mirrors the JetBrains plugin's check
 * (existence only — it does not verify the config's `httpFile` points back
 * at this exact file).
 */
async function findSiblingConfig(httpFilePath) {
    const dir = path.dirname(httpFilePath);
    let entries;
    try {
        entries = await fs.promises.readdir(dir);
    }
    catch {
        return undefined;
    }
    const match = entries.filter(isGgConfigFile).sort()[0];
    return match ? path.join(dir, match) : undefined;
}
//# sourceMappingURL=configParser.js.map