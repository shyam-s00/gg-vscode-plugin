"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// Types matching the .snap JSON format produced by `gg --snap`.
// All optional fields are absent in older snaps or runs without body-sampling.
// Field names follow the CLI's snake_case JSON output exactly.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.endpointRequestCount = endpointRequestCount;
/** Helper: returns the request count for an endpoint regardless of field name. */
function endpointRequestCount(ep) {
    return ep.sample_count ?? ep.request_count ?? 0;
}
//# sourceMappingURL=snapModel.js.map