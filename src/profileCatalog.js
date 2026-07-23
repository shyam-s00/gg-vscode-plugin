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
exports.BUILT_IN_PROFILES = exports.CATEGORY_ORDER = void 0;
exports.byName = byName;
exports.byCategory = byCategory;
exports.parseCustomProfilesOutput = parseCustomProfilesOutput;
exports.loadCustomProfiles = loadCustomProfiles;
const childProcess = __importStar(require("child_process"));
/** Display order for grouped UI (QuickPick categories, etc.). 'Custom' always sorts last. */
exports.CATEGORY_ORDER = [
    'E-Commerce & High-Demand',
    'Standard Testing & CI/CD',
    'Resilience & Chaos',
    'Auto-Scaling',
    'Specialized',
    'Custom',
];
// ─────────────────────────────────────────────────────────────────────────────
// Built-in profiles — mirrors the JetBrains plugin's ProfileCatalog.kt, which
// mirrors `gg profile list`'s 21 embedded profiles.
// ─────────────────────────────────────────────────────────────────────────────
exports.BUILT_IN_PROFILES = [
    // E-Commerce & High-Demand
    {
        name: 'flash-sale',
        description: 'Massive instant spike to 100% peak, hold for the run, then drop to zero — simulates a product launch.',
        category: 'E-Commerce & High-Demand',
        defaultDuration: '3m',
        defaultPeakRps: 2000,
    },
    {
        name: 'black-friday',
        description: 'Sustained high load simulating a Black Friday traffic event.',
        category: 'E-Commerce & High-Demand',
        defaultDuration: '17m',
        defaultPeakRps: 2500,
    },
    {
        name: 'ticket-release',
        description: 'Extreme, very short spike simulating a ticket or concert drop.',
        category: 'E-Commerce & High-Demand',
        defaultDuration: '1m',
        defaultPeakRps: 5000,
    },
    {
        name: 'inventory-drop',
        description: 'Sustained high load simulating an e-commerce inventory release.',
        category: 'E-Commerce & High-Demand',
        defaultDuration: '16m',
        defaultPeakRps: 1500,
    },
    // Standard Testing & CI/CD
    {
        name: 'canary',
        description: 'Very low, very brief post-deploy sanity check.',
        category: 'Standard Testing & CI/CD',
        defaultDuration: '30s',
        defaultPeakRps: 5,
    },
    {
        name: 'smoke',
        description: 'Quick smoke test to confirm the system responds before a real run.',
        category: 'Standard Testing & CI/CD',
        defaultDuration: '10s',
        defaultPeakRps: 10,
    },
    {
        name: 'load',
        description: 'Standard baseline load test — ramp up, sustain, then ramp down.',
        category: 'Standard Testing & CI/CD',
        defaultDuration: '2m',
        defaultPeakRps: 100,
    },
    {
        name: 'stress',
        description: 'Aggressive staircase ramp designed to find the breaking point.',
        category: 'Standard Testing & CI/CD',
        defaultDuration: '3m30s',
        defaultPeakRps: 2000,
    },
    {
        name: 'soak',
        description: 'Long-duration soak test for memory leaks and GC pressure.',
        category: 'Standard Testing & CI/CD',
        defaultDuration: '70m',
        defaultPeakRps: 200,
    },
    {
        name: 'endurance',
        description: 'Extended endurance test well beyond a normal soak.',
        category: 'Standard Testing & CI/CD',
        defaultDuration: '130m',
        defaultPeakRps: 500,
    },
    // Resilience & Chaos
    {
        name: 'ddos',
        description: 'Simulated DDoS-scale flood.',
        category: 'Resilience & Chaos',
        defaultDuration: '10m',
        defaultPeakRps: 5000,
    },
    {
        name: 'spike',
        description: 'Sudden sharp spike to peak, then hold to observe recovery.',
        category: 'Resilience & Chaos',
        defaultDuration: '3m30s',
        defaultPeakRps: 1000,
    },
    {
        name: 'burst',
        description: 'Brief, sharp burst scenario.',
        category: 'Resilience & Chaos',
        defaultDuration: '3m45s',
        defaultPeakRps: 500,
    },
    {
        name: 'retry-storm',
        description: 'High retry / circuit-breaker pressure load.',
        category: 'Resilience & Chaos',
        defaultDuration: '4m',
        defaultPeakRps: 800,
    },
    {
        name: 'chaos',
        description: 'Chaos/fault-injection style load with irregular demand.',
        category: 'Resilience & Chaos',
        defaultDuration: '10m',
        defaultPeakRps: 200,
    },
    // Auto-Scaling
    {
        name: 'step-up',
        description: 'Staircase ramp-up through increasing RPS plateaus.',
        category: 'Auto-Scaling',
        defaultDuration: '14m',
        defaultPeakRps: 1000,
    },
    {
        name: 'wave',
        description: 'Repeating wave pattern of rising and falling RPS.',
        category: 'Auto-Scaling',
        defaultDuration: '12m',
        defaultPeakRps: 500,
    },
    {
        name: 'scale-down',
        description: 'Graceful scale-down to verify orderly draining of load.',
        category: 'Auto-Scaling',
        defaultDuration: '10m',
        defaultPeakRps: 1000,
    },
    // Specialized
    {
        name: 'crawler',
        description: 'Moderate, long-running crawl-style load.',
        category: 'Specialized',
        defaultDuration: '34m',
        defaultPeakRps: 50,
    },
    {
        name: 'trickle',
        description: 'Ultra-low, long-running baseline load to establish a quiet steady state.',
        category: 'Specialized',
        defaultDuration: '30m',
        defaultPeakRps: 2,
    },
    {
        name: 'warm-up',
        description: 'Gentle ramp to warm caches and connections before a heavier test.',
        category: 'Specialized',
        defaultDuration: '5m',
        defaultPeakRps: 100,
    },
];
// ─────────────────────────────────────────────────────────────────────────────
// Lookup helpers
// ─────────────────────────────────────────────────────────────────────────────
/** Looks up a profile by exact name within the given list (built-ins by default). */
function byName(name, profiles = exports.BUILT_IN_PROFILES) {
    return profiles.find((p) => p.name === name);
}
/** Groups profiles by category, preserving `CATEGORY_ORDER`; omits categories with no entries. */
function byCategory(profiles = exports.BUILT_IN_PROFILES) {
    const grouped = new Map();
    for (const category of exports.CATEGORY_ORDER) {
        const inCategory = profiles.filter((p) => p.category === category);
        if (inCategory.length > 0) {
            grouped.set(category, inCategory);
        }
    }
    return grouped;
}
// ─────────────────────────────────────────────────────────────────────────────
// Custom profiles (`~/.config/gg/profiles/*.yaml`, surfaced via `gg profile list`)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Parses the (assumed) JSON output of `gg profile list --reporter json` into
 * `GgProfile`s, filtering out anything that collides with a built-in name.
 *
 * Deliberately lenient: the exact JSON shape for this subcommand isn't
 * confirmed against the CLI source, so unknown/missing fields fall back to
 * empty/zero rather than throwing, and any field-name variant we've seen
 * elsewhere in gg's other `--reporter json` output (snake_case vs camelCase)
 * is accepted.
 */
