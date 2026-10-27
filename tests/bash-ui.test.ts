import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BashOutput } from '../ui/bash-output.js';
test('Bash UI resolves truncated runtime previews to full local receipts and escapes shell output', () => {
  const id = '12345678-1234-4234-8234-123456789012';
  const html = renderToStaticMarkup(
    createElement(BashOutput, {
      text: `{"receiptId":"${id}","status":"passed","stdout":"truncated`,
      receipts: [
        {
          id,
          target: 'sandbox',
          status: 'passed',
          exitCode: 0,
          stdout: '<script>alert(1)</script>\n'.repeat(100),
          stderr: 'diagnostic',
        },
      ],
    }),
  );
  assert.ok(html.includes('Bash · sandbox · passed'));
  assert.ok(html.includes('diagnostic'));
  assert.equal(html.match(/&lt;script&gt;/g)?.length, 100);
  assert.ok(!html.includes('<script>'));
  assert.ok(
    renderToStaticMarkup(
      createElement(BashOutput, { text: `{"receiptId":"${id}"`, receipts: [] }),
    ).includes('Loading Bash output'),
  );
});
