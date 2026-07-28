import * as assert from 'assert';

import { BUILT_IN_PROFILES } from '../profiles/profileCatalog';
import { generateConfigTemplate, generateHttpTestTemplate, HTTP_TEMPLATE_PLACEHOLDER_URL } from '../scaffolding/scaffolding';

suite('generateConfigTemplate', () => {
  test('contains the given http filename in the httpFile field', () => {
    const out = generateConfigTemplate('api.http');
    assert.ok(out.includes('httpFile: "api.http"'));
  });

  test('includes all expected config keys', () => {
    const out = generateConfigTemplate('a.http');
    assert.ok(out.includes('prometheus: false'));
    assert.ok(out.includes('breaker_threshold_pct: 20.0'));
    assert.ok(out.includes('jitter: 0.1'));
    assert.ok(out.includes('time_scale: 1.0'));
  });

  test('includes a Ramp-up stage', () => {
    const out = generateConfigTemplate('a.http');
    assert.ok(out.includes('name: "Ramp-up"'));
    assert.ok(out.includes('duration: 10s'));
    assert.ok(out.includes('target_rps: 50'));
  });
});

suite('generateHttpTestTemplate', () => {
  test('contains the placeholder URL', () => {
    const out = generateHttpTestTemplate();
    assert.ok(out.includes(HTTP_TEMPLATE_PLACEHOLDER_URL));
  });

  test('contains all 21 profile names in the header comment', () => {
    const out = generateHttpTestTemplate();
    for (const profile of BUILT_IN_PROFILES) {
      assert.ok(out.includes(profile.name), `missing profile ${profile.name} in template`);
    }
  });

  test('groups profiles under their categories in the comment', () => {
    const out = generateHttpTestTemplate();
    assert.ok(out.includes('E-Commerce & High-Demand'));
    assert.ok(out.includes('Standard Testing & CI/CD'));
    assert.ok(out.includes('Resilience & Chaos'));
    assert.ok(out.includes('Auto-Scaling'));
    assert.ok(out.includes('Specialized'));
  });

  test('includes a sample GET request line', () => {
    const out = generateHttpTestTemplate();
    assert.ok(out.includes('GET https://example.com/'));
  });
});
