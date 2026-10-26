import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../ui/markdown.js';
import { Store } from '../src/storage/store.js';
import { environmentStatus } from '../src/execution/status.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('assistant Markdown renders GFM while rejecting active HTML, unsafe links and automatic image requests', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      text: 'The project is **Paper Garden**. `result.txt`\n\n- First\n- Second\n\n| Name | Value |\n| --- | --- |\n| Result | 42 |\n\n```js\nconst n = 42;\n```\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)\n\n![tracking](https://example.com/pixel)\n\n[Docs](https://example.com/docs)',
    }),
  );
  assert.match(html, /<strong>Paper Garden<\/strong>/);
  assert.match(html, /<code>result.txt<\/code>/);
  assert.match(html, /<table>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<pre><code class="language-js">/);
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<link rel="preload"'));
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotThrow(() =>
    renderToStaticMarkup(
      createElement(Markdown, { text: 'An incomplete **stream\n\n```ts\nconst x =' }),
    ),
  );
});
test('sandbox connection evidence stays distinct from live activity and becomes stale after credentials change', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-status-')),
    store = new Store(dir);
  try {
    assert.equal(environmentStatus(store, {}).vercel!.connection, 'not_configured');
    store.setMeta('sandbox:vercel', 'configured');
    store.setMeta('sandbox:vercel:revision', 'one');
    assert.equal(environmentStatus(store, {}).vercel!.connection, 'unchecked');
    store.receipt({
      id: 'check',
      kind: 'vercel-sandbox-proof',
      connectionRevision: 'one',
      status: 'passed',
      cleanup: 'deleted',
      finishedAt: '2026-10-26T16:00:00Z',
    });
    const verified = environmentStatus(store, {}).vercel!;
    assert.equal(verified.connection, 'passed');
    assert.equal(verified.activity, 'idle');
    store.setMeta('sandbox:vercel:revision', 'two');
    assert.equal(environmentStatus(store, {}).vercel!.connection, 'changed');
    store.receipt({
      id: 'next',
      kind: 'vercel-sandbox-proof',
      connectionRevision: 'two',
      status: 'pending',
      cleanup: 'unknown',
    });
    assert.equal(environmentStatus(store, { vercel: true }).vercel!.activity, 'working');
    assert.equal(
      environmentStatus(store, {}).vercel!.activity,
      'unknown',
      'restart never presents a pending receipt as active',
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
