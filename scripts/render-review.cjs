// Planning artifact helper. Pass the ECC plan-canvas markdown renderer path.
// No runtime dependency on ECC is proposed for the A0 SLIM application.
const fs = require('node:fs');
const path = require('node:path');

if (!process.argv[2]) {
  console.error('Usage: node scripts/render-review.cjs <path-to-ecc/scripts/lib/plan-canvas/markdown.js>');
  process.exit(1);
}

const { renderMarkdown } = require(path.resolve(process.argv[2]));
const root = path.resolve(__dirname, '..');
const base = 'https://github.com/TerminallyLazy/A0-SLIM/blob/main/';
const render = file => renderMarkdown(fs.readFileSync(path.join(root, file), 'utf8'))
  .replace(/href="(?!https?:|#)([^"]+)"/g, (_, url) => `href="${base}${url}"`);
const template = fs.readFileSync(path.join(root, 'docs/review/template.html'), 'utf8');
const output = template
  .replace('{{SPEC}}', render('A0-SLIM-SPEC.md'))
  .replace('{{AUDIT}}', render('docs/research/SOURCE-AUDIT.md'));
fs.writeFileSync(path.join(root, 'docs/review/index.html'), output);
console.log('Updated docs/review/index.html from the current spec and source audit.');