function parseCustomProfilesOutput(stdout, knownNames = new Set(exports.BUILT_IN_PROFILES.map((p) => p.name))) {
    let parsed;
    try {
        parsed = JSON.parse(stdout);
    }
    catch {
        return [];
    }
    if (!Array.isArray(parsed)) {
        return [];
    }
    return parsed
        .filter((item) => !!item && typeof item === 'object')
        .map(normalizeCustomProfile)
        .filter((p) => p !== undefined && !knownNames.has(p.name));
}
function normalizeCustomProfile(item) {
    const name = item.name;
    if (typeof name !== 'string' || !name) {
        return undefined;
    }
    return {
        name,
        description: pickString(item.description) ?? '',
        category: 'Custom',
        defaultDuration: pickString(item.default_duration, item.defaultDuration, item.duration) ?? '',
        defaultPeakRps: pickNumber(item.default_peak_rps, item.defaultPeakRps, item.peak_rps) ?? 0,
    };
}
function pickString(...values) {
    for (const v of values) {
        if (typeof v === 'string' && v) {
            return v;
        }
    }
    return undefined;
}
function pickNumber(...values) {
    for (const v of values) {
        if (typeof v === 'number') {
            return v;
        }
    }
    return undefined;
}
/**
 * Best-effort load of user-exported custom profiles by shelling out to
 * `gg profile list --reporter json`. Returns an empty array on any failure —
 * older binaries that don't support `--reporter` on this subcommand, non-JSON
 * output, a missing binary, etc. Custom profiles are a nice-to-have in the
 * picker, never a hard requirement, so failures here must stay silent.
 */
async function loadCustomProfiles(binaryPath) {
    try {
        const stdout = await execFileText(binaryPath, ['profile', 'list', '--reporter', 'json']);
        return parseCustomProfilesOutput(stdout);
    }
    catch {
        return [];
    }
}
function execFileText(bin, args) {
    return new Promise((resolve, reject) => {
        childProcess.execFile(bin, args, { timeout: 8_000 }, (err, stdout) => err ? reject(err) : resolve(stdout));
    });
}
//# sourceMappingURL=profileCatalog.js.map