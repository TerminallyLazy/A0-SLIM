// libfx 0.0.14 stream cancellation can race its asynchronous reader initialization.
// Keep the fix narrow, reproducible and fail closed when the pinned source changes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const file = path.join(path.dirname(require.resolve('libfx')), 'durable.js');
let source = fs.readFileSync(file, 'utf8');
const hash = crypto.createHash('sha256').update(source).digest('hex');
if (hash !== 'aa1c04105b0d698fdbdf162dab218c8d7f5b25a73ea057ffee493cfda89491af') {
  if (hash !== 'a5ac4a2ceb41284ca3e364c974daacac5ddba9c8b5bb07d9c1ca90f5a8901dec')
    throw new Error('libfx source changed; review the cancellation patch before installation.');
  source = source.replace(
    '          let reader = null;\n          let buffered = "";',
    '          let reader = null;\n          let cancelled = false; /* A0 SLIM: cancelled before stream reader opened */\n          let buffered = "";',
  );
  source = source.replace(
    '                reader = await open((await created.session(sessionId)).ui);',
    '                reader = await open((await created.session(sessionId)).ui);\n                if (cancelled) { await reader.cancel(); return; }',
  );
  source = source.replace(
    '            cancel() { void reader?.cancel().catch(() => {}); },',
    '            cancel() { cancelled = true; void reader?.cancel().catch(() => {}); },',
  );
  fs.writeFileSync(file, source);
  console.log('Applied libfx 0.0.14 stream cancellation patch.');
}
