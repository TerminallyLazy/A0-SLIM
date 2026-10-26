import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  realpath,
  mkdtemp,
  mkdir,
  rm,
  readFile,
  writeFile,
  symlink,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/storage/store.js';
import { Operations } from '../src/policy/operations.js';

async function setup() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'slim-operations-'))),
    root = join(dir, 'project');
  await mkdir(root);
  const store = new Store(join(dir, 'data'));
  const projectId = randomUUID(),
    chatId = randomUUID(),
    sessionId = 'wrun_fixture';
  store.saveProject({ id: projectId, name: 'Fixture', root });
  store.saveChat({
    id: chatId,
    title: 'Fixture',
    projectId,
    connectionId: randomUUID(),
    model: 'fixture',
    sessionId,
    status: 'idle',
    createdAt: new Date().toISOString(),
  });
  return { dir, root, store, projectId, sessionId, operations: new Operations(store) };
}
test('artifact proposals need exact approval, deduplicate calls, and detect file conflicts and path escapes', async () => {
  const s = await setup();
  try {
    const propose = (path: string, content = 'reviewed text', call = 'call-1') =>
      s.operations.propose(s.projectId, s.sessionId, call, 'message-1', { path, content });
    for (const path of ['../escape', '.env', '.git/config', '/tmp/escape', '.a0-slim-hidden.tmp'])
      await assert.rejects(propose(path));
    await symlink(s.dir, join(s.root, 'escape'));
    await assert.rejects(propose('escape/test'));
    const operation = await propose('result.txt');
    await assert.rejects(readFile(join(s.root, 'result.txt')), { code: 'ENOENT' });
    assert.equal((await propose('result.txt')).id, operation.id);
    await assert.rejects(propose('result.txt', 'changed'), /changed its artifact/);
    await assert.rejects(s.operations.apply(operation.id, '0'.repeat(64)), /approval/);
    assert.equal((await s.operations.apply(operation.id, operation.digest)).status, 'applied');
    assert.equal(await readFile(join(s.root, 'result.txt'), 'utf8'), 'reviewed text');
    assert.equal((await s.operations.apply(operation.id, operation.digest)).status, 'applied');
    const change = await propose('result.txt', 'replacement', 'call-2');
    await writeFile(join(s.root, 'result.txt'), 'external edit');
    await assert.rejects(s.operations.apply(change.id, change.digest), /destination changed/);
    assert.equal(await readFile(join(s.root, 'result.txt'), 'utf8'), 'external edit');
    s.operations.reject(change.id, change.digest);
    const replacement = await propose('result.txt', 'safe replacement', 'call-3');
    await s.operations.apply(replacement.id, replacement.digest);
    assert.equal(await readFile(join(s.root, 'result.txt'), 'utf8'), 'safe replacement');
  } finally {
    s.store.close();
    await rm(s.dir, { recursive: true, force: true });
  }
});
test('unknown effects block new call IDs; unchanged and conflicting outcomes need fresh human decisions', async () => {
  const s = await setup();
  try {
    const op = await s.operations.propose(s.projectId, s.sessionId, 'call', 'turn', {
      path: 'result.txt',
      content: 'expected',
    });
    s.store.saveOperation({ ...op, status: 'unknown' });
    await assert.rejects(
      s.operations.propose(s.projectId, s.sessionId, 'different-call', 'other-turn', {
        path: 'other.txt',
        content: 'repeat',
      }),
      /reconcile/,
    );
    assert.throws(() => s.operations.reject(op.id, op.digest), /Reconcile/);
    assert.equal((await s.operations.reconcile(op.id)).status, 'pending');
    s.store.saveOperation({ ...op, status: 'unknown' });
    await writeFile(join(s.root, 'result.txt'), 'someone else');
    assert.equal((await s.operations.reconcile(op.id)).status, 'conflict');
    assert.throws(() => s.operations.reject(op.id, op.digest), /Review the current/);
    s.operations.reject(op.id, op.digest, true);
    assert.equal(await readFile(join(s.root, 'result.txt'), 'utf8'), 'someone else');
  } finally {
    s.store.close();
    await rm(s.dir, { recursive: true, force: true });
  }
});
test(
  'SIGKILL after an applied artifact is reconciled without repeating its write',
  { timeout: 15000 },
  async () => {
    const s = await setup();
    const op = await s.operations.propose(s.projectId, s.sessionId, 'call', 'turn', {
      path: 'artifact.txt',
      content: 'single effect',
    });
    s.store.close();
    const child = fork(
      fileURLToPath(new URL('./helpers/artifact-crash-worker.ts', import.meta.url)),
      [join(s.dir, 'data'), op.id, op.digest],
      { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
    );
    let reopened: Store | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('message', () => resolve());
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`Worker exited ${code}`)));
      });
      const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
      child.kill('SIGKILL');
      await ended;
      reopened = new Store(join(s.dir, 'data'));
      const operations = new Operations(reopened);
      assert.equal(reopened.operation(op.id).status, 'unknown');
      await assert.rejects(operations.apply(op.id, op.digest), /reconcile/);
      assert.equal((await operations.reconcile(op.id)).status, 'applied');
      assert.equal((await operations.apply(op.id, op.digest)).status, 'applied');
      assert.equal(await readFile(join(s.root, 'artifact.txt'), 'utf8'), 'single effect');
      assert.deepEqual(
        (await readdir(s.root)).filter((n) => n.startsWith('.a0-slim-')),
        [],
      );
    } finally {
      child.kill('SIGKILL');
      reopened?.close();
      await rm(s.dir, { recursive: true, force: true });
    }
  },
);
