import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirrors the gg `.gg.yaml` config schema (config / snap / stages)
// ─────────────────────────────────────────────────────────────────────────────

export interface GgStage {
  name?: string;
  duration: string;
  target_rps: number;
}

export interface GgSnapSettings {
  sample_rate?: number;
  max_samples?: number;
  max_body_kb?: number;
}

export interface GgConfigSection {
  httpFile: string;
  prometheus?: boolean;
  prometheus_port?: number;
  breaker_threshold_pct?: number;
  jitter?: number;
  time_scale?: number;
}

export interface GgConfigFile {
  config: GgConfigSection;
  snap?: GgSnapSettings;
  stages: GgStage[];
}

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
export function parseGgConfig(text: string): GgConfigFile | undefined {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return undefined;
  }

  if (!doc || typeof doc !== 'object') {
    return undefined;
  }

  const raw = doc as Record<string, unknown>;
  const config = raw.config;
  if (!config || typeof config !== 'object' || typeof (config as Record<string, unknown>).httpFile !== 'string') {
    return undefined;
  }
  const configRec = config as Record<string, unknown>;

  return {
    config: {
      httpFile: configRec.httpFile as string,
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

function parseSnapSection(value: unknown): GgSnapSettings | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const s = value as Record<string, unknown>;
  return {
    sample_rate: asNumber(s.sample_rate),
    max_samples: asNumber(s.max_samples),
    max_body_kb: asNumber(s.max_body_kb),
  };
}

function parseStages(value: unknown): GgStage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      name: typeof item.name === 'string' ? item.name : undefined,
      duration: typeof item.duration === 'string' ? item.duration : String(item.duration ?? ''),
      target_rps: asNumber(item.target_rps) ?? 0,
    }));
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// File resolution
// ─────────────────────────────────────────────────────────────────────────────

/** True if `fileName` matches the `*.gg.yaml` convention (e.g. `traffic-sim.gg.yaml`). */
export function isGgConfigFile(fileName: string): boolean {
  return fileName.endsWith(GG_YAML_SUFFIX);
}

/**
 * Resolves a parsed config's `httpFile` to an absolute path, relative to the
 * directory containing the `.gg.yaml` file — matching how `gg` itself
 * resolves `httpFile` at run time.
 */
export function resolveHttpFile(configPath: string, parsed: GgConfigFile): string {
  return path.resolve(path.dirname(configPath), parsed.config.httpFile);
}

/**
 * Finds a sibling `*.gg.yaml` file for a given `.http` file: same directory,
 * any file ending in `.gg.yaml`. Returns the first match in alphabetical
 * order, or `undefined` if none exist. Mirrors the JetBrains plugin's check
 * (existence only — it does not verify the config's `httpFile` points back
 * at this exact file).
 */
export async function findSiblingConfig(httpFilePath: string): Promise<string | undefined> {
  const dir = path.dirname(httpFilePath);
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return undefined;
  }

  const match = entries.filter(isGgConfigFile).sort()[0];
  return match ? path.join(dir, match) : undefined;
}
