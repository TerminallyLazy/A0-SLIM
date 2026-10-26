# Review artifact

`index.html` is a standalone interactive design preview and includes the complete revised spec and research audit. Its content is fictional and its controls never call a model or sandbox.

Edit `template.html` for presentation changes. After editing the canonical spec or audit, regenerate the HTML:

```sh
node scripts/render-review.cjs /path/to/ecc/scripts/lib/plan-canvas/markdown.js
```

The renderer is supplied by the user's installed ECC plan-canvas skill. It is a planning helper, not an application dependency. Mermaid loads from the skill's pinned CDN version; if unavailable, diagram source remains readable. All logo assets are local sibling files. No external fonts, analytics or runtime provider calls are used.

Open `index.html` directly in a browser, or use `ecc-plan-canvas open docs/review/index.html`. Keep `ecc-plan-canvas await docs/review/index.html` running during review. Only the human may submit the plan verdict.
