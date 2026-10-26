# Third-party notices

## Agent Zero

Reference repository: https://github.com/agent0ai/agent-zero

Reference checkout revision: `ff2a5b9c9c4e490ba38dd7c313e779510bb2071a`.

The two SVG symbols in `docs/review/assets/` and `ui/public/` were copied unchanged from `docs/res/a0-vector-graphics/darkSymbol.svg` and `lightSymbol.svg`. Their SHA-256 hashes are recorded in the source audit. The upstream MIT license and copyright notice are retained in [docs/licenses/Agent-Zero-MIT.txt](docs/licenses/Agent-Zero-MIT.txt). The preserved preliminary spec contains user-supplied Agent Zero source excerpts.

Brand names and logos identify their respective projects. This project does not claim upstream endorsement. Confirm any separate brand-use requirements before a public product launch.

## libfx

Pinned runtime dependency: `libfx@0.0.14`, from https://github.com/vercel-labs/fx, Apache-2.0. The npm package supplies its native binaries, WASM and source; these are not checked into this repository. `scripts/patch-libfx.cjs` applies a narrow stream-cancellation fix to the pinned package during installation. Its source hashes and rationale are documented in `docs/verification/P0.md`. Preserve applicable dependency notices when distributing the application.

Other dependency versions and resolved integrity values are pinned in `package-lock.json`; their licenses remain in the installed packages.
