import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ACPClient } from '../src/acp/client.js';
import { Store } from '../src/storage/store.js';
import { createApp } from '../src/server/app.js';

const executable = process.execPath;
const fixture = fileURLToPath(new URL('./helpers/acp-agent.mjs', import.meta.url));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  for (let i = 0; i < 250; i++) {
    if (check()) return;
    await sleep(10);
  }
  assert.fail('Timed out');
}
async function setup(flags: string[] = []) {
  const dir = await mkdtemp(join(tmpdir(), 'slim-acp-'));
  const project = await realpath(await mkdtemp(join(tmpdir(), 'slim-acp-project-')));
  const store = new Store(dir),
    acp = new ACPClient(store, 100);
  const profile = await acp.add({
    name: 'Fixture',
    command: executable,
    args: [fixture, ...flags],
    acknowledgeHostAccess: true,
    readProjectFiles: true,
  });
  const projectId = randomUUID(),
    chatId = randomUUID();
  store.saveProject({ id: projectId, name: 'Fixture', root: project });
  store.saveChat({
    id: chatId,
    projectId,
    title: 'ACP fixture',
    connectionId: profile.id,
    backend: 'acp',
    model: profile.name,
    sessionId: null,
    status: 'idle',
    createdAt: new Date().toISOString(),
  });
  const events = () =>
    store.records<{ type: string; delta?: string }>(`acp-events:${chatId}`).reverse();
  const prompt = async (text: string) => {
    acp.prompt(chatId, text, randomUUID());
    await until(() => store.chat(chatId).status !== 'running');
  };
  const cleanup = async () => {
    await acp.close();
    store.close();
    await rm(dir, { recursive: true, force: true });
    await rm(project, { recursive: true, force: true });
  };
  return { dir, project, store, acp, profile, chatId, events, prompt, cleanup };
}
test('ACP stdio initialization, persistent session, prompt deduplication and read-only replay', async () => {
  const f = await setup();
  try {
    const info = await f.acp.check(f.profile.id);
    assert.equal(info.agentInfo?.name, 'fixture');
    assert.equal(f.store.chat(f.chatId).sessionId, null);
    const messageId = randomUUID();
    f.acp.prompt(f.chatId, 'hello', messageId);
    assert.equal(f.acp.prompt(f.chatId, 'hello', messageId).duplicate, true);
    assert.throws(() => f.acp.prompt(f.chatId, 'changed', messageId), /another request/);
    await until(() => f.store.chat(f.chatId).status === 'idle');
    assert.equal(f.store.chat(f.chatId).sessionId, 'fixture-session');
    assert.equal(f.events().filter((e) => e.type === 'turn_start').length, 1);
    await f.acp.close();
    const restored = new ACPClient(f.store);
    const reader = restored.stream(f.chatId, 0).getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /turn_start/);
    assert.deepEqual(restored.state().connected, []);
    await reader.cancel();
    restored.prompt(f.chatId, 'next', randomUUID());
    await until(() => f.store.chat(f.chatId).status === 'idle');
    assert.equal(
      f.events().some((e) => e.delta?.includes('REPLAY')),
      false,
    );
    assert.equal(f.events().filter((e) => e.type === 'turn_start').length, 2);
    await restored.close();
  } finally {
    await f.cleanup();
  }
});
test('ACP grants only exact pending one-time permissions; denial and Stop resolve the request', async () => {
  const f = await setup();
  try {
    f.acp.prompt(f.chatId, 'permission', randomUUID());
    await until(() => f.acp.pending().length === 1);
    const first = f.acp.pending()[0]!;
    assert.deepEqual(
      first.options.map((o) => o.optionId),
      ['yes', 'no'],
    );
    assert.throws(() => f.acp.decide(first.id, 'forever'));
    f.acp.decide(first.id, 'no');
    const receipt = f.store
      .records<{ id: string; digest: string; turnId: string; outcome: { optionId: string } }>(
        'acp-permission',
      )
      .find((p) => p.id === first.id)!;
    assert.equal(receipt.outcome.optionId, 'no');
    assert.equal(receipt.digest.length, 64);
    assert.ok(receipt.turnId);
    assert.throws(() => f.acp.decide(first.id, 'yes'));
    await until(() => f.store.chat(f.chatId).status === 'idle');
    assert.ok(f.events().some((e) => e.delta === 'Decision: no'));
    f.acp.prompt(f.chatId, 'permission', randomUUID());
    await until(() => f.acp.pending().length === 1);
    await f.acp.cancel(f.chatId);
    assert.equal(f.acp.pending().length, 0);
    assert.equal(f.acp.state().holds.length, 0);
  } finally {
    await f.cleanup();
  }
});
test('ACP client filesystem enforces the project boundary, sensitive paths and symlinks; writes unsupported', async () => {
  const f = await setup();
  try {
    await writeFile(join(f.project, 'note.txt'), 'Public note\nsecond line');
    await writeFile(join(f.project, '.env'), 'do not expose');
    await symlink(join(f.project, 'note.txt'), join(f.project, 'link.txt'));
    await f.prompt('read:note.txt');
    assert.ok(f.events().some((e) => e.delta === 'Public note'));
    for (const path of ['.env', '../outside', 'link.txt']) await f.prompt(`read:${path}`);
    assert.equal(f.events().filter((e) => e.delta === 'File denied').length, 3);
    await f.prompt('write');
    assert.ok(f.events().some((e) => e.delta === 'Write denied'));
  } finally {
    await f.cleanup();
  }
});
test('ACP disconnected turns remain unknown across restart and cannot replay or bypass via another chat', async () => {
  const f = await setup();
  try {
    await f.prompt('crash');
    assert.equal(f.acp.state().holds.length, 1);
    assert.throws(() => f.acp.prompt(f.chatId, 'retry', randomUUID()), /unknown/);
    await f.acp.close();
    const restored = new ACPClient(f.store);
    assert.equal(restored.state().holds.length, 1);
    assert.throws(() => restored.resume(), /never resends/);
    const hold = restored.state().holds[0]!;
    restored.review(hold.id, 'Fixture process exited; no external work remains.');
    assert.equal(restored.state().holds.length, 0);
    assert.equal(restored.turns().find((t) => t.id === hold.id)?.status, 'reviewed');
    restored.prompt(f.chatId, 'safe new request', randomUUID());
    await until(() => f.store.chat(f.chatId).status === 'idle');
    await restored.close();
  } finally {
    await f.cleanup();
  }
});
test('ACP Stop waits for the terminal response; unconfirmed cancellation retains a hold', async () => {
  for (const flags of [[], ['--ignore-cancel']]) {
    const f = await setup(flags);
    try {
      f.acp.prompt(f.chatId, 'wait', randomUUID());
      await until(() => f.events().some((e) => e.delta === 'Waiting'));
      if (flags.length) {
        await assert.rejects(f.acp.cancel(f.chatId), /not confirmed/);
        assert.equal(f.acp.state().holds.length, 1);
      } else {
        await f.acp.cancel(f.chatId);
        assert.equal(f.store.chat(f.chatId).status, 'idle');
        assert.equal(f.acp.state().holds.length, 0);
      }
    } finally {
      await f.cleanup();
    }
  }
});
test('ACP rejects unsupported protocol versions and never silently replaces an unloadable session', async () => {
  const bad = await setup(['--bad-version']);
  try {
    await assert.rejects(bad.acp.check(bad.profile.id), /connection failed/);
  } finally {
    await bad.cleanup();
  }
  const f = await setup(['--no-load']);
  try {
    await f.prompt('hello');
    await f.acp.close();
    const restored = new ACPClient(f.store);
    restored.prompt(f.chatId, 'next', randomUUID());
    await until(() => f.store.chat(f.chatId).status === 'idle');
    assert.equal(f.store.chat(f.chatId).sessionId, 'fixture-session');
    assert.equal(restored.turns()[0]?.stopReason, 'not_sent');
    assert.equal(f.events().filter((e) => e.type === 'text_delta').length, 1);
    await restored.close();
  } finally {
    await f.cleanup();
  }
});
test('ACP routes require pairing and origin; native connections remain separate', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-acp-api-'));
  const { app } = await createApp({
    dataDir: dir,
    origin: 'http://127.0.0.1:4310',
    pairingCode: 'fixture-code',
    keySource: async () => Buffer.alloc(32, 4),
  });
  const headers = { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4310' };
  try {
    assert.equal(
      (await app.inject({ method: 'POST', url: '/api/v1/agents', headers, payload: {} }))
        .statusCode,
      401,
    );
    const pair = await app.inject({
      method: 'POST',
      url: '/api/v1/pair',
      headers,
      payload: { code: 'fixture-code' },
    });
    const cookie = pair.cookies[0]!.name + '=' + pair.cookies[0]!.value;
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { ...headers, cookie, origin: 'https://evil.example' },
      payload: {},
    });
    assert.equal(denied.statusCode, 403);
    const result = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { ...headers, cookie },
      payload: {
        name: 'Fixture',
        command: executable,
        args: [fixture],
        acknowledgeHostAccess: true,
      },
    });
    assert.equal(result.statusCode, 200);
    const state = (
      await app.inject({ url: '/api/v1/state', headers: { ...headers, cookie } })
    ).json();
    assert.equal(state.acp.profiles.length, 1);
    assert.deepEqual(state.connections, []);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('ACP Stop during startup prevents prompt dispatch; disabling and unsupported frames fail safely', async () => {
  const f = await setup();
  try {
    f.acp.prompt(f.chatId, 'hello', randomUUID());
    await f.acp.cancel(f.chatId);
    assert.equal(f.acp.turns()[0]?.stopReason, 'not_sent');
    assert.equal(f.store.chat(f.chatId).sessionId, null);
    await f.acp.disable(f.profile.id, true);
    assert.throws(() => f.acp.prompt(f.chatId, 'hello', randomUUID()), /Enable/);
    await f.acp.disable(f.profile.id, false);
    for (const input of ['oversize', 'bad-json']) {
      await f.prompt(input);
      assert.equal(f.acp.state().holds.length, 1);
      f.acp.review(
        f.acp.state().holds[0]!.id,
        'Synthetic process exited; no external work exists.',
      );
    }
  } finally {
    await f.cleanup();
  }
});

