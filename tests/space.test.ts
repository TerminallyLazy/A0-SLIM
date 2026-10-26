import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readSpaceEvents, spaceExpectedOutput, spaceOrigin } from '../src/execution/space-http.js';
import { createApp } from '../src/server/app.js';

import { fixture, id, event, output } from './helpers/space-server.js';

test('SPACE connection inspection is read-only; native HTTP/SSE proof retains intent, identities and deletion evidence without tokens', async () => {
  const h = await fixture();
  try {
    assert.equal(h.service.state().status.connection, 'unchecked');
    await h.service.check();
    assert.equal(h.service.state().status.connection, 'passed');
    assert.equal(h.f.creates, 0);
    const r = await h.run();
    assert.equal(r.status, 'passed');
    assert.equal(r.cleanup, 'deleted');
    assert.equal(r.outputVerified, true);
    assert.equal(h.f.attaches, 1);
    assert.equal(h.f.commands, 1);
    assert.equal(h.f.deletes, 1);
    assert.equal(r.templateDigest, 'sha256:abcdef');
    const serialized = JSON.stringify(h.service.state());
    assert.ok(!serialized.includes(h.f.token));
    assert.ok(!serialized.includes(h.f.attachment));
    assert.ok(!JSON.stringify(h.store.db.prepare('SELECT * FROM vault').all()).includes(h.f.token));
    await h.service.save({ ...h.config, token: '' });
    assert.equal(h.service.state().status.connection, 'passed');
    await h.service.save({ ...h.config, template: 'different' });
    assert.equal(h.service.state().status.connection, 'changed');
    await assert.rejects(h.service.start(), /Check connection/);
  } finally {
    await h.close();
  }
});

test('SPACE lost create recovery lists all pages, blocks duplicate creation across restart and never replays commands', async () => {
  const h = await fixture();
  try {
    h.f.lostCreate = true;
    const r = await h.run();
    assert.equal(r.cleanup, 'unknown');
    assert.equal(r.environmentId, undefined);
    h.reopen();
    await assert.rejects(h.service.start(), /previous SPACE outcome/);
    h.f.listEmpty = true;
    assert.equal((await h.recover(r.id)).cleanup, 'unknown');
    h.f.listEmpty = false;
    h.f.repeatCursor = true;
    assert.equal((await h.recover(r.id)).cleanup, 'unknown');
    h.f.repeatCursor = false;
    h.f.paginate = true;
    assert.equal((await h.recover(r.id)).cleanup, 'deleted');
    assert.equal(h.f.creates, 1);
    assert.equal(h.f.commands, 0);
    assert.equal(h.f.deletes, 1);
  } finally {
    await h.close();
  }
});

test('SPACE token rotation is accepted only for the same verified account and deployment', async () => {
  const h = await fixture();
  try {
    h.f.lostCreate = true;
    const r = await h.run();
    h.f.token = 'ROTATED-PRIVATE-TOKEN';
    await h.service.save({ ...h.config, token: h.f.token });
    h.f.user = 'different-user';
    assert.equal((await h.recover(r.id)).cleanup, 'unknown');
    assert.equal(h.f.deletes, 0);
    h.f.user = 'user-original';
    assert.equal((await h.recover(r.id)).cleanup, 'deleted');
    assert.equal(h.f.creates, 1);
    await assert.rejects(
      h.service.save({ ...h.config, managementOrigin: 'https://different.invalid', token: '' }),
      /Enter a management token/,
    );
  } finally {
    await h.close();
  }
});

test('SPACE lost deletion reuses the original request within 24 hours, never infers success from absence', async () => {
  const h = await fixture();
  try {
    h.f.lostDelete = true;
    const r = await h.run();
    assert.equal(r.cleanup, 'unknown');
    assert.equal(h.f.sandbox, null);
    h.f.lostDelete = false;
    assert.equal((await h.recover(r.id)).cleanup, 'deleted');
    const deletes = h.requests.filter((r) => r.method === 'DELETE');
    assert.equal(deletes.length, 2);
    assert.deepEqual(deletes[0], deletes[1]);
    assert.equal(h.f.commands, 1);
    assert.equal(h.f.creates, 1);
  } finally {
    await h.close();
  }
});

