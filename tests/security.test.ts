import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpath, mkdtemp, rm, writeFile, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/storage/store.js';
import { Vault } from '../src/providers/vault.js';
import { readWorkspaceFile, listWorkspace } from '../src/tools/files.js';
import { safeEndpoint } from '../src/domain.js';
import { acquireServiceLock } from '../src/storage/lock.js';

test('data-directory ownership excludes a second service and releases on close', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-lock-'));
  const release = acquireServiceLock(dir);
  try {
    assert.throws(() => acquireServiceLock(dir), /Another A0 SLIM service/);
  } finally {
    release();
  }
  const again = acquireServiceLock(dir);
  again();
  await rm(dir, { recursive: true, force: true });
});

test('vault authenticates ciphertext against the record ID and never stores the key in metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'slim-vault-'));
  const store = new Store(dir);
  try {
    const vault = new Vault(store, async () => Buffer.alloc(32, 7));
    await vault.set('first', { apiKey: 'synthetic-secret-never-log' });
    assert.deepEqual(await vault.get('first'), { apiKey: 'synthetic-secret-never-log' });
    const row = store.db.prepare('SELECT ciphertext FROM vault').get() as { ciphertext: string };
    assert.ok(!row.ciphertext.includes('synthetic-secret'));
    store.db.prepare('INSERT INTO vault VALUES (?,?)').run('second', row.ciphertext);
    await assert.rejects(vault.get('second'), /could not be decrypted/);
    vault.remove('first');
    assert.equal(await vault.get('first'), null);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('file tools reject traversal, sensitive files, links, binary and oversize data', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'slim-files-')));
  const root = join(dir, 'project');
  await mkdir(root);
  await writeFile(join(root, 'note.md'), 'Readable note');
  await writeFile(join(root, '.env'), 'secret');
  await writeFile(join(dir, 'outside.txt'), 'outside');
  await symlink(join(dir, 'outside.txt'), join(root, 'link.txt'));
  await symlink(dir, join(root, 'linked'));
  await writeFile(join(root, 'binary'), Buffer.from([0, 2, 1]));
  await writeFile(join(root, 'large'), Buffer.alloc(300_000, 65));
  try {
    assert.equal(await readWorkspaceFile(root, 'note.md'), 'Readable note');
    for (const path of [
      '../outside.txt',
      '.env',
      '/etc/passwd',
      'link.txt',
      'linked/outside.txt',
      'binary',
      'large',
    ])
      await assert.rejects(readWorkspaceFile(root, path));
    const list = await listWorkspace(root);
    assert.ok(!list.some((e) => ['.env', 'link.txt', 'linked'].includes(e.name)));
    assert.equal(safeEndpoint('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1');
    for (const url of [
      'http://example.com/v1',
      'https://key@example.com',
      'https://example.com/?key=secret',
      'file:///tmp',
    ])
      assert.throws(() => safeEndpoint(url));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
