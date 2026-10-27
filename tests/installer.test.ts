import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const installer = await readFile(new URL('../install.sh', import.meta.url), 'utf8');
async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), 'slim-install-test-'));
  const tools = join(temp, 'tools');
  const root = join(temp, 'install');
  await mkdir(tools);
  const stub = async (name: string, code: string) =>
    writeFile(join(tools, name), `#!/bin/sh\n${code}\n`, { mode: 0o700 });
  // No test may contact a registry; even a mistake in runtime selection reaches this stub.
  await stub('curl', 'exit 88');
  await stub('id', 'printf "1000\\n"');
  const env = { HOME: temp, PATH: `${tools}:${process.env.PATH}`, A0_SLIM_INSTALL_DIR: root };
  const run = (source = installer) =>
    spawnSync('/bin/sh', [], { env, input: source, encoding: 'utf8', timeout: 10_000 });
  return { temp, root, stub, run, close: () => rm(temp, { recursive: true, force: true }) };
}

test('installer rejects unsupported platforms and root before creating install files', async () => {
  const f = await fixture();
  try {
    await f.stub('uname', 'printf "unsupported\\n"');
    assert.match(f.run().stderr, /not yet supported/);
    await assert.rejects(access(f.root));
    await f.stub('id', 'printf "0\\n"');
    assert.match(f.run().stderr, /without sudo/);
    await assert.rejects(access(f.root));
  } finally {
    await f.close();
  }
});

test('an incomplete piped installer cannot start installation', async () => {
  const f = await fixture();
  try {
    const result = f.run(installer.slice(0, installer.indexOf('  slim_root=${')));
    assert.notEqual(result.status, 0);
    await assert.rejects(access(f.root));
  } finally {
    await f.close();
  }
});

test('a concurrent or interrupted installer lock preserves the existing launcher', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, '.install-lock'), { recursive: true });
    await writeFile(join(f.root, 'sentinel'), 'keep existing installation');
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Another installer is running or was interrupted/);
    assert.equal(await readFile(join(f.root, 'sentinel'), 'utf8'), 'keep existing installation');
    await access(join(f.root, '.install-lock'));
  } finally {
    await f.close();
  }
});

test('a mismatched Node download is never extracted and preserves the active release', async () => {
  const f = await fixture();
  try {
    await f.stub('node', 'exit 1'); // An unsuitable existing Node must trigger the private setup path.
    await f.stub(
      'curl',
      'while [ "$#" -gt 0 ]; do if [ "$1" = --output ]; then shift; printf "tampered archive" > "$1"; exit 0; fi; shift; done; exit 1',
    );
    await f.stub('tar', `touch '${f.temp}/extracted'; exit 99`);
    await mkdir(join(f.root, 'old'), { recursive: true });
    await writeFile(join(f.root, 'old/sentinel'), 'keep');
    await symlink(join(f.root, 'old'), join(f.root, 'current'));
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Setting up private Node 24.22.1/);
    assert.match(result.stderr, /Checksum mismatch/);
    await assert.rejects(access(join(f.temp, 'extracted')));
    assert.equal(await readFile(join(f.root, 'current/sentinel'), 'utf8'), 'keep');
    await assert.rejects(access(join(f.root, '.install-lock')));
  } finally {
    await f.close();
  }
});

test('installed launcher refuses an older running service instead of silently opening it', async () => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const f = await fixture();
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        version: '0.0.0-old',
        stage: 'P2 preview · account checks pending',
        paired: false,
      }),
    );
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as import('node:net').AddressInfo).port;
    const source = installer
      .split('cat > "$slim_stage/launch.mjs" <<\'JS\'\n')[1]!
      .split('\nJS\n')[0]!;
    const launcher = join(f.temp, 'launch.mjs');
    await writeFile(launcher, source);
    const child = spawn(process.execPath, [launcher], {
      env: {
        PATH: process.env.PATH,
        HOME: f.temp,
        A0_SLIM_PORT: String(port),
        A0_SLIM_NO_BROWSER: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let error = '';
    child.stderr.on('data', (b) => {
      error += b;
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(code, 1);
    assert.match(error, /Stop it in its original terminal/);
    assert.doesNotMatch(error, /MODULE_NOT_FOUND/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.close();
  }
});
