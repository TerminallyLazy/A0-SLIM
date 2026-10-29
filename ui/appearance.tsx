import { Brand } from './brand.js';
import { useState, type CSSProperties } from 'react';
import { ArrowUp, Check, Moon, Sun } from 'lucide-react';
import {
  themes,
  selectedPalette,
  themeName,
  themeTokens,
  paletteError,
  isColor,
  type Appearance,
  type Mode,
  type Palette,
} from './theme.js';

export function AppearanceSettings({
  value,
  save,
}: {
  value: Appearance;
  save: (next: Appearance) => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(value));
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const palette = selectedPalette(draft);
  const error =
    draft.preset === 'custom'
      ? paletteError(draft.custom.dark) || paletteError(draft.custom.light)
      : undefined;
  const dirty = JSON.stringify(value) !== JSON.stringify(draft);
  function change(next: Appearance) {
    setDraft(next);
    setNotice('');
    setSaveError('');
  }
  function customize() {
    if (draft.preset === 'custom') return;
    const theme = themes.find((t) => t.id === draft.preset)!;
    change({
      ...draft,
      preset: 'custom',
      custom: { dark: { ...theme.dark }, light: { ...theme.light } },
    });
  }
  function color(key: keyof Palette, next: string | undefined) {
    change({ ...draft, custom: { ...draft.custom, [draft.mode]: { ...palette, [key]: next } } });
  }
  return (
    <section className="appearance-settings" aria-label="Appearance settings">
      <header className="section-heading">
        <h1>Appearance</h1>
        <p>Choose a theme or make it yours. Preview changes here, then Save to apply.</p>
      </header>
      <div className="theme-layout">
        <div className="theme-library">
          <div className="theme-presets" aria-label="Built-in themes">
            {themes.map((theme) => {
              const p = theme[draft.mode];
              return (
                <button
                  key={theme.id}
                  aria-pressed={draft.preset === theme.id}
                  className={`theme-card ${draft.preset === theme.id ? 'selected' : ''}`}
                  onClick={() => change({ ...draft, preset: theme.id })}
                >
                  <span
                    className="theme-strip"
                    style={{
                      background: p.gradientEnd
                        ? `linear-gradient(110deg, ${p.background}, ${p.gradientEnd})`
                        : p.background,
                    }}
                    aria-hidden="true"
                  >
                    {[p.background, p.accent, p.secondary, p.tertiary].map((c, i) => (
                      <i key={i} style={{ background: c }} />
                    ))}
                  </span>
                  <span>
                    {theme.name}
                    {draft.preset === theme.id && <Check size={13} aria-hidden="true" />}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            className={`customize-theme ${draft.preset === 'custom' ? 'selected' : ''}`}
            aria-pressed={draft.preset === 'custom'}
            onClick={customize}
          >
            Custom colors
          </button>
        </div>
        <div className="theme-detail">
          <div className="theme-preview-toolbar">
            <h2>{themeName(draft)}</h2>
            <div className="segmented" aria-label="Preview appearance">
              {(['dark', 'light'] as Mode[]).map((mode) => (
                <button
                  key={mode}
                  aria-pressed={draft.mode === mode}
                  className={draft.mode === mode ? 'selected' : ''}
                  onClick={() => change({ ...draft, mode })}
                >
                  {mode === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
                  {mode === 'dark' ? 'Dark' : 'Light'}
                </button>
              ))}
            </div>
          </div>
          <div
            className={`theme-preview ${draft.density}`}
            style={themeTokens(palette) as CSSProperties}
            role="img"
            aria-label={`${themeName(draft)} ${draft.mode} theme preview`}
          >
            <div className="preview-sidebar">
              <div className="preview-brand">
                <Brand />
              </div>
              <div className="preview-new">+ New chat</div>
              <div className="preview-line" />
              <div className="preview-nav active">Project notes</div>
              <div className="preview-nav">Research</div>
              <div className="preview-nav">My workspace</div>
              <div className="preview-nav">Connections</div>
              <div className="preview-nav">Appearance</div>
              <div className="preview-footer">
                <div className="preview-line" />
                <div className="preview-line" />
              </div>
            </div>
            <div className="preview-content">
              <div className="preview-status">
                <i /> Ready
              </div>
              <div className="preview-greeting">What are we working on?</div>
              <div className="preview-subtitle">A little space for your next idea.</div>
              <div className="preview-composer">
                Message your agent{' '}
                <span>
                  <ArrowUp size={14} />
                </span>
              </div>
              <div className="preview-cards">
                {['Explore', 'Create', 'Organize'].map((text, i) => (
                  <div key={text}>
                    <i
                      style={{
                        background: ['var(--accent)', 'var(--secondary)', 'var(--tertiary)'][i],
                      }}
                    />
                    <strong>{text}</strong>
                    <div className="preview-line" />
                  </div>
                ))}
              </div>
            </div>
          </div>
          {draft.preset === 'custom' && (
            <div className="theme-custom-colors">
              {(
                [
                  ['background', 'Background'],
                  ['surface', 'Surface'],
                  ['text', 'Text'],
                  ['accent', 'Accent'],
                  ['secondary', 'Secondary'],
                  ['tertiary', 'Third color'],
                ] as const
              ).map(([key, label]) => (
                <ColorField
                  key={key}
                  label={label}
                  value={palette[key]}
                  change={(next) => color(key, next)}
                />
              ))}
              <label className="theme-gradient-toggle">
                <input
                  type="checkbox"
                  checked={palette.gradientEnd !== undefined}
                  onChange={(event) =>
                    color('gradientEnd', event.target.checked ? palette.background : undefined)
                  }
                />
                Background gradient
              </label>
              {palette.gradientEnd !== undefined && (
                <ColorField
                  label="Gradient end"
                  value={palette.gradientEnd}
                  change={(next) => color('gradientEnd', next)}
                />
              )}
            </div>
          )}
          <div className="theme-density">
            <span>Spacing</span>
            <div className="segmented">
              {(['comfortable', 'compact'] as const).map((density) => (
                <button
                  key={density}
                  aria-pressed={draft.density === density}
                  className={draft.density === density ? 'selected' : ''}
                  onClick={() => change({ ...draft, density })}
                >
                  {density === 'compact' ? 'Compact' : 'Comfortable'}
                </button>
              ))}
            </div>
          </div>
          {error && (
            <p className="theme-error" role="alert">
              {error} Check both Dark and Light colors.
            </p>
          )}
          {saveError && (
            <p className="theme-error" role="alert">
              {saveError}
            </p>
          )}
          <div className="theme-actions">
            <span role="status">{notice || (dirty ? 'Unsaved changes' : '')}</span>
            <button disabled={!dirty} onClick={() => change(structuredClone(value))}>
              Reset
            </button>
            <button
              className="primary"
              disabled={!dirty || !!error}
              onClick={() => {
                try {
                  save(draft);
                  setNotice('Saved');
                  setSaveError('');
                } catch {
                  setSaveError(
                    'Could not save in this browser. Allow local storage and try again.',
                  );
                }
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
function ColorField({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
}) {
  return (
    <label className="theme-color-field">
      {label}
      <span>
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={isColor(value) ? value : '#000000'}
          onChange={(event) => change(event.target.value)}
        />
        <input
          aria-label={`${label} hex`}
          value={value}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => change(event.target.value)}
        />
      </span>
    </label>
  );
}
