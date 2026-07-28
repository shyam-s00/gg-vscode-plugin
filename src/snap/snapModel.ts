// ─────────────────────────────────────────────────────────────────────────────
// Types matching the .snap JSON format produced by `gg --snap`.
// All optional fields are absent in older snaps or runs without body-sampling.
// Field names follow the CLI's snake_case JSON output exactly.
// ─────────────────────────────────────────────────────────────────────────────

export interface SnapLatency {
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

export interface SnapPayloadSize {
  avg?: number;
  p95?: number;
  max?: number;
}

export interface SnapFieldSchema {
  type: string;
  /** Fraction of sampled responses that included this field (0–1). */
  presence: number;
  stability?: string;
}

export interface SnapSchema {
  sample_count: number;
  fields: Record<string, SnapFieldSchema>;
}

export interface SnapEndpoint {
  /** "METHOD:url", e.g. "GET:http://localhost:8080/api/users" */
  id: string;
  /** Status code → fraction of responses (e.g. "200": 0.99, "500": 0.01) */
  status_dist: Record<string, number>;
  latency: SnapLatency;
  payload_size?: SnapPayloadSize;
  error_rate: number;
  /** Number of requests sampled for this endpoint (field name in gg v1). */
  sample_count?: number;
  /** Alias used in some gg versions — callers should prefer sample_count. */
  request_count?: number;
  body_samples_observed?: number;
  body_samples_stored?: number;
  schema?: SnapSchema;
}

export interface SnapSettings {
  sample_rate?: number;
  max_samples?: number;
  max_body_kb?: number;
}

export interface SnapMeta {
  tag: string;
  start_time: string;
  end_time: string;
  peak_rps: number;
  total_requests: number;
  config_hash?: string;
  snap_settings?: SnapSettings;
  /** Simulation profile name used for the run, if the gg CLI recorded one. */
  profile_name?: string;
  profile_scale?: number;
}

export interface SnapModel {
  version: number;
  meta: SnapMeta;
  endpoints: SnapEndpoint[];
}

/** `SnapModel` enriched with file-system metadata added by `SnapDataManager`. */
export interface LoadedSnap extends SnapModel {
  /** Absolute path to the `.snap` file on disk. */
  filePath: string;
  /**
   * Stable 1-based numeric index used by the CLI `--ids` flag.
   * Oldest snap = 1, newest snap = N (regardless of display order).
   */
  internalIndex: number;
}

/** Helper: returns the request count for an endpoint regardless of field name. */
export function endpointRequestCount(ep: SnapEndpoint): number {
  return ep.sample_count ?? ep.request_count ?? 0;
}
