export type Mode = 'dark' | 'light';
export type Palette = {
  background: string;
  surface: string;
  text: string;
  accent: string;
  secondary: string;
  tertiary: string;
  gradientEnd?: string;
};
export type Theme = { id: string; name: string; dark: Palette; light: Palette };
const palette = (
  background: string,
  surface: string,
  text: string,
  accent: string,
  secondary: string,
  tertiary: string,
  gradientEnd?: string,
): Palette => ({
  background,
  surface,
  text,
  accent,
  secondary,
  tertiary,
  ...(gradientEnd ? { gradientEnd } : {}),
});
export const themes: Theme[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    dark: palette('#151322', '#1d1a2d', '#f1edf9', '#b6a1f0', '#f68bc7', '#7e62dc'),
    light: palette('#f5f1fc', '#fffcff', '#292039', '#6842aa', '#b42b78', '#7554c5'),
  },
  {
    id: 'ocean',
    name: 'Ocean',
    dark: palette('#0c1e26', '#142b35', '#e5f3f7', '#69cce4', '#63e2cb', '#238bab'),
    light: palette('#edf8fa', '#faffff', '#17313b', '#086480', '#087b70', '#218aa6'),
  },
  {
    id: 'forest',
    name: 'Forest',
    dark: palette('#102019', '#1a2d22', '#e8f1e7', '#89cf9b', '#ffc16a', '#42895d'),
    light: palette('#f0f6ec', '#fcfff7', '#22321f', '#356a3c', '#99600f', '#447950'),
  },
  {
    id: 'sunset',
    name: 'Sunset',
    dark: palette('#281b1a', '#352523', '#fceee8', '#ffa878', '#f66b86', '#bd6651'),
    light: palette('#fff3ec', '#fffcf8', '#40271e', '#984419', '#b52e53', '#ad5440'),
  },
  {
    id: 'graphite',
    name: 'Graphite',
    dark: palette('#16191e', '#20252c', '#edf0f6', '#b2bdcf', '#96b7ff', '#5c7cb8'),
    light: palette('#f1f3f6', '#ffffff', '#252d39', '#4c5c74', '#3d64a2', '#6d7c93'),
  },
  {
    id: 'midnight',
    name: 'Midnight',
    dark: palette('#11182d', '#18213b', '#edf0ff', '#93b2ff', '#65d7ff', '#486fe0'),
    light: palette('#eff2fc', '#fbfcff', '#202d4b', '#3659ac', '#086d96', '#576acc'),
  },
  {
    id: 'sakura',
    name: 'Sakura',
    dark: palette('#281c24', '#372631', '#fff0f7', '#f5a6c4', '#ffbc89', '#c45b8a'),
    light: palette('#fff1f6', '#fffbfd', '#452636', '#9c3c68', '#9e531e', '#ad527a'),
  },
  {
    id: 'ember',
    name: 'Ember',
    dark: palette('#281910', '#38251a', '#fff0df', '#ff9d74', '#ffd17a', '#c85530'),
    light: palette('#fff4e9', '#fffdf8', '#43291b', '#9d431e', '#936115', '#b04d2d'),
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    dark: palette('#151515', '#242424', '#f5f5f5', '#c9c9c9', '#ffffff', '#808080'),
    light: palette('#f2f2f2', '#ffffff', '#222222', '#484848', '#676767', '#999999'),
  },
  {
    id: 'nebula',
    name: 'Nebula',
    dark: palette('#18112e', '#241c3b', '#f2ebff', '#b394ff', '#54dec7', '#8054dd', '#11283d'),
    light: palette('#f4edff', '#fffbff', '#30223f', '#7446ac', '#167b70', '#7d5eae', '#e5f3fb'),
  },
  {
    id: 'solar-flare',
    name: 'Solar Flare',
    dark: palette('#291809', '#382719', '#fff3e4', '#ffc164', '#ff8752', '#d47a20', '#4a1d18'),
    light: palette('#fff6df', '#fffdf5', '#422a16', '#8c510a', '#aa4426', '#b7771c', '#ffe6df'),
  },
  {
    id: 'synthwave',
    name: 'Synthwave',
    dark: palette('#1c1230', '#2a1d3d', '#faeeff', '#f38ada', '#49daeb', '#c252d8', '#3e153b'),
    light: palette('#f8edff', '#fffbff', '#382241', '#9d3085', '#06788b', '#a644ba', '#ffe6f4'),
  },
];
export type Appearance = {
  version: 1;
  preset: string;
  mode: Mode;
  density: 'comfortable' | 'compact';
  custom: Record<Mode, Palette>;
};
export const storageKey = 'slim.appearance';
export function defaultAppearance(): Appearance {
  const theme = themes.find((theme) => theme.id === 'graphite')!;
  return {
    version: 1,
    preset: theme.id,
    mode: 'dark',
    density: 'comfortable',
    custom: { dark: { ...theme.dark }, light: { ...theme.light } },
  };
}
export function selectedPalette(value: Appearance): Palette {
  return value.preset === 'custom'
    ? value.custom[value.mode]
    : themes.find((theme) => theme.id === value.preset)![value.mode];
}
export function themeName(value: Appearance): string {
  return value.preset === 'custom'
    ? 'Custom'
    : themes.find((theme) => theme.id === value.preset)!.name;
}
export const isColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const rgb = (color: string) =>
  [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
function luminance(color: string): number {
  const [r = 0, g = 0, b = 0] = rgb(color).map((part) => {
    const v = part / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [low, high] = [luminance(a), luminance(b)].sort((a, b) => a - b);
  return (high! + 0.05) / (low! + 0.05);
}
function mix(a: string, b: string, weight: number): string {
  const right = rgb(b);
  return (
    '#' +
    rgb(a)
      .map((part, i) =>
        Math.round(part * weight + right[i]! * (1 - weight))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
function backgrounds(p: Palette): string[] {
  return [
    p.background,
    p.surface,
    ...(p.gradientEnd
      ? Array.from({ length: 33 }, (_, i) => mix(p.background, p.gradientEnd!, i / 32))
      : []),
  ];
}
export function paletteError(p: Palette): string | undefined {
  if (
    ![
      p.background,
      p.surface,
      p.text,
      p.accent,
      p.secondary,
      p.tertiary,
      ...(p.gradientEnd === undefined ? [] : [p.gradientEnd]),
    ].every(isColor)
  )
    return 'Use six-digit hex colors, such as #93b2ff.';
  const surfaces = backgrounds(p);
  if (surfaces.some((bg) => contrast(p.text, bg) < 4.5))
    return 'Text needs more contrast against the background, surface, or gradient.';
  if (surfaces.some((bg) => contrast(p.accent, bg) < 4.5))
    return 'Accent needs more contrast so links and controls stay readable.';
}
export function validateAppearance(value: unknown): value is Appearance {
  if (!value || typeof value !== 'object') return false;
  const v = value as Appearance;
  return (
    v.version === 1 &&
    (v.preset === 'custom' || themes.some((theme) => theme.id === v.preset)) &&
    ['dark', 'light'].includes(v.mode) &&
    ['comfortable', 'compact'].includes(v.density) &&
    !!v.custom &&
    ['dark', 'light'].every((mode) => {
      const p = v.custom[mode as Mode];
      return p && !paletteError(p);
    })
  );
}
export function themeTokens(p: Palette): Record<string, string> {
  // Invalid drafts remain editable, but are never interpolated into CSS.
  if (
    ![
      p.background,
      p.surface,
      p.text,
      p.accent,
      p.secondary,
      p.tertiary,
      ...(p.gradientEnd === undefined ? [] : [p.gradientEnd]),
    ].every(isColor)
  )
    p = themes[0]!.dark;
  const onAccent =
    contrast('#ffffff', p.accent) > contrast('#000000', p.accent) ? '#ffffff' : '#000000';
  const readableSurface = (color: string) =>
    contrast(p.text, color) >= 4.5 && contrast(p.accent, color) >= 4.5 ? color : p.surface;
  const raised = readableSurface(mix(p.text, p.surface, 0.08));
  const soft = readableSurface(mix(p.accent, p.surface, 0.12));
  const muted = mix(p.text, p.surface, 0.74);
  const dangerCandidate = luminance(p.background) < 0.2 ? '#ffb4ad' : '#9d2822';
  const danger = backgrounds(p).every((bg) => contrast(dangerCandidate, bg) >= 4.5)
    ? dangerCandidate
    : p.text;
  const errorCandidate = mix('#a03028', p.surface, 0.15);
  return {
    '--bg': p.background,
    '--surface': p.surface,
    '--text': p.text,
    '--accent': p.accent,
    '--secondary': p.secondary,
    '--tertiary': p.tertiary,
    '--raised': raised,
    '--line': mix(p.text, p.surface, 0.22),
    '--muted': [...backgrounds(p), raised, soft].every((bg) => contrast(muted, bg) >= 4.5)
      ? muted
      : p.text,
    '--on-accent': onAccent,
    '--soft': soft,
    '--danger': danger,
    '--error-bg': contrast(danger, errorCandidate) >= 4.5 ? errorCandidate : p.surface,
    '--canvas': p.gradientEnd
      ? `linear-gradient(135deg in srgb, ${p.background}, ${p.gradientEnd})`
      : p.background,
  };
}
type StorageReader = Pick<Storage, 'getItem'>;
export function readAppearance(storage?: StorageReader): Appearance {
  try {
    const saved = storage?.getItem(storageKey);
    if (saved) {
      const value: unknown = JSON.parse(saved);
      if (validateAppearance(value)) return value;
    }
    const theme = storage?.getItem('slim.theme'),
      accent = storage?.getItem('slim.accent'),
      density = storage?.getItem('slim.density');
    const next = defaultAppearance();
    if (theme || accent || density) {
      // Preserve the earlier Graphite/Paper colors as an editable custom theme.
      next.preset = 'custom';
      next.mode = theme === 'paper' ? 'light' : 'dark';
      next.density = density === 'compact' ? 'compact' : 'comfortable';
      next.custom = {
        dark: palette(
          '#111513',
          '#191e1b',
          '#edf0e8',
          accent === 'sky' ? '#9ac9e4' : accent === 'clay' ? '#e5ad93' : '#b4d996',
          '#9ac9e4',
          '#e5ad93',
        ),
        light: palette(
          '#f4f3ec',
          '#fcfcf7',
          '#222b24',
          accent === 'sky' ? '#285a79' : accent === 'clay' ? '#914b2c' : '#375e27',
          '#285a79',
          '#914b2c',
        ),
      };
    }
    return next;
  } catch {
    return defaultAppearance();
  }
}
export function loadAppearance(): Appearance {
  try {
    return readAppearance(localStorage);
  } catch {
    return defaultAppearance();
  }
}
export function saveAppearance(value: Appearance, storage: Pick<Storage, 'setItem'>): void {
  if (!validateAppearance(value))
    throw new Error('Choose readable, valid theme colors before saving.');
  storage.setItem(storageKey, JSON.stringify(value));
}
export function applyAppearance(value: Appearance, element: HTMLElement): void {
  element.dataset.theme = value.mode === 'light' ? 'paper' : 'graphite';
  element.dataset.density = value.density;
  element.style.colorScheme = value.mode;
  for (const [name, color] of Object.entries(themeTokens(selectedPalette(value))))
    element.style.setProperty(name, color);
}