test('SPACE expired deletion key, unresolved operation and 404 all retain recovery holds', async () => {
  const h = await fixture();
  try {
    h.f.lostDelete = true;
    const r = await h.run();
    r.deletion!.at = new Date(Date.now() - 25 * 3600_000).toISOString();
    h.store.receipt(r);
    assert.equal((await h.recover(r.id)).cleanup, 'unknown');
    assert.equal(h.f.deletes, 1);
    r.deletion!.operationId = [...h.operations.values()].find(
      (o) => o.kind === 'delete_sandbox',
    ).id;
    h.store.receipt(r);
    h.f.operation404 = true;
    assert.equal((await h.recover(r.id)).cleanup, 'unknown');
    h.f.operation404 = false;
    const op = h.operations.get(r.deletion!.operationId!)!;
    op.state = 'future_state';
    assert.equal((await h.recover(r.id)).cleanup, 'unknown');
    op.state = 'succeeded';
    assert.equal((await h.recover(r.id)).cleanup, 'deleted');
    assert.equal(h.f.deletes, 1);
  } finally {
    await h.close();
  }
});

test('SPACE unknown or mismatched create operations retain the hold without starting commands or deletion', async () => {
  for (const failure of ['unknownCreate', 'foreignOp'] as const) {
    const h = await fixture();
    try {
      h.f[failure] = true;
      const r = await h.run();
      assert.equal(r.cleanup, 'unknown');
      assert.equal(h.f.commands, 0);
      assert.equal(h.f.deletes, 0);
    } finally {
      await h.close();
    }
  }
});

for (const failure of ['badAttachment', 'badStream', 'partialCreate', 'missingSandbox'] as const) {
  test(`SPACE ${failure} retains partial evidence and cleans only the owned sandbox`, async () => {
    const h = await fixture();
    try {
      h.f[failure] = true;
      const r = await h.run();
      assert.equal(r.cleanup, 'deleted');
      assert.ok(r.environmentId);
      assert.equal(r.status, failure === 'missingSandbox' ? 'passed' : 'failed');
      if (failure === 'badAttachment') assert.equal(h.f.attaches, 0);
    } finally {
      await h.close();
    }
  });
}

test('SPACE redirects, incompatible versions, ownership mismatch and account failure cannot pass or delete foreign resources', async () => {
  const h = await fixture();
  try {
    h.f.redirect = true;
    await assert.rejects(h.service.check(), /HTTP 302/);
    assert.equal(h.f.attaches, 0);
    h.f.redirect = false;
    h.f.version = '0.9.0';
    await assert.rejects(h.service.check(), /0.8.x/);
    assert.equal(h.f.creates, 0);
    h.f.version = '0.8.0';
    h.f.badOwner = true;
    const r = await h.run();
    assert.equal(r.cleanup, 'unknown');
    assert.equal(h.f.deletes, 0);
    assert.equal(h.f.commands, 0);
    h.f.badOwner = false;
    assert.equal((await h.recover(r.id)).cleanup, 'deleted');
  } finally {
    await h.close();
  }
});

test('SPACE reviewed absence is explicit, delayed and separate from deletion or passing a check', async () => {
  const h = await fixture();
  try {
    h.f.lostCreate = true;
    const r = await h.run();
    h.f.sandbox = null;
    const note =
      'Owner reviewed the original cluster and confirmed no pending operation or sandbox.';
    assert.equal((await h.recover(r.id, note)).cleanup, 'unknown');
    r.create!.at = new Date(Date.now() - 25 * 3600_000).toISOString();
    h.store.receipt(r);
    const reviewed = await h.recover(r.id, note);
    assert.equal(reviewed.cleanup, 'reviewed_absent');
    assert.equal(reviewed.status, 'failed');
    assert.equal(h.f.deletes, 0);
    assert.equal(reviewed.resolution, note);
  } finally {
    await h.close();
  }
});

