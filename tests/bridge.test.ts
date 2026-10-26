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
const reasoning = {
  type: 'reasoning',
  id: 'reason1',
  summary: [],
  encrypted_content: 'synthetic-encrypted-state',
};
const done = (output: unknown[]) => ({
  type: 'response.completed',
  response: {
    status: 'completed',
    output,
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  },
});
const message = (text: string) => ({
  type: 'message',
  id: 'msg1',
  role: 'assistant',
  phase: 'final_answer',
  content: [{ type: 'output_text', text, annotations: [] }],
});
const completeCall = { ...call.item, arguments: '{}' };
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
      if (requests.length === 1)
        return sse([
          { ...call, output_index: 1 },
          args,
          { type: 'response.output_item.done', output_index: 0, item: reasoning },
          { type: 'response.output_item.done', output_index: 1, item: completeCall },
          done([]),
        ]);
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
      assert.deepEqual(
        request.input.find((item: any) => item.type === 'reasoning'),
        reasoning,
      );
      return sse([
        { type: 'response.output_text.delta', delta: 'A complete answer.' },
        done([message('A complete answer.')]),
      ]);
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
    let notice = '';
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
            { type: 'response.output_item.done', output_index: 0, item: completeCall },
            {
              type: 'response.failed',
              response: {
                error: {
                  code: 'subscription_sharing_usage_limit_exceeded',
                  message: 'SECRET-ERROR-MUST-NOT-LEAK',
                },
              },
            },
          ]),
        undefined,
        (_init, message) => {
          notice = message;
        },
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
      assert.match(notice, /plan usage is currently unavailable or limited/);
    } finally {
      await agent.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test('bridge rejects missing encrypted reasoning and handles split UTF-8 SSE', async () => {
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
    async () => sse([done([{ type: 'reasoning', id: 'reason1', summary: [] }])]),
  );
  const response = await fetchBridge(`${CHATGPT_BRIDGE_URL}/chat/completions`, {
    body: JSON.stringify({ model: 'fixture', messages: [] }),
  });
  await assert.rejects(response.text(), /encrypted reasoning/);
  assert.throws(
    () =>
      toResponses({ model: 'fixture', messages: [{ role: 'user', content: [{ type: 'image' }] }] }),
    /text input only/,
  );
});

