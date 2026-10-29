// Deliberately independent JSON-RPC peer: exercises the pinned SDK over real stdio.
import { createInterface } from 'node:readline';
import { join } from 'node:path';
const lines = createInterface({ input: process.stdin });
let cwd = '',
  pendingPrompt,
  requestId = 10000;
const callbacks = new Map();
const send = (value) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const result = (id, value) => send({ id, result: value });
const update = (value) =>
  send({ method: 'session/update', params: { sessionId: 'fixture-session', update: value } });
const text = (value) =>
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } });
const request = (method, params) =>
  new Promise((resolve) => {
    const id = requestId++;
    callbacks.set(id, resolve);
    send({ id, method, params: { sessionId: 'fixture-session', ...params } });
  });
for await (const line of lines) {
  const message = JSON.parse(line);
  if (!message.method) {
    callbacks.get(message.id)?.(message);
    callbacks.delete(message.id);
    continue;
  }
  const { id, method, params } = message;
  if (method === 'initialize')
    result(id, {
      protocolVersion: process.argv.includes('--bad-version') ? 999 : 1,
      agentInfo: process.argv.includes('--a0-snapshots')
        ? { name: 'agent-zero', version: process.argv.includes('--future') ? '2.15' : '2.14' }
        : { name: 'fixture', version: '1.0.0' },
      agentCapabilities: { loadSession: !process.argv.includes('--no-load') },
      authMethods: [],
    });
  if (method === 'session/new') {
    cwd = params.cwd;
    result(id, { sessionId: 'fixture-session' });
  }
  if (method === 'session/load') {
    cwd = params.cwd;
    text('REPLAY MUST NOT DUPLICATE');
    result(id, {});
  }
  if (method === 'session/cancel' && pendingPrompt && !process.argv.includes('--ignore-cancel')) {
    result(pendingPrompt, { stopReason: 'cancelled' });
    pendingPrompt = undefined;
  }
  if (method !== 'session/prompt') continue;
  const input = params.prompt[0].text;
  pendingPrompt = id;
  if (input === 'oversize') {
    process.stdout.write('x'.repeat(1024 * 1024 + 1));
    continue;
  }
  if (input === 'bad-json') {
    process.stdout.write('not json\n');
    continue;
  }
  if (input === 'crash') {
    process.exit(1);
  }
  if (input === 'wait') {
    text('Waiting');
    continue;
  }
  void (async () => {
    if (input === 'permission') {
      update({
        sessionUpdate: 'tool_call',
        toolCallId: 'call1',
        title: 'Inspect synthetic note',
        kind: 'read',
        status: 'pending',
      });
      const decision = await request('session/request_permission', {
        toolCall: {
          toolCallId: 'call1',
          title: 'Inspect synthetic note',
          rawInput: { path: 'note.txt' },
        },
        options: [
          { optionId: 'yes', name: 'Read note', kind: 'allow_once' },
          { optionId: 'no', name: 'Reject read', kind: 'reject_once' },
          { optionId: 'forever', name: 'Always allow', kind: 'allow_always' },
        ],
      });
      text(`Decision: ${decision.result?.outcome.optionId ?? 'cancelled'}`);
    } else if (input.startsWith('read:')) {
      const response = await request('fs/read_text_file', {
        path: join(cwd, input.slice(5)),
        line: 1,
        limit: 1,
      });
      text(response.error ? 'File denied' : response.result.content);
    } else if (input === 'write') {
      const response = await request('fs/write_text_file', {
        path: join(cwd, 'should-not-exist.txt'),
        content: 'no',
      });
      text(response.error ? 'Write denied' : 'UNEXPECTED WRITE');
    } else if (input === 'snapshots') {
      text('Hel');
      text('Hello');
      text('Hi, corrected.');
    } else {
      text('**Paper Garden** has `three` leaves.');
    }
    if (pendingPrompt === id) {
      result(id, { stopReason: 'end_turn' });
      pendingPrompt = undefined;
    }
  })();
}
