import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.js';
import { Vault } from '../src/providers/vault.js';
import { SandboxProof } from '../src/execution/proof.js';

test('synthetic sandbox proof pins isolation and attempts cleanup after command failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-sandbox-'));
  const store = new Store(dir),
    vault = new Vault(store, async () => Buffer.alloc(32, 6));
  await vault.set('sandbox:vercel', {
    token: 'synthetic',
    teamId: 'test-team',
    projectId: 'test-project',
  });
  let stopped = 0;
  try {
    const proof = new SandboxProof(
      store,
      vault,
      async (options) => {
        assert.equal(options!.persistent, false);
        assert.equal(options!.networkPolicy, 'deny-all');
        assert.deepEqual(options!.ports, []);
        assert.equal(options!.timeout, 60_000);
        return {
          name: options!.name!,
          writeFiles: async (files) => {
            assert.equal(files.length, 1);
            assert.equal(files[0]!.path, 'proof.txt');
          },
          runCommand: async () => {
            throw new Error('provider error with token MUST-NOT-LEAK');
          },
          readFileToBuffer: async () => null,
          stop: async () => {
            stopped++;
            throw new Error('unknown stop');
          },
        };
      },
      undefined,
      async (credentials) => credentials,
    );
    const receipt = await proof.run();
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.cleanup, 'unknown');
    assert.equal(stopped, 1);
    assert.ok(!JSON.stringify(store.receipts()).includes('MUST-NOT-LEAK'));
    assert.equal(store.receipts()[0]!.environmentId, `a0-slim-${receipt.id}`);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('lost creation response is recovered by exact name and tags without another create', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-sandbox-recovery-'));
  const store = new Store(dir),
    vault = new Vault(store, async () => Buffer.alloc(32, 6));
  const credentials = { token: 'synthetic', teamId: 'team', projectId: 'project' };
  await vault.set('sandbox:vercel', credentials);
  let creates = 0,
    gets = 0,
    stops = 0,
    deletes = 0;
  let name = '',
    proofId = '';
  const proof = new SandboxProof(
    store,
    vault,
    async (options) => {
      creates++;
      name = options!.name!;
      proofId = options!.tags!.proof!;
      throw new Error('Lost create response');
    },
    async (options) => {
      gets++;
      assert.equal(options.resume, false);
      assert.equal(options.name, name);
      if (deletes) throw { response: new Response(null, { status: 404 }) };
      return {
        name,
        tags: { app: 'a0-slim', proof: proofId },
        status: 'running',
        stop: async () => {
          stops++;
          return { status: 'stopped' } as any;
        },
        delete: async () => {
          deletes++;
        },
      };
    },
    async (credentials) => credentials,
  );
  try {
    const receipt = await proof.run();
    assert.equal(receipt.cleanup, 'unknown');
    await assert.rejects(proof.run(), /reconcile/);
    await vault.set('sandbox:vercel', { ...credentials, projectId: 'other' });
    assert.match(String((await proof.reconcile(receipt.id)).reconcileMessage), /original Vercel/);
    assert.equal(gets, 0);
    await vault.set('sandbox:vercel', credentials);
    const recovered = await proof.reconcile(receipt.id);
    assert.equal(recovered.cleanup, 'deleted');
    assert.equal(creates, 1);
    assert.equal(stops, 1);
    assert.equal(deletes, 1);
    assert.equal(gets, 2);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('sandbox lookup failure and mismatched ownership never authorize cleanup or repetition', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-sandbox-identity-'));
  const store = new Store(dir),
    vault = new Vault(store, async () => Buffer.alloc(32, 6));
  await vault.set('sandbox:vercel', { token: 'synthetic', teamId: 'team', projectId: 'project' });
  let found = false,
    effects = 0,
    name = '';
  const proof = new SandboxProof(
    store,
    vault,
    async (options) => {
      name = options!.name!;
      throw new Error('lost');
    },
    async () => {
      if (!found) throw { response: new Response(null, { status: 404 }) };
      return {
        name,
        status: 'running',
        tags: { app: 'a0-slim', proof: 'different' },
        stop: async () => {
          effects++;
          return { status: 'stopped' } as any;
        },
        delete: async () => {
          effects++;
        },
      };
    },
    async (credentials) => credentials,
  );
  try {
    const receipt = await proof.run();
    assert.equal((await proof.reconcile(receipt.id)).cleanup, 'unknown');
    found = true;
    assert.equal((await proof.reconcile(receipt.id)).cleanup, 'unknown');
    assert.equal(effects, 0);
    await assert.rejects(proof.run(), /reconcile/);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
