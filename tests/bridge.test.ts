import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFxAgent } from 'libfx';
import { local } from 'libfx/durable-local';
import {
  CHATGPT_BRIDGE_URL,
  responsesFetch,
  readSse,
  toResponses,
} from '../src/providers/responses-bridge.js';

function sse(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}
const call = {
  type: 'response.output_item.added',
  item: {
    type: 'function_call',
    id: 'item1',
    call_id: 'call1',
    namespace: 'a0_slim',
    name: 'read_note',
    arguments: '',
  },
};
const args = { type: 'response.function_call_arguments.delta', item_id: 'item1', delta: '{}' };
const done = {
  type: 'response.completed',
  response: { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
};
test(
  'Responses bridge preserves tool identity through the real native loop',
  { timeout: 15_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slim-bridge-'));
    let toolCount = 0;
    const requests: any[] = [];
    const upstream: typeof fetch = async (url, init) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(
        (init!.headers as Record<string, string>).authorization,
        'Bearer synthetic-token',
      );
      const request = JSON.parse(String(init!.body));
      requests.push(request);
      if (requests.length === 1) return sse([call, args, done]);
      assert.ok(
        request.input.some(
          (item: any) =>
            item.type === 'function_call' &&
            item.call_id === 'call1' &&
            item.namespace === 'a0_slim',
        ),
      );
      assert.ok(
        request.input.some(
          (item: any) => item.type === 'function_call_output' && item.call_id === 'call1',
        ),
      );
      return sse([{ type: 'response.output_text.delta', delta: 'A complete answer.' }, done]);
    };
    const agent = createFxAgent({
      name: 'bridge-test',
      model: 'fixture',
      provider: {
        name: 'bridgefixture',
        baseUrl: CHATGPT_BRIDGE_URL,
        models: { fixture: { contextWindow: 8192, maxOutputTokens: 1024, supportsToolUse: true } },
      },
      fetch: responsesFetch(async () => 'synthetic-token', upstream),
      durability: local({ dir }),
      tools: [
        {
          name: 'read_note',
          description: 'Read a synthetic note.',
          inputSchema: { type: 'object', properties: {} },
          idempotent: true,
          writes: false,
          execute: () => {
            toolCount++;
            return 'synthetic note';
          },
        },
      ],
    });
    try {
      const result = await agent.session().prompt('Read the note.').result;
      assert.equal(result.stopReason, 'end_turn');
      assert.equal(toolCount, 1);
      assert.equal(requests.length, 2);
      assert.equal(requests[0].store, false);
      assert.equal(requests[0].stream, true);
      assert.equal(requests[0].max_tokens, undefined);
    } finally {
      await agent.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test(
  'late Responses failure never dispatches the partial function call',
  { timeout: 15_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slim-bridge-fail-'));
    let calls = 0;
    const agent = createFxAgent({
      name: 'failed-bridge-test',
      model: 'fixture',
      provider: {
        name: 'failedbridgefixture',
        baseUrl: CHATGPT_BRIDGE_URL,
        models: { fixture: { contextWindow: 8192, maxOutputTokens: 1024, supportsToolUse: true } },
      },
      fetch: responsesFetch(
        async () => 'synthetic',
        async () =>
          sse([
            call,
            args,
            {
              type: 'response.failed',
              response: { error: { message: 'SECRET-ERROR-MUST-NOT-LEAK' } },
            },
          ]),
      ),
      durability: local({ dir }),
      tools: [
        {
          name: 'read_note',
          description: 'Synthetic.',
          inputSchema: { type: 'object', properties: {} },
          idempotent: false,
          writes: true,
          execute: () => {
            calls++;
            return 'effect';
          },
        },
      ],
    });
    try {
      const result = await agent
        .session()
        .prompt('Read.')
        .result.catch((error) => error);
      assert.equal(calls, 0);
      assert.notEqual(result.stopReason, 'end_turn');
      assert.ok(!JSON.stringify(result).includes('SECRET-ERROR'));
    } finally {
      await agent.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test('bridge rejects unsupported reasoning and handles split UTF-8 SSE', async () => {
  const bytes = new TextEncoder().encode('data: {"type":"test","delta":"café 🌱"}\r\n\r\n');
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) controller.close();
      else controller.enqueue(bytes.slice(offset, ++offset));
    },
  });
  const parsed = [];
  for await (const event of readSse(body)) parsed.push(event);
  assert.equal(parsed[0]!.delta, 'café 🌱');
  const fetchBridge = responsesFetch(
    async () => 'synthetic',
    async () => sse([{ type: 'response.output_item.added', item: { type: 'reasoning' } }, done]),
  );
  const response = await fetchBridge(`${CHATGPT_BRIDGE_URL}/chat/completions`, {
    body: JSON.stringify({ model: 'fixture', messages: [] }),
  });
  await assert.rejects(response.text(), /reasoning-state/);
  assert.throws(
    () =>
      toResponses({ model: 'fixture', messages: [{ role: 'user', content: [{ type: 'image' }] }] }),
    /text input only/,
  );
});
