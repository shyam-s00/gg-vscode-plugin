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
const scaffolding_1 = require("../scaffolding");
suite('generateConfigTemplate', () => {
    test('contains the given http filename in the httpFile field', () => {
        const out = (0, scaffolding_1.generateConfigTemplate)('api.http');
        assert.ok(out.includes('httpFile: "api.http"'));
    });
    test('includes all expected config keys', () => {
        const out = (0, scaffolding_1.generateConfigTemplate)('a.http');
        assert.ok(out.includes('prometheus: false'));
        assert.ok(out.includes('breaker_threshold_pct: 20.0'));
        assert.ok(out.includes('jitter: 0.1'));
        assert.ok(out.includes('time_scale: 1.0'));
    });
    test('includes a Ramp-up stage', () => {
        const out = (0, scaffolding_1.generateConfigTemplate)('a.http');
        assert.ok(out.includes('name: "Ramp-up"'));
        assert.ok(out.includes('duration: 10s'));
        assert.ok(out.includes('target_rps: 50'));
    });
});
suite('generateHttpTestTemplate', () => {
    test('contains the placeholder URL', () => {
        const out = (0, scaffolding_1.generateHttpTestTemplate)();
        assert.ok(out.includes(scaffolding_1.HTTP_TEMPLATE_PLACEHOLDER_URL));
    });
    test('contains all 21 profile names in the header comment', () => {
        const out = (0, scaffolding_1.generateHttpTestTemplate)();
        for (const profile of profileCatalog_1.BUILT_IN_PROFILES) {
            assert.ok(out.includes(profile.name), `missing profile ${profile.name} in template`);
        }
    });
    test('groups profiles under their categories in the comment', () => {
        const out = (0, scaffolding_1.generateHttpTestTemplate)();
        assert.ok(out.includes('E-Commerce & High-Demand'));
        assert.ok(out.includes('Standard Testing & CI/CD'));
        assert.ok(out.includes('Resilience & Chaos'));
        assert.ok(out.includes('Auto-Scaling'));
        assert.ok(out.includes('Specialized'));
    });
    test('includes a sample GET request line', () => {
        const out = (0, scaffolding_1.generateHttpTestTemplate)();
        assert.ok(out.includes('GET https://example.com/'));
    });
});
//# sourceMappingURL=scaffolding.test.js.map