test('encrypted protocol journal survives reopen, scopes accounts, caches completion, and refuses changed history', async () => {
  const { Store } = await import('../src/storage/store.js');
  const { Vault } = await import('../src/providers/vault.js');
  const { ResponseReplay, replayKey } = await import('../src/providers/replay.js');
  const dir = await mkdtemp(join(tmpdir(), 'slim-replay-'));
  let store = new Store(dir);
  const key = replayKey(
    { connectionId: 'connection', subject: 'account-a', clientId: 'client-a' },
    'session-a',
    'fixture',
  );
  let vault = new Vault(store, async () => Buffer.alloc(32, 4));
  let requests = 0;
  const request = { model: 'fixture', messages: [{ role: 'user', content: 'Read.' }] };
  const upstream: typeof fetch = async () => {
    requests++;
    return sse([done([reasoning, message('Saved.')])]);
  };
  let bridge = responsesFetch(
    async () => 'synthetic',
    upstream,
    () => new ResponseReplay(vault, key),
  );
  try {
    await (
      await bridge(`${CHATGPT_BRIDGE_URL}/chat/completions`, { body: JSON.stringify(request) })
    ).text();
    const ciphertext = store.db.prepare('SELECT ciphertext FROM vault WHERE id=?').get(key) as {
      ciphertext: string;
    };
    assert.ok(!ciphertext.ciphertext.includes(reasoning.encrypted_content));
    store.close();
    store = new Store(dir);
    vault = new Vault(store, async () => Buffer.alloc(32, 4));
    bridge = responsesFetch(
      async () => 'synthetic',
      upstream,
      () => new ResponseReplay(vault, key),
    );
    const cached = await (
      await bridge(`${CHATGPT_BRIDGE_URL}/chat/completions`, { body: JSON.stringify(request) })
    ).text();
    assert.match(cached, /Saved/);
    assert.equal(requests, 1);
    const history = toResponses({
      model: 'fixture',
      messages: [
        ...request.messages,
        { role: 'assistant', content: 'Saved.' },
        { role: 'user', content: 'Continue.' },
      ],
    });
    const expanded = await new ResponseReplay(vault, key).prepare(history);
    assert.deepEqual(expanded.input.slice(1, 3), [reasoning, message('Saved.')]);
    await assert.rejects(
      new ResponseReplay(
        vault,
        replayKey(
          { connectionId: 'connection', subject: 'account-b', clientId: 'client-a' },
          'session-a',
          'fixture',
        ),
      ).prepare(history),
      /history changed/,
    );
    await assert.rejects(
      new ResponseReplay(vault, key).prepare({ ...history, input: history.input.slice(1) }),
      /history changed/,
    );
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  'native credential callback provides the session routing identity without forwarding it upstream',
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slim-routing-'));
    const { ResponseReplay } = await import('../src/providers/replay.js');
    const routed = new Set<string>(),
      journals = new Map<string, InstanceType<typeof ResponseReplay>>();
    const agent = createFxAgent({
      name: 'routing-proof',
      model: 'fixture',
      durability: local({ dir }),
      provider: {
        name: 'routingfixture',
        baseUrl: CHATGPT_BRIDGE_URL,
        models: { fixture: { contextWindow: 8192, maxOutputTokens: 1024, supportsToolUse: true } },
      },
      credentials: async ({ sessionId }: { sessionId?: string }) => {
        assert.ok(sessionId);
        return { apiKey: `slim-session.${sessionId}` };
      },
      fetch: responsesFetch(
        async () => 'real-boundary-token',
        async (_url, init) => {
          assert.equal(
            new Headers(init!.headers).get('authorization'),
            'Bearer real-boundary-token',
          );
          return sse([done([reasoning, message('Scoped.')])]);
        },
        (init) => {
          const marker = new Headers(init.headers).get('authorization')!;
          assert.match(marker, /^Bearer slim-session.wrun_/);
          routed.add(marker);
          if (!journals.has(marker)) journals.set(marker, new ResponseReplay());
          return journals.get(marker)!;
        },
      ),
    });
    try {
      const a = agent.session(),
        b = agent.session();
      const outcomes = await Promise.all([
        a.prompt('First account chat.').result,
        b.prompt('Other account chat.').result,
      ]);
      assert.ok(outcomes.every((r) => r.stopReason === 'end_turn'));
      assert.equal(routed.size, 2);
      assert.equal((await a.prompt('Continue.').result).stopReason, 'end_turn');
    } finally {
      await agent.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'native restart preserves the provider replay mapping for formatted function arguments',
  { timeout: 15000 },
  async () => {
    const { Store } = await import('../src/storage/store.js'),
      { Vault } = await import('../src/providers/vault.js'),
      { ResponseReplay } = await import('../src/providers/replay.js');
    const dir = await mkdtemp(join(tmpdir(), 'slim-restart-')),
      store = new Store(join(dir, 'data')),
      vault = new Vault(store, async () => Buffer.alloc(32, 2));
    let requests = 0;
    const outputCall = {
      ...completeCall,
      name: 'read_file',
      arguments: '{\n  "path": "note.txt"\n}',
    };
    const responseText =
      'Proposed `result.txt` with one line:\n\n```text\nPaper Garden\n```\n\nThe artifact awaits review.';
    const create = () =>
      createFxAgent({
        name: 'restart-bridge',
        model: 'fixture',
        provider: {
          name: 'restartfixture',
          baseUrl: CHATGPT_BRIDGE_URL,
          models: {
            fixture: { contextWindow: 32768, maxOutputTokens: 8192, supportsToolUse: true },
          },
        },
        durability: local({ dir: join(dir, 'sessions') }),
        fetch: responsesFetch(
          async () => 'synthetic',
          async (_url, init) => {
            requests++;
            const body = JSON.parse(String(init!.body));
            assert.equal(body.supplemental, undefined);
            if (requests >= 4) {
              assert.ok(
                body.input.some(
                  (i: any) =>
                    i.role === 'user' && i.content[0].text.startsWith('Session file evidence'),
                ),
              );
              assert.equal(body.input.at(-1).role, 'user');
              assert.ok(body.input.some((i: any) => i.type === 'reasoning'));
            }
            return sse([
              done(
                requests === 1
                  ? [reasoning, outputCall]
                  : requests === 2
                    ? [{ ...outputCall, call_id: 'call2', arguments: '{"path":"result.txt"}' }]
                    : [message(responseText)],
              ),
            ]);
          },
          () => new ResponseReplay(vault, 'test-replay'),
        ),
        tools: [
          {
            name: 'read_file',
            description: 'Synthetic read',
            idempotent: true,
            writes: false,
            inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
            execute: () => ({ text: 'Paper Garden', other: 'value' }),
          },
        ],
      });
    let agent = create();
    try {
      const session = agent.session();
      const turn = session.prompt('Read the note.');
      const accepted = await turn.accepted;
      assert.equal((await turn.result).stopReason, 'end_turn');
      await agent.close();
      agent = create();
      const result = await agent
        .session(accepted.sessionId)
        .prompt('Continue from the saved conversation.').result;
      assert.equal(result.stopReason, 'end_turn', JSON.stringify(result));
      assert.equal(
        (await agent.session(accepted.sessionId).prompt('Continue again.').result).stopReason,
        'end_turn',
      );
    } finally {
      await agent.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test('only matching native file-evidence notes become supplemental user context', () => {
  const header =
    'Session file evidence from previous tool execution. Re-read stale paths before relying on exact contents:';
  const messages = [
    { role: 'user', content: 'Read a file.' },
    {
      role: 'assistant',
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"note.txt"}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'synthetic' },
    {
      role: 'user',
      content: header + '\n- action=read status=success path=note.txt tool=read_file',
    },
    { role: 'assistant', content: 'Read.' },
    { role: 'user', content: 'Continue.' },
  ];
  const good = toResponses({ model: 'fixture', messages });
  assert.equal(good.supplemental.length, 1);
  assert.equal(good.supplemental[0]!.role, 'user');
  assert.ok(!good.instructions.includes(header));
  const changed = toResponses({
    model: 'fixture',
    messages: messages.map((m, i) =>
      i === 3
        ? { ...m, content: header + '\n- action=read status=success path=other.txt tool=read_file' }
        : m,
    ),
  });
  assert.equal(changed.supplemental.length, 0);
  assert.equal(changed.input.length, 6);
});
