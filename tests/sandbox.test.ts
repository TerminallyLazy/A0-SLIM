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
    const proof = new SandboxProof(store, vault, async (options) => {
      assert.equal(options!.persistent, false);
      assert.equal(options!.networkPolicy, 'deny-all');
      assert.deepEqual(options!.ports, []);
      assert.equal(options!.timeout, 60_000);
      return {
        name: 'synthetic-environment',
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
    });
    const receipt = await proof.run();
    assert.equal(receipt.status, 'failed');
    assert.equal(receipt.cleanup, 'unknown');
    assert.equal(stopped, 1);
    assert.ok(!JSON.stringify(store.receipts()).includes('MUST-NOT-LEAK'));
    assert.equal(store.receipts()[0]!.environmentId, 'synthetic-environment');
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
