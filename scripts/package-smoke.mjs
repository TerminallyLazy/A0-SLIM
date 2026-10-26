import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageIndex = process.argv.indexOf('--package');
const packageSource = packageIndex === -1 ? undefined : process.argv[packageIndex + 1];
assert.ok(
  packageIndex === -1 || (packageSource && !packageSource.startsWith('--')),
  '--package requires a tarball path or registry spec',
);
const globalInstall = process.argv.includes('--global-install');
const npm =
  process.env.npm_execpath ??
  resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
const temp = await mkdtemp(join(tmpdir(), 'slim-npm-smoke-'));
const cleanEnv = { PATH: process.env.PATH, HOME: temp, TMPDIR: tmpdir() };
const run = (args, cwd = temp) =>
  new Promise((done, fail) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    child.stdout.on('data', (b) => (out += b));
    child.stderr.on('data', (b) => (err += b));
    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0
        ? done(out)
        : fail(new Error(`Package check failed (${code}): ${err.slice(-4000)}`)),
    );
  });
async function usage(path) {
  let bytes = 0,
    allocated = 0,
    files = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const size = await usage(child);
      bytes += size.bytes;
      allocated += size.allocated;
      files += size.files;
    } else if (entry.isFile()) {
      const s = await stat(child);
      bytes += s.size;
      allocated += s.blocks * 512;
      files++;
    }
  }
  return { bytes, allocated, files };
}
let child, model;
try {
  const packed = JSON.parse(
    await run(
      [
        npm,
        'pack',
        ...(packageSource ? [packageSource] : []),
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        temp,
      ],
      root,
    ),
  )[0];
  const files = packed.files.map((f) => f.path);
  for (const file of [
    'bin/a0-slim.mjs',
    'LICENSE',
    'dist/server/cli.js',
    'dist/ui/index.html',
    'dist/ui/THIRD_PARTY_LICENSES.txt',
    'npm-shrinkwrap.json',
    'addons/local-embeddings/npm-shrinkwrap.json',
    'addons/local-embeddings/worker.mjs',
    'docs/licenses/Agent-Zero-MIT.txt',
    'docs/MICROSANDBOX.md',
  ])
    assert.ok(files.includes(file), `Missing ${file}`);
  assert.ok(
    !files.some(
      (f) =>
        /^(src|tests|node_modules|models|data|workspace)\//.test(f) ||
        f.endsWith('.db') ||
        f.includes('local-worker'),
    ),
  );
  await writeFile(
    join(temp, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      allowScripts: { 'better-sqlite3@13.0.3': true, 'cbor-extract@2.2.2': true },
    }),
  );
  await run([
    npm,
    'install',
    join(temp, packed.filename),
    '--omit=dev',
    ...(globalInstall
      ? ['--global', '--prefix', temp, '--allow-scripts=better-sqlite3@13.0.3,cbor-extract@2.2.2']
      : ['--ignore-scripts']),
    '--no-audit',
    '--no-fund',
  ]);
  // Native SQLite has its own build/download step. Only these two known dependency scripts are approved.
  if (!globalInstall)
    await run([npm, 'rebuild', 'better-sqlite3', 'cbor-extract', '--ignore-scripts=false']);
  const modules = join(temp, ...(globalInstall ? ['lib'] : []), 'node_modules');
  const installed = join(modules, 'a0-slim');
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(manifest.license, 'MIT');
  assert.notEqual(manifest.private, true);
  const req = createRequire(join(installed, 'package.json'));
  for (const name of [
    '@huggingface/transformers',
    'onnxruntime-node',
    'onnxruntime-web',
    'microsandbox',
    '@superradcompany/microsandbox-darwin-arm64',
    'react',
    'react-dom',
    'lucide-react',
    'react-markdown',
    'remark-gfm',
    'vite',
    'typescript',
  ])
    assert.throws(
      () => req.resolve(name),
      { code: 'MODULE_NOT_FOUND' },
      `${name} leaked into runtime`,
    );
  const bin = globalInstall ? join(temp, 'bin/a0-slim') : join(modules, '.bin/a0-slim');
  assert.match(await run([bin, '--help']), /Optional local embeddings/);
  // Start twice: first applies the patch with install scripts blocked, second proves patch idempotence.
  async function launch() {
    const portServer = createServer();
    await new Promise((r) => portServer.listen(0, '127.0.0.1', r));
    const port = portServer.address().port;
    await new Promise((r) => portServer.close(r));
    const origin = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [bin], {
      cwd: temp,
      env: { ...cleanEnv, A0_SLIM_PORT: String(port), A0_SLIM_DATA_DIR: join(temp, 'data') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '',
      error = '';
    child.stdout.on('data', (b) => (output += b));
    child.stderr.on('data', (b) => (error += b));
    const ended = new Promise((r) => child.once('exit', r));
    try {
      for (let i = 0; i < 200 && !output.includes('Pair this browser'); i++) {
        if (child.exitCode !== null) throw new Error(`CLI exited early: ${error.slice(-2000)}`);
        await new Promise((r) => setTimeout(r, 50));
      }
      const code = output.match(/Pair this browser within 10 minutes: (\S+)/)?.[1];
      assert.ok(code, 'CLI did not become ready');
      assert.equal((await fetch(origin)).status, 200);
      const pair = await fetch(`${origin}/api/v1/pair`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      assert.equal(pair.status, 200);
      const cookie = pair.headers.get('set-cookie').split(';')[0];
      const embeddings = await fetch(`${origin}/api/v1/embeddings`, { headers: { cookie } });
      assert.equal((await embeddings.json()).local.runtime.status, 'not-installed');
      const microsandbox = await fetch(`${origin}/api/v1/sandbox/microsandbox`, {
        headers: { cookie },
      });
      assert.equal(microsandbox.status, 200);
      assert.equal((await microsandbox.json()).runtime.status, 'not-installed');
    } finally {
      child.kill('SIGTERM');
      await ended;
      child = undefined;
    }
  }
  await launch();
  await launch();
  await writeFile(
    join(temp, 'runtime-check.mjs'),
    "export { createFxAgent, getBackendInfo } from 'libfx'; export { local } from 'libfx/durable-local';",
  );
  const libfx = await import(pathToFileURL(join(temp, 'runtime-check.mjs')).href);
  assert.equal(
    (await libfx.getBackendInfo({ surface: 'agent', backend: 'native' })).backend,
    'native',
  );
  const agent = libfx.createFxAgent({
    name: 'pack-cancel',
    provider: 'openai',
    model: 'fixture',
    durability: libfx.local({ dir: join(temp, 'cancel') }),
  });
  try {
    await agent.session().stream().cancel();
    await new Promise((r) => setTimeout(r, 100));
  } finally {
    await agent.close();
  }
  const core = await usage(modules);
  const { LocalModel } = await import(
    pathToFileURL(join(installed, 'dist/server/memory/local-model.js')).href
  );
  model = new LocalModel(join(temp, 'addon-data'));
  await model.installRuntime();
  await model.addon.settled();
  assert.equal(
    (await model.addon.status()).status,
    'ready',
    JSON.stringify(await model.addon.status()),
  );
  const addon = await usage(model.addon.directory);
  let inference;
  if (process.argv.includes('--with-model')) {
    // Opt-in public model download; never part of CI's default package check.
    await model.start();
    for (let i = 0; i < 480; i++) {
      const s = await model.status();
      if (!['downloading', 'verifying'].includes(s.status)) {
        assert.equal(s.status, 'ready', JSON.stringify(s));
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const a = await model.infer('The garden is green.'),
      b = await model.infer('A green garden.');
    assert.equal(a.length, 384);
    assert.ok(Math.abs(a.reduce((s, v) => s + v * v, 0) - 1) < 0.001);
    const cosine = a.reduce((s, v, i) => s + v * b[i], 0);
    assert.ok(cosine > 0.7);
    inference = { dimension: a.length, cosine, modelBytes: (await model.status()).manifest.bytes };
    await model.removeRuntime();
    assert.equal((await model.status()).status, 'runtime-required');
    await model.installRuntime();
    await model.addon.settled();
    assert.equal((await model.infer('The garden is green.')).length, 384);
  }
  await model.removeRuntime();
  assert.equal((await model.addon.status()).status, 'not-installed');
  console.log(
    JSON.stringify(
      {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        package: {
          source: packageSource ?? 'checkout',
          installation: globalInstall ? 'global' : 'local',
          integrity: packed.integrity,
          compressed: packed.size,
          unpacked: packed.unpackedSize,
          files: packed.entryCount,
        },
        core,
        addon,
        inference,
        verified: [
          'packed CLI startup twice',
          'bundled UI',
          'SQLite',
          'native libfx',
          'early stream cancellation',
          'no ML or UI build dependencies in core',
          'add-on CPU probe',
          'runtime removal',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (child) child.kill('SIGTERM');
  await model?.close();
  await rm(temp, { recursive: true, force: true });
}