test('ACP service restart preserves unfinished intent as a hold across profiles', async () => {
  const f = await setup();
  try {
    await f.acp.close();
    const id = randomUUID();
    f.store.record('acp-turn', { id, chatId: f.chatId, inputHash: 'fixture', status: 'running' });
    f.store.saveChat({ ...f.store.chat(f.chatId), status: 'running' });
    f.store.close();
    const reopened = new Store(f.dir),
      client = new ACPClient(reopened);
    try {
      assert.equal(client.state().holds[0]?.id, id);
      assert.equal(reopened.chat(f.chatId).status, 'interrupted');
      assert.deepEqual(client.state().connected, []);
      const profile = await client.add({
        name: 'Duplicate endpoint',
        command: executable,
        args: [fixture],
        acknowledgeHostAccess: true,
      });
      const another = randomUUID();
      reopened.saveChat({
        ...reopened.chat(f.chatId),
        id: another,
        connectionId: profile.id,
        status: 'idle',
        sessionId: null,
      });
      assert.throws(() => client.prompt(another, 'new request', randomUUID()), /unknown/);
      assert.equal(client.pending().length, 0);
    } finally {
      await client.close();
      reopened.close();
    }
  } finally {
    await rm(f.dir, { recursive: true, force: true });
    await rm(f.project, { recursive: true, force: true });
  }
});