test('SPACE startup marks unfinished work interrupted and shutdown never clears an unresolved hold', async () => {
  const h = await fixture();
  try {
    h.f.pendingDelete = true;
    await h.service.check();
    const r = await h.service.start();
    await assert.rejects(h.service.start(), /already in progress/);
    await h.service.close();
    const saved = h.service.receipts()[0]!;
    saved.status = 'running';
    saved.cleanup = 'unknown';
    h.store.receipt(saved);
    h.reopen();
    assert.equal(h.service.receipts()[0]!.status, 'interrupted');
    await assert.rejects(h.service.start(), /previous SPACE outcome/);
    assert.equal(h.service.receipts()[0]!.id, r.id);
  } finally {
    await h.close();
  }
});

test('SPACE SSE decoder rejects errors, gaps, truncation, invalid base64, duplicate output and foreign/nonzero exits across byte splits', async () => {
  const pid = id('proc');
  async function* chunks(s: string) {
    const bytes = Buffer.from(s);
    for (let i = 0; i < bytes.length; i += 3) yield bytes.subarray(i, i + 3);
  }
  await readSpaceEvents(chunks(': café 🌱\n\n' + output(pid)), pid);
  const good = output(pid);
  for (const stream of [
    good + event('error', { error: { code: 'failed' } }),
    good + event('resync_required', {}),
    good.slice(0, -1),
    good.replace('PROOF', 'invalid'),
    good.replace('"exit_code":0', '"exit_code":1'),
    good.replace('"status":"exited"', '"status":"unknown"'),
    good.replace('"seq":1', '"seq":-1'),
    good.replace('"data_base64":"', '"data_base64":"!'),
    good.replace('event: process_exited', 'event: arbitrary'),
    event('stdout', { seq: 1, data_base64: 'YQ==' }) + good,
  ].filter((s) => s !== good))
    await assert.rejects(readSpaceEvents(chunks(stream), pid));
  await assert.rejects(readSpaceEvents(chunks(good), id('proc')));
  for (const url of [
    'http://example.com',
    'https://user:secret@example.com',
    'https://example.com/?token=secret',
    'https://example.com/api',
    'file:///tmp/a',
  ])
    assert.throws(() => spaceOrigin(url));
  assert.equal(spaceOrigin('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
});

test('SPACE routes require pairing, write-only credentials and both resource acknowledgments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-space-api-'));
  const origin = 'http://127.0.0.1:4317';
  const { app, space } = await createApp({
    dataDir: dir,
    origin,
    pairingCode: 'fixture-pair',
    keySource: async () => Buffer.alloc(32, 7),
  });
  const headers: Record<string, string> = { host: '127.0.0.1:4317', origin };
  try {
    assert.equal((await app.inject({ url: '/api/v1/sandbox/space', headers })).statusCode, 401);
    const paired = await app.inject({
      method: 'POST',
      url: '/api/v1/pair',
      headers,
      payload: { code: 'fixture-pair' },
    });
    headers.cookie = paired.cookies[0]!.name + '=' + paired.cookies[0]!.value;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sandbox/space',
      headers,
      payload: {
        managementOrigin: 'https://space.example.com',
        dataPlaneOrigin: 'https://data.example.com',
        consoleOrigin: 'https://console.example.com',
        apiPrefix: '/v1',
        template: 'seed:latest',
        runtime: 'firecracker',
        vcpu: 1,
        memoryMiB: 512,
        diskMiB: 1024,
        token: 'SECRET-TEST-TOKEN',
      },
    });
    assert.equal(response.statusCode, 200);
    assert.ok(!response.body.includes('SECRET-TEST-TOKEN'));
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/sandbox/space/proof',
          headers,
          payload: { acknowledgeUsage: true },
        })
      ).statusCode,
      400,
    );
    assert.equal(space.receipts().length, 0);
    const state = await app.inject({ url: '/api/v1/state', headers });
    assert.equal(state.json().environments.space.connection, 'unchecked');
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/sandbox/space/receipts/' + randomUUID() + '/review-absence',
          headers,
          payload: { resolution: 'An attempted unacknowledged review' },
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
