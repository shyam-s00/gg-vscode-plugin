import * as assert from 'assert';

import {
  BUILT_IN_PROFILES,
  byCategory,
  byName,
  CATEGORY_ORDER,
  parseCustomProfilesOutput,
  ProfileCategory,
} from '../profiles/profileCatalog';

suite('profileCatalog', () => {
  test('has exactly 21 built-in profiles with unique names', () => {
    assert.strictEqual(BUILT_IN_PROFILES.length, 21);
    const names = new Set(BUILT_IN_PROFILES.map((p) => p.name));
    assert.strictEqual(names.size, 21);
  });

  test('every built-in profile has a non-empty description, duration, and positive peak RPS', () => {
    for (const profile of BUILT_IN_PROFILES) {
      assert.ok(profile.description.length > 0, `${profile.name} missing description`);
      assert.ok(profile.defaultDuration.length > 0, `${profile.name} missing defaultDuration`);
      assert.ok(profile.defaultPeakRps > 0, `${profile.name} missing defaultPeakRps`);
      assert.notStrictEqual(profile.category, 'Custom');
    }
  });

  test('every built-in profile belongs to a known, non-Custom category', () => {
    const builtInCategories: ProfileCategory[] = CATEGORY_ORDER.filter((c) => c !== 'Custom');
    for (const profile of BUILT_IN_PROFILES) {
      assert.ok(builtInCategories.includes(profile.category), `unexpected category for ${profile.name}`);
    }
  });

  test('byName finds a known profile and returns undefined for an unknown one', () => {
    assert.strictEqual(byName('flash-sale')?.defaultPeakRps, 2000);
    assert.strictEqual(byName('smoke')?.defaultDuration, '10s');
    assert.strictEqual(byName('does-not-exist'), undefined);
  });

  test('byCategory groups all built-ins, preserving CATEGORY_ORDER, with no empty categories', () => {
    const grouped = byCategory();
    const groupedCategories = Array.from(grouped.keys());

    // Every category present must appear in CATEGORY_ORDER, in the same relative order.
    let lastIndex = -1;
    for (const category of groupedCategories) {
      const idx = CATEGORY_ORDER.indexOf(category);
      assert.ok(idx > lastIndex, `${category} out of CATEGORY_ORDER sequence`);
      lastIndex = idx;
    }

    // 'Custom' shouldn't appear when grouping only built-ins.
    assert.ok(!grouped.has('Custom'));

    const total = Array.from(grouped.values()).reduce((sum, list) => sum + list.length, 0);
    assert.strictEqual(total, 21);

    assert.deepStrictEqual(
      grouped.get('E-Commerce & High-Demand')?.map((p) => p.name).sort(),
      ['black-friday', 'flash-sale', 'inventory-drop', 'ticket-release'].sort(),
    );
  });

  suite('parseCustomProfilesOutput', () => {
    test('parses a well-formed JSON array of custom profiles', () => {
      const json = JSON.stringify([
        { name: 'my-custom-one', description: 'A custom profile', default_duration: '5m', default_peak_rps: 42 },
      ]);
      const profiles = parseCustomProfilesOutput(json);
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
      const [profile] = parseCustomProfilesOutput(json);
      assert.strictEqual(profile.defaultDuration, '1m');
      assert.strictEqual(profile.defaultPeakRps, 7);
    });

    test('filters out entries that collide with a built-in name', () => {
      const json = JSON.stringify([
        { name: 'flash-sale', default_peak_rps: 1 },
        { name: 'genuinely-custom', default_peak_rps: 1 },
      ]);
      const profiles = parseCustomProfilesOutput(json);
      assert.strictEqual(profiles.length, 1);
      assert.strictEqual(profiles[0].name, 'genuinely-custom');
    });

    test('defaults missing fields instead of throwing', () => {
      const [profile] = parseCustomProfilesOutput(JSON.stringify([{ name: 'bare' }]));
      assert.strictEqual(profile.name, 'bare');
      assert.strictEqual(profile.description, '');
      assert.strictEqual(profile.defaultDuration, '');
      assert.strictEqual(profile.defaultPeakRps, 0);
    });

    test('returns an empty array for invalid JSON', () => {
      assert.deepStrictEqual(parseCustomProfilesOutput('not json'), []);
    });

    test('returns an empty array for valid JSON that is not an array', () => {
      assert.deepStrictEqual(parseCustomProfilesOutput('{"name":"x"}'), []);
    });

    test('skips array entries without a usable name', () => {
      const json = JSON.stringify([{ description: 'no name here' }, null, 'a string', 42]);
      assert.deepStrictEqual(parseCustomProfilesOutput(json), []);
    });
  });
});