// Live Agent Zero CLI 2.14 emits full snapshots, including revisions, not deltas.
test('ACP snapshot compatibility is scoped to Agent Zero 2.14 and preserves raw update text', async () => {
  for (const flags of [[], ['--a0-snapshots'], ['--a0-snapshots', '--future']]) {
    const f = await setup(flags);
    try {
      await f.prompt('snapshots');
      const events = f.events().filter((e) => e.type.startsWith('text_'));
      assert.deepEqual(
        events.map((e) => e.delta),
        ['Hel', 'Hello', 'Hi, corrected.'],
      );
      const snapshot = flags.includes('--a0-snapshots') && !flags.includes('--future');
      assert.ok(events.every((e) => e.type === (snapshot ? 'text_snapshot' : 'text_delta')));
      await f.acp.close();
      const restored = new ACPClient(f.store);
      restored.prompt(f.chatId, 'snapshots', randomUUID());
      await until(() => f.store.chat(f.chatId).status === 'idle');
      assert.equal(f.events().filter((e) => e.delta === 'REPLAY MUST NOT DUPLICATE').length, 0);
      await restored.close();
    } finally {
      await f.cleanup();
    }
  }
});

test('Full Access automatically selects only the offered one-time ACP permission', async () => {
  const f = await setup();
  try {
    const project = f.store.project(f.store.chat(f.chatId).projectId);
    f.store.saveProject({ ...project, access: { mode: 'full', revision: randomUUID() } });
    await f.prompt('permission');
    assert.equal(f.acp.pending().length, 0);
    assert.ok(f.events().some((e) => e.delta?.includes('Decision: yes')));
    const record = f.store.records<any>('acp-permission')[0];
    assert.equal(record.authority, 'full-access');
    assert.equal(record.outcome.optionId, 'yes');
  } finally {
    await f.cleanup();
  }
});
