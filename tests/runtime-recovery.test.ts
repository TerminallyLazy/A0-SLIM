import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopInterruptedTurn } from '../src/runtime/recovery.js';

test('interrupted-turn cleanup requires the exact terminal event and closes its reader', async () => {
  let stream!: ReadableStreamDefaultController<Uint8Array>,
    closed = false;
  const encode = (event: unknown) => new TextEncoder().encode(JSON.stringify(event) + '\n');
  const session = {
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          stream = c;
        },
        cancel() {
          closed = true;
        },
      }),
    cancel: async () => {
      stream.enqueue(
        encode({ type: 'turn_end', messageId: 'another-turn', stopReason: 'end_turn' }),
      );
      const end = encode({ type: 'turn_end', messageId: 'owned-turn', stopReason: 'cancelled' });
      stream.enqueue(end.slice(0, 11));
      stream.enqueue(end.slice(11));
    },
  };
  assert.equal(
    await stopInterruptedTurn(session, 'owned-turn', new AbortController().signal, 1000),
    true,
  );
  assert.equal(closed, true);
});

test('missing or unknown terminal evidence and cancellation never report a confirmed stop', async () => {
  for (const mode of ['missing', 'unknown', 'aborted'] as const) {
    let closed = false;
    const abort = new AbortController();
    const session = {
      stream: () =>
        new ReadableStream<Uint8Array>({
          start(c) {
            if (mode === 'unknown')
              c.enqueue(
                new TextEncoder().encode(
                  JSON.stringify({
                    type: 'turn_end',
                    messageId: 'owned-turn',
                    stopReason: 'unknown',
                  }) + '\n',
                ),
              );
          },
          cancel() {
            closed = true;
          },
        }),
      cancel: async () => {
        if (mode === 'aborted') abort.abort();
      },
    };
    assert.equal(await stopInterruptedTurn(session, 'owned-turn', abort.signal, 20), false, mode);
    assert.equal(closed, true, mode);
  }
});
