import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  themes,
  defaultAppearance,
  paletteError,
  validateAppearance,
  themeTokens,
  contrast,
  readAppearance,
  saveAppearance,
  storageKey,
} from '../ui/theme.js';

test('all twelve themes have readable dark and light colors and control text', () => {
  assert.equal(themes.length, 12);
  assert.equal(new Set(themes.map((t) => t.id)).size, 12);
  for (const theme of themes)
    for (const mode of ['dark', 'light'] as const) {
      const p = theme[mode];
      assert.equal(paletteError(p), undefined, `${theme.name} ${mode}`);
      const tokens = themeTokens(p);
      assert.ok(contrast(tokens['--on-accent']!, p.accent) >= 4.5);
      for (const bg of [
        p.background,
        p.surface,
        tokens['--raised']!,
        tokens['--soft']!,
        ...(p.gradientEnd ? [p.gradientEnd] : []),
      ]) {
        assert.ok(contrast(tokens['--muted']!, bg) >= 4.5, `${theme.name} ${mode} secondary text`);
      }
      assert.equal(!!p.gradientEnd, ['nebula', 'solar-flare', 'synthwave'].includes(theme.id));
    }
});
test('legacy appearance choices migrate without losing colors, mode or density', () => {
  for (const mode of ['paper', 'graphite'])
    for (const accent of ['sage', 'sky', 'clay']) {
      const legacy = new Map([
        ['slim.theme', mode],
        ['slim.accent', accent],
        ['slim.density', 'compact'],
      ]);
      const value = readAppearance({ getItem: (key) => legacy.get(key) ?? null });
      assert.ok(validateAppearance(value));
      assert.equal(value.preset, 'custom');
      assert.equal(value.mode, mode === 'paper' ? 'light' : 'dark');
      assert.equal(value.density, 'compact');
      assert.equal(
        value.custom.dark.accent,
        accent === 'sky' ? '#9ac9e4' : accent === 'clay' ? '#e5ad93' : '#b4d996',
      );
      assert.equal(value.custom.light.background, '#f4f3ec');
    }
});
test('malformed saved preferences cannot inject CSS, and unavailable storage is harmless', () => {
  for (const raw of [
    '{',
    'null',
    '[]',
    '{}',
    JSON.stringify({ ...defaultAppearance(), preset: '__proto__' }),
  ])
    assert.deepEqual(
      readAppearance({ getItem: (key) => (key === storageKey ? raw : null) }),
      defaultAppearance(),
    );
  assert.deepEqual(
    readAppearance({
      getItem: () => {
        throw new Error('blocked');
      },
    }),
    defaultAppearance(),
  );
  const value = defaultAppearance();
  value.preset = 'custom';
  value.custom.dark.background = 'url(https://example.com)';
  assert.equal(validateAppearance(value), false);
  assert.ok(!JSON.stringify(themeTokens(value.custom.dark)).includes('url('));
  assert.throws(() =>
    saveAppearance(value, { setItem: () => assert.fail('invalid values must not be written') }),
  );
});
test('unreadable custom colors cannot be saved in either mode, including gradient endpoints', () => {
  for (const mode of ['dark', 'light'] as const) {
    const value = defaultAppearance();
    value.preset = 'custom';
    value.custom[mode].gradientEnd = value.custom[mode].text;
    assert.equal(validateAppearance(value), false);
    assert.match(paletteError(value.custom[mode])!, /contrast/);
  }
});
test('saved palettes round-trip separately from draft edits and errors are propagated', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const value = defaultAppearance();
  value.preset = 'nebula';
  value.mode = 'light';
  saveAppearance(value, storage);
  const draft = readAppearance(storage);
  draft.preset = 'ocean';
  assert.deepEqual(readAppearance(storage), value);
  saveAppearance(draft, storage);
  assert.equal(readAppearance(storage).preset, 'ocean');
  assert.throws(
    () =>
      saveAppearance(value, {
        setItem: () => {
          throw new Error('quota');
        },
      }),
    /quota/,
  );
});

test('custom gradients must also preserve contrast between their endpoints', () => {
  const p = {
    ...defaultAppearance().custom.dark,
    background: '#000000',
    surface: '#ffffff',
    text: '#767676',
    accent: '#767676',
    gradientEnd: '#ffffff',
  };
  assert.ok(contrast(p.text, p.background) >= 4.5 && contrast(p.text, p.gradientEnd) >= 4.5);
  assert.match(paletteError(p)!, /contrast/);
});
