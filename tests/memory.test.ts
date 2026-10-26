import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/storage/store.js';
import { Vault } from '../src/providers/vault.js';
import { MemoryStore } from '../src/memory/store.js';
import { Embeddings, normalize } from '../src/memory/embeddings.js';
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'slim-memory-')),
    store = new Store(dir),
    memory = new MemoryStore(store),
    vault = new Vault(store, async () => Buffer.alloc(32, 8)),
    embeddings = new Embeddings(store, vault, memory),
    project = randomUUID(),
    other = randomUUID();
  for (const id of [project, other]) store.saveProject({ id, name: id, root: dir });
  return {
    dir,
    store,
    memory,
    embeddings,
    project,
    other,
    close: async () => {
      await embeddings.close();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test('memory mutations are transactional and replay-safe; scope, FTS, deletion and portable imports agree', async () => {
  const f = await setup();
  try {
    assert.throws(() => f.memory.assert(f.project, 'read'), /off/);
    const input = { text: 'Garden uses sage green.', source: 'Synthetic note', area: 'main' };
    const first = f.memory.save(f.project, input, 'stable');
    assert.deepEqual(f.memory.save(f.project, input, 'stable'), first);
    assert.throws(
      () => f.memory.save(f.project, { ...input, text: 'Different' }, 'stable'),
      /different/,
    );
    assert.equal(f.memory.list(f.project).length, 1);
    assert.equal(f.memory.search(f.other, 'sage').length, 0);
    assert.equal(f.memory.search(f.project, 'sage " OR NEAR(').length, 1);
    assert.throws(() => f.memory.save(f.other, input, 'update', first.id), /not found/);
    f.store.db
      .prepare('INSERT INTO memory_vectors VALUES (?,?,?,?)')
      .run('space', first.id, f.memory.list(f.project)[0]!.digest, '[1,0]');
    const exported = f.memory.export(f.project);
    assert.ok(!JSON.stringify(exported).includes('vector'));
    f.memory.import(f.other, exported, 'import');
    assert.equal(f.memory.search(f.other, 'sage')[0]?.source, 'Synthetic note');
    f.memory.delete(f.project, first.id, 'delete');
    assert.equal(f.memory.search(f.project, 'sage').length, 0);
    assert.equal(
      (f.store.db.prepare('SELECT count(*) AS n FROM memory_vectors').get() as { n: number }).n,
      0,
    );
    assert.equal(f.memory.delete(f.project, first.id, 'delete').status, 'deleted');
    assert.equal(f.memory.save(f.project, input, 'stable').id, first.id);
    assert.equal(f.memory.list(f.project).length, 0);
  } finally {
    await f.close();
  }
});
test('embedding namespaces never mix dimensions; failed rebuild preserves active index and revoked sharing prevents remote queries', async () => {
  const f = await setup();
  try {
    f.memory.save(f.project, { text: 'Sage garden', source: 'Fixture' }, 'one');
    const a = await f.embeddings.add({
        name: 'A',
        baseUrl: 'https://example.com/v1',
        model: 'a',
        revision: '1',
        dimension: 2,
      }),
      b = await f.embeddings.add({
        name: 'B',
        baseUrl: 'https://example.com/v1',
        model: 'b',
        revision: '2',
        dimension: 3,
      });
    assert.notEqual(f.embeddings.namespace(a), f.embeddings.namespace(b));
    assert.throws(() => normalize([NaN, 1], 2));
    assert.throws(() => normalize([1, 2], 3));
    assert.throws(() => normalize([0, 0], 2));
    assert.throws(() => f.embeddings.start(f.project, a.id, false), /Confirm/);
    let fail = false,
      calls = 0;
    f.embeddings.embed = async (c) => {
      calls++;
      if (fail) throw new Error('Failed');
      return c.dimension === 2 ? [1, 0] : [1, 0, 0];
    };
    const ready = async () => {
      for (
        let i = 0;
        i < 100 && f.embeddings.state(f.project).jobs.some((j) => j.status === 'building');
        i++
      )
        await new Promise((r) => setTimeout(r, 5));
    };
    f.embeddings.start(f.project, a.id, true);
    await ready();
    assert.equal(f.embeddings.state(f.project).active, a.id);
    fail = true;
    f.embeddings.start(f.project, b.id, true);
    await ready();
    assert.equal(f.embeddings.state(f.project).active, a.id);
    assert.equal(
      f.embeddings.state(f.project).jobs.find((j) => j.connectionId === b.id)?.status,
      'failed',
    );
    fail = false;
    const result = await f.embeddings.search(f.project, 'sage');
    assert.equal(result.mode, 'hybrid');
    assert.equal(result.notes.length, 1);
    await f.embeddings.lexicalOnly(f.project);
    const count = calls;
    assert.equal((await f.embeddings.search(f.project, 'sage')).mode, 'lexical');
    assert.equal(calls, count);
    await f.embeddings.removeConnection(a.id);
  } finally {
    await f.close();
  }
});
test('interrupted indexing resumes from checked vectors and concurrent memory edits cannot activate stale generations', async () => {
  const f = await setup();
  try {
    const n = f.memory.save(f.project, { text: 'old text', source: 'Fixture' }, 'one');
    const c = await f.embeddings.add({
      name: 'Fixture',
      baseUrl: 'https://example.com',
      model: 'x',
      revision: '1',
      dimension: 2,
    });
    f.embeddings.embed = async () => {
      f.memory.save(f.project, { text: 'new text', source: 'Fixture' }, 'edit', n.id);
      return [1, 0];
    };
    f.embeddings.start(f.project, c.id, true);
    for (
      let i = 0;
      i < 100 && f.embeddings.state(f.project).jobs.some((j) => j.status === 'building');
      i++
    )
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(f.embeddings.state(f.project).active, null);
    assert.equal(f.embeddings.state(f.project).jobs[0]?.status, 'failed');
    f.embeddings.embed = async () => [1, 0];
    f.embeddings.start(f.project, c.id, true);
    for (
      let i = 0;
      i < 100 && f.embeddings.state(f.project).jobs.some((j) => j.status === 'building');
      i++
    )
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(f.embeddings.state(f.project).active, c.id);
  } finally {
    await f.close();
  }
});
test('a failure after memory text mutation rolls back text, FTS and the operation receipt together', async () => {
  const f = await setup();
  try {
    f.store.db.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON memory_ops BEGIN SELECT RAISE(ABORT, 'simulated interruption'); END;",
    );
    assert.throws(
      () =>
        f.memory.save(
          f.project,
          { text: 'Must not survive partial mutation', source: 'Fixture' },
          'fail',
        ),
      /simulated interruption/,
    );
    assert.equal(f.memory.list(f.project).length, 0);
    assert.equal(f.memory.search(f.project, 'mutation').length, 0);
    f.store.db.exec('DROP TRIGGER fail_receipt');
    f.memory.save(f.project, { text: 'Successful retry', source: 'Fixture' }, 'fail');
    assert.equal(f.memory.list(f.project).length, 1);
  } finally {
    await f.close();
  }
});
