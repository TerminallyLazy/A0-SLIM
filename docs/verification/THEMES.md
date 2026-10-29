# Appearance acceptance — alpha.3

The twelve reference themes are implemented with dark and light variants: Aurora, Ocean, Forest, Sunset, Graphite, Midnight, Sakura, Ember, Monochrome, Nebula, Solar Flare and Synthwave. The last three include background gradients. Custom palettes have separate dark/light colors, optional gradients and comfortable/compact spacing. Draft changes stay inside the preview until Save; Reset restores the saved preferences.

Verified in Chrome against the production build in a disposable local workspace:

- All twelve presets appear in the gallery. Midnight changes the preview while the application retains the previous accent; Save updates the application.
- Light-mode and preset edits are discarded by Reset.
- Custom accent/gradient changes and compact spacing persist across reload. The actual workspace renders the saved gradient. Switching to Light preserves the independent dark palette.
- An unreadable gradient displays a contrast error and disables Save. Valid replacement colors allow saving.
- Custom light colors and Save work at narrow widths. The settings panel has no horizontal overflow at 433 and 320 CSS-pixel widths; temporary viewport overrides were reset.
- Existing Graphite/Paper, sage/sky/clay and density preferences migrate to custom palettes.

Six regression tests cover all 24 preset variants, foreground/control contrast, legacy migration, malformed/storage-unavailable fallback, CSS-value rejection, gradient-interior contrast and saved-versus-draft isolation. The complete Node 24 check passed 196 tests, typecheck and production build. Root, embedding and Microsandbox audits report zero vulnerabilities.

The preview is illustrative. These checks do not use live models or cloud compute. Browser preferences are local to the browser and origin; theme JSON import/export, system appearance following and custom CSS are not included.
