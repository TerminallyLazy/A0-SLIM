import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AppError } from '../domain.js';
import type { Store } from '../storage/store.js';
import { companionDescriptor, type McpConnections } from './mcp.js';
import { digest } from './skills.js';
import { workspacePath } from '../tools/files.js';

const here = dirname(fileURLToPath(import.meta.url));
export const workerSource = resolve(
  here,
  here.endsWith('/src/extensions') ? '../../addons/plugin-worker' : '../../../addons/plugin-worker',
);
const bundleFiles = [
  'worker.py',
  'compat.py',
  'journal.py',
  'db-hub.json',
  'dependency-versions.json',
  'requirements.txt',
  'python-runtime.json',
];
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
type Recipe = {
  id: string;
  repository: string;
  commit: string;
  version: string;
  adapterVersion: string;
  files: Record<string, string>;
};
type Artifact = { url: string; sha256: string; bytes: number };
type Binding = {
  id: string;
  projectId: string;
  database: string;
  serverId: string;
  root: string;
  scopeId?: string;
};
export type PluginRuntimeState = {
  status: 'not-installed' | 'installing' | 'ready' | 'interrupted' | 'failed' | 'unsupported';
  version: string;
  downloadBytes: number;
  error?: string;
};
export type NativePluginState = {
  runtime: PluginRuntimeState;
  recipe: Pick<Recipe, 'id' | 'commit' | 'version' | 'adapterVersion'>;
  binding?: { database: string; serverId: string; enabled: boolean };
  unresolved: { id: string; status: string }[];
};
const problem = (message: string) => new AppError(409, 'native_plugin', message);

function runtimePlatform() {
  if (process.platform === 'linux') {
    const report = process.report.getReport() as { header: { glibcVersionRuntime?: string } };
    if (!report.header.glibcVersionRuntime) return 'unsupported';
  }
  return `${process.platform}-${process.arch}`;
}

export async function runWorkerProcess(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((done, fail) => {
    let output = '',
      failure: Error | undefined;
    const child = spawn(command, args, {
      cwd,
      shell: false,
      signal,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        PATH: '/usr/bin:/bin',
        HOME: cwd,
        TMPDIR: cwd,
        LANG: 'en_US.UTF-8',
        PYTHONDONTWRITEBYTECODE: '1',
      },
    });
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 256_000) {
        failure = problem('Runtime output exceeded the supported size.');
        child.kill('SIGKILL');
      }
    });
    child.once('error', (error) => {
      failure = error;
    });
    child.once('close', (code) =>
      code === 0 && !failure && !signal.aborted
        ? done(output)
        : fail(
            problem(
              'Plugin runtime setup or operation did not finish. Retry setup or inspect its operation.',
            ),
          ),
    );
  });
}

export async function downloadPinned(artifact: Artifact, signal: AbortSignal) {
  const response = await fetch(artifact.url, { signal, headers: { 'user-agent': 'A0-SLIM' } });
  if (!response.ok || !response.body) throw problem('The pinned public artifact is unavailable.');
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > artifact.bytes)
        throw problem('The downloaded artifact exceeds its expected size.');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const content = Buffer.concat(chunks);
  if (hash(content) !== artifact.sha256)
    throw problem('The downloaded artifact did not match its reviewed checksum.');
  return content;
}

