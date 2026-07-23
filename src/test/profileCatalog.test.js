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
const assert = __importStar(require("assert"));
const profileCatalog_1 = require("../profileCatalog");
suite('profileCatalog', () => {
    test('has exactly 21 built-in profiles with unique names', () => {
        assert.strictEqual(profileCatalog_1.BUILT_IN_PROFILES.length, 21);
        const names = new Set(profileCatalog_1.BUILT_IN_PROFILES.map((p) => p.name));
        assert.strictEqual(names.size, 21);
    });
    test('every built-in profile has a non-empty description, duration, and positive peak RPS', () => {
        for (const profile of profileCatalog_1.BUILT_IN_PROFILES) {
            assert.ok(profile.description.length > 0, `${profile.name} missing description`);
            assert.ok(profile.defaultDuration.length > 0, `${profile.name} missing defaultDuration`);
            assert.ok(profile.defaultPeakRps > 0, `${profile.name} missing defaultPeakRps`);
            assert.notStrictEqual(profile.category, 'Custom');
        }
    });
    test('every built-in profile belongs to a known, non-Custom category', () => {
        const builtInCategories = profileCatalog_1.CATEGORY_ORDER.filter((c) => c !== 'Custom');
        for (const profile of profileCatalog_1.BUILT_IN_PROFILES) {
            assert.ok(builtInCategories.includes(profile.category), `unexpected category for ${profile.name}`);
        }
    });
    test('byName finds a known profile and returns undefined for an unknown one', () => {
        assert.strictEqual((0, profileCatalog_1.byName)('flash-sale')?.defaultPeakRps, 2000);
        assert.strictEqual((0, profileCatalog_1.byName)('smoke')?.defaultDuration, '10s');
        assert.strictEqual((0, profileCatalog_1.byName)('does-not-exist'), undefined);
    });
    test('byCategory groups all built-ins, preserving CATEGORY_ORDER, with no empty categories', () => {
        const grouped = (0, profileCatalog_1.byCategory)();
        const groupedCategories = Array.from(grouped.keys());
        // Every category present must appear in CATEGORY_ORDER, in the same relative order.
        let lastIndex = -1;
        for (const category of groupedCategories) {
            const idx = profileCatalog_1.CATEGORY_ORDER.indexOf(category);
            assert.ok(idx > lastIndex, `${category} out of CATEGORY_ORDER sequence`);
            lastIndex = idx;
        }
        // 'Custom' shouldn't appear when grouping only built-ins.
        assert.ok(!grouped.has('Custom'));
        const total = Array.from(grouped.values()).reduce((sum, list) => sum + list.length, 0);
        assert.strictEqual(total, 21);
        assert.deepStrictEqual(grouped.get('E-Commerce & High-Demand')?.map((p) => p.name).sort(), ['black-friday', 'flash-sale', 'inventory-drop', 'ticket-release'].sort());
    });
    suite('parseCustomProfilesOutput', () => {
        test('parses a well-formed JSON array of custom profiles', () => {
            const json = JSON.stringify([
                { name: 'my-custom-one', description: 'A custom profile', default_duration: '5m', default_peak_rps: 42 },
            ]);
            const profiles = (0, profileCatalog_1.parseCustomProfilesOutput)(json);
            assert.strictEqual(profiles.length, 1);
            assert.strictEqual(profiles[0].name, 'my-custom-one');
            assert.strictEqual(profiles[0].category, 'Custom');
            assert.strictEqual(profiles[0].defaultDuration, '5m');
            assert.strictEqual(profiles[0].defaultPeakRps, 42);
        });
        test('accepts camelCase field name variants', () => {
            const json = JSON.stringify([
                { name: 'camel-case-profile', defaultDuration: '1m', defaultPeakRps: 7 },
            ]);
            const [profile] = (0, profileCatalog_1.parseCustomProfilesOutput)(json);
            assert.strictEqual(profile.defaultDuration, '1m');
            assert.strictEqual(profile.defaultPeakRps, 7);
        });
        test('filters out entries that collide with a built-in name', () => {
            const json = JSON.stringify([
                { name: 'flash-sale', default_peak_rps: 1 },
                { name: 'genuinely-custom', default_peak_rps: 1 },
            ]);
            const profiles = (0, profileCatalog_1.parseCustomProfilesOutput)(json);
            assert.strictEqual(profiles.length, 1);
            assert.strictEqual(profiles[0].name, 'genuinely-custom');
        });
        test('defaults missing fields instead of throwing', () => {
            const [profile] = (0, profileCatalog_1.parseCustomProfilesOutput)(JSON.stringify([{ name: 'bare' }]));
            assert.strictEqual(profile.name, 'bare');
            assert.strictEqual(profile.description, '');
            assert.strictEqual(profile.defaultDuration, '');
            assert.strictEqual(profile.defaultPeakRps, 0);
        });
        test('returns an empty array for invalid JSON', () => {
            assert.deepStrictEqual((0, profileCatalog_1.parseCustomProfilesOutput)('not json'), []);
        });
        test('returns an empty array for valid JSON that is not an array', () => {
            assert.deepStrictEqual((0, profileCatalog_1.parseCustomProfilesOutput)('{"name":"x"}'), []);
        });
        test('skips array entries without a usable name', () => {
            const json = JSON.stringify([{ description: 'no name here' }, null, 'a string', 42]);
            assert.deepStrictEqual((0, profileCatalog_1.parseCustomProfilesOutput)(json), []);
        });
    });
});
//# sourceMappingURL=profileCatalog.test.js.map