export async function installPluginRuntime(stage: string, source: string, signal: AbortSignal) {
  const pins = JSON.parse(await readFile(join(source, 'python-runtime.json'), 'utf8'));
  const artifact = pins.platforms[runtimePlatform()] as Artifact | undefined;
  if (!artifact)
    throw problem('The native plugin runtime supports macOS and glibc Linux on arm64/x64.');
  const archive = join(stage, 'python.tar.gz');
  await writeFile(archive, await downloadPinned(artifact, signal), { mode: 0o600 });
  // Only this checksum-verified upstream runtime archive is extracted. Plugin
  // files use individually pinned downloads and never generic archive extraction.
  const entries = await runWorkerProcess('/usr/bin/tar', ['-tzf', archive], stage, signal);
  if (
    entries
      .trim()
      .split('\n')
      .some((p) => !p.startsWith('python/') || p.split('/').includes('..'))
  )
    throw problem('Runtime archive has unexpected paths.');
  await runWorkerProcess('/usr/bin/tar', ['-xzf', archive, '-C', stage], stage, signal);
  await rm(archive);
  await runWorkerProcess(
    join(stage, 'python/bin/python3'),
    [
      '-I',
      '-B',
      '-m',
      'pip',
      '--isolated',
      '--disable-pip-version-check',
      '--no-input',
      'install',
      '--no-cache-dir',
      '--no-compile',
      '--require-hashes',
      '--only-binary=:all:',
      '--index-url',
      'https://pypi.org/simple',
      '--target',
      join(stage, 'deps'),
      '-r',
      join(source, 'requirements.txt'),
    ],
    stage,
    signal,
  );
  const recipe = JSON.parse(await readFile(join(source, 'db-hub.json'), 'utf8')) as Recipe;
  for (const [file, sha256] of Object.entries(recipe.files)) {
    if (file.startsWith('/') || file.split('/').includes('..'))
      throw problem('Invalid plugin recipe path.');
    const target = join(stage, 'source/usr/plugins/db_hub', file);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(
      target,
      await downloadPinned(
        {
          url: `https://raw.githubusercontent.com/${recipe.repository}/${recipe.commit}/${file}`,
          sha256,
          bytes: 1_000_000,
        },
        signal,
      ),
      { mode: 0o600 },
    );
  }
}

export class NativePlugins {
  private job?: Promise<void>;
  private starting?: Promise<PluginRuntimeState>;
  private controller?: AbortController;
  private failure?: string;
  private busy = new Set<string>();
  constructor(
    private store: Store,
    private mcp: McpConnections,
    private installer = installPluginRuntime,
    private source = workerSource,
  ) {}
  private async material() {
    const digest = createHash('sha256');
    for (const name of bundleFiles)
      digest.update(name).update(await readFile(join(this.source, name)));
    const fingerprint = digest.digest('hex');
    return {
      fingerprint,
      directory: join(this.store.dir, 'addons/plugin-worker', fingerprint),
      recipe: JSON.parse(await readFile(join(this.source, 'db-hub.json'), 'utf8')) as Recipe,
    };
  }
  async state(): Promise<PluginRuntimeState> {
    const pins = JSON.parse(await readFile(join(this.source, 'python-runtime.json'), 'utf8'));
    const artifact = pins.platforms[runtimePlatform()] as Artifact | undefined;
    let status: PluginRuntimeState['status'] = !artifact
      ? 'unsupported'
      : this.job
        ? 'installing'
        : this.failure
          ? 'failed'
          : 'not-installed';
    if (artifact && !this.job && !this.failure) {
      const { directory, fingerprint } = await this.material();
      if (existsSync(directory) || existsSync(directory + '.pending')) {
        status = 'interrupted';
        try {
          const receipt = JSON.parse(await readFile(join(directory, 'installed.json'), 'utf8'));
          const check = createHash('sha256');
          for (const name of bundleFiles)
            check.update(name).update(await readFile(join(directory, 'bundle', name)));
          if (
            receipt.fingerprint === fingerprint &&
            check.digest('hex') === fingerprint &&
            existsSync(join(directory, 'python/bin/python3'))
          )
            status = 'ready';
        } catch {
          /* interrupted setup remains visible */
        }
      }
    }
    return {
      status,
      version: `Python ${pins.version} · plugin API 0.1.0`,
      downloadBytes: artifact?.bytes ?? 0,
      ...(this.failure ? { error: this.failure } : {}),
    };
  }
  start(): Promise<PluginRuntimeState> {
    return (this.starting ??= this.beginStart().finally(() => {
      this.starting = undefined;
    }));
  }
  private async beginStart() {
    if (this.job) return this.state();
    if ((await this.state()).status === 'ready') return this.state();
    this.failure = undefined;
    this.controller = new AbortController();
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(10 * 60_000)]);
    this.job = this.install(signal)
      .catch(() => {
        this.failure =
          'Setup did not finish. Retry interrupted downloads. A changed installed runtime needs manual repair; preserve its operation receipts.';
      })
      .finally(() => {
        this.job = undefined;
        this.controller = undefined;
      });
    return this.state();
  }
  private async install(signal: AbortSignal) {
    const { directory, fingerprint, recipe } = await this.material(),
      stage = directory + '.pending';
    await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
    if (existsSync(directory))
      throw problem(
        'An installed runtime has changed. Preserve its receipts and repair the installation before reuse.',
      );
    await rm(stage, { recursive: true, force: true });
    await mkdir(join(stage, 'bundle'), { recursive: true, mode: 0o700 });
    for (const name of bundleFiles)
      await copyFile(join(this.source, name), join(stage, 'bundle', name));
    await this.installer(stage, this.source, signal);
    // Probe the actual dependency imports without any user project or plugin hooks.
    await runWorkerProcess(
      join(stage, 'python/bin/python3'),
      [
        '-I',
        '-B',
        '-c',
        'import sys; sys.path.insert(0,sys.argv[1]); import sqlalchemy,packaging,typing_extensions,greenlet; assert sqlalchemy.__version__ == "2.0.52"',
        join(stage, 'deps'),
      ],
      stage,
      signal,
    );
    signal.throwIfAborted();
    await writeFile(
      join(stage, 'installed.json'),
      JSON.stringify({
        fingerprint,
        plugin: recipe.id,
        commit: recipe.commit,
        installedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    await rename(stage, directory);
  }
  private binding(projectId: string) {
    return this.store.records<Binding>('native-plugin').find((b) => b.projectId === projectId);
  }
  private calls(binding: Binding) {
    return this.mcp
      .calls()
      .filter(
        (c) =>
          c.serverId === binding.serverId ||
          (binding.scopeId && c.scope === digest({ companionScope: binding.scopeId })),
      );
  }
  private bindingPath(projectId: string) {
    return join(this.store.dir, 'plugin-bindings', projectId + '.json');
  }
  async projectState(projectId: string): Promise<NativePluginState> {
    this.store.project(projectId);
    const { recipe } = await this.material(),
      binding = this.binding(projectId);
    const server = binding && this.mcp.list(projectId).find((s) => s.id === binding.serverId);
    return {
      runtime: await this.state(),
      recipe: {
        id: recipe.id,
        version: recipe.version,
        commit: recipe.commit,
        adapterVersion: recipe.adapterVersion,
      },
      ...(binding
        ? {
            binding: {
              database: binding.database,
              serverId: binding.serverId,
              enabled: !!server?.enabled,
            },
          }
        : {}),
      unresolved: binding
        ? this.calls(binding)
            .filter((c) => ['running', 'unknown'].includes(c.status))
            .map((c) => ({ id: c.id, status: c.status }))
        : [],
    };
  }
  private async writeBinding(projectId: string, database: string, enabled: boolean) {
    let installationId = this.store.meta('plugin-worker:installation');
    if (!installationId) {
      installationId = randomUUID();
      this.store.setMeta('plugin-worker:installation', installationId);
    }
    const path = this.bindingPath(projectId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = path + '.' + randomUUID() + '.tmp';
    await writeFile(
      temp,
      JSON.stringify({
        projectId,
        installationId,
        projectRoot: this.store.project(projectId).root,
        database,
        enabled,
      }),
      { mode: 0o600 },
    );
    await rename(temp, path);
  }
  async configure(projectId: string, raw: unknown) {
    const { database, acknowledgeHostExecution } = z
      .object({
        database: z.string().trim().min(1).max(2048),
        acknowledgeHostExecution: z.literal(true),
      })
      .strict()
      .parse(raw);
    if (this.busy.has(projectId))
      throw problem('Plugin setup is already running for this project.');
    this.busy.add(projectId);
    try {
      if ((await this.state()).status !== 'ready')
        throw problem('Install the optional plugin runtime first.');
      if ((await this.projectState(projectId)).unresolved.length)
        throw problem('Review unfinished plugin operations before changing its configuration.');
      const { target } = await workspacePath(this.store.project(projectId).root, database);
      if (!(await stat(target)).isFile())
        throw problem('Choose an existing SQLite database in this project.');
      const { directory } = await this.material();
      let binding = this.binding(projectId);
      if (binding && this.mcp.list(projectId).some((s) => s.id === binding?.serverId)) {
        if (binding.root !== directory)
          throw problem(
            'This connection uses an older worker revision. Disable and remove it in Skills & MCP before connecting the new runtime; receipts are retained.',
          );
        this.mcp.configure(projectId, binding.serverId, false, []);
      } else {
        const server = await this.mcp.add(projectId, {
          name: 'DB Hub · SLIM plugin worker',
          transport: 'stdio',
          command: join(directory, 'python/bin/python3'),
          args: [
            '-I',
            '-B',
            join(directory, 'bundle/worker.py'),
            '--root',
            directory,
            '--binding',
            this.bindingPath(projectId),
          ],
          acknowledgeHostExecution,
        });
        binding = { id: projectId, projectId, database, serverId: server.id, root: directory };
      }
      await this.writeBinding(projectId, database, true);
      this.store.record('native-plugin', { ...binding, database });
      try {
        const server = await this.mcp.discover(projectId, binding.serverId);
        const descriptor = server.tools[0] && companionDescriptor(server.tools[0]);
        if (!descriptor) throw problem('The native plugin identity is missing.');
        this.store.record('native-plugin', { ...binding, database, scopeId: descriptor.scopeId });
        this.mcp.configure(
          projectId,
          server.id,
          true,
          server.tools.map((t) => t.name),
        );
      } catch {
        await this.writeBinding(projectId, database, false);
        throw problem(
          'DB Hub could not load this database or its pinned runtime. Check the file and retry setup.',
        );
      }
      return this.projectState(projectId);
    } finally {
      this.busy.delete(projectId);
    }
  }
  async disable(projectId: string) {
    const binding = this.binding(projectId);
    if (!binding) return this.projectState(projectId);
    if (this.busy.has(projectId)) throw problem('Wait for plugin setup to finish.');
    this.busy.add(projectId);
    try {
      this.mcp.configure(projectId, binding.serverId, false, []);
      await this.writeBinding(projectId, binding.database, false);
      return this.projectState(projectId);
    } finally {
      this.busy.delete(projectId);
    }
  }
  async reconcile(projectId: string, raw: unknown) {
    const { operationId, resolution } = z
      .object({ operationId: z.string().uuid(), resolution: z.string().trim().min(10).max(2000) })
      .strict()
      .parse(raw);
    const binding = this.binding(projectId);
    const call = binding && this.calls(binding).find((c) => c.id === operationId);
    if (!binding || call?.status !== 'unknown')
      throw problem('Choose an unknown operation belonging to this plugin.');
    const command = join(binding.root, 'python/bin/python3'),
      base = [
        '-I',
        '-B',
        join(binding.root, 'bundle/worker.py'),
        '--root',
        binding.root,
        '--binding',
        this.bindingPath(projectId),
      ];
    const signal = AbortSignal.timeout(20_000);
    const receipt = JSON.parse(
      await runWorkerProcess(command, [...base, '--inspect', operationId], binding.root, signal),
    );
    if (receipt && ['running', 'unknown'].includes(receipt.status))
      await runWorkerProcess(
        command,
        [...base, '--resolve', operationId, '--reason', resolution],
        binding.root,
        signal,
      );
    this.mcp.resolve(call.projectId, operationId, 'resolve', resolution);
    return this.projectState(projectId);
  }
  async close() {
    await this.starting;
    this.controller?.abort();
    await this.job;
  }
}
