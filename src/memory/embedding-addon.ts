import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, copyFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../domain.js';

const names = ['package.json', 'npm-shrinkwrap.json', 'worker.mjs'];
// Same relative package root in source and the compiled dist/server/memory directory.
const here = dirname(fileURLToPath(import.meta.url));
export const addonSource = resolve(
  here,
  here.endsWith('/src/memory')
    ? '../../addons/local-embeddings'
    : '../../../addons/local-embeddings',
);
export type AddonState = {
  status: 'not-installed' | 'installing' | 'ready' | 'interrupted' | 'failed';
  error?: string;
  location: string;
  version: string;
};
export type AddonInstaller = (directory: string, signal: AbortSignal) => Promise<void>;

export async function installAddonDependencies(directory: string, signal: AbortSignal) {
  const npm = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ].find((p) => p?.endsWith('npm-cli.js') && existsSync(p));
  if (!npm) throw new Error('npm is unavailable. Install Node 24 with npm, then restart SLIM.');
  const home = join(directory, '.npm-home');
  await mkdir(home, { recursive: true, mode: 0o700 });
  const userconfig = join(home, 'user.npmrc'),
    globalconfig = join(home, 'global.npmrc');
  await writeFile(userconfig, '');
  await writeFile(globalconfig, '');
  try {
    await new Promise<void>((resolve, reject) => {
      // Public pinned registry artifacts only. Do not inherit credentials, registry/proxy overrides or scripts.
      const child = spawn(
        process.execPath,
        [
          npm,
          'ci',
          '--omit=dev',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--registry=https://registry.npmjs.org',
          '--userconfig',
          userconfig,
          '--globalconfig',
          globalconfig,
          '--cache',
          join(home, 'cache'),
        ],
        {
          cwd: directory,
          shell: false,
          signal,
          killSignal: 'SIGKILL',
          stdio: 'ignore',
          env: {
            PATH: dirname(process.execPath) + ':/usr/bin:/bin',
            HOME: home,
            TMPDIR: home,
            NODE_ENV: 'production',
          },
        },
      );
      let failure: Error | undefined;
      child.once('error', (error) => {
        failure = error;
      });
      // Wait for the process to close before deleting its cache, including after cancellation.
      child.once('close', (code) =>
        code === 0 && !failure
          ? resolve()
          : reject(
              failure ??
                new Error(
                  'The optional runtime installation did not finish. Check your connection and retry.',
                ),
            ),
      );
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

export async function probeAddon(path: string, signal?: AbortSignal) {
  // Native libraries may abort their process if a worker is terminated during initialization.
  // Probe in a separate process so cancellation or an incompatible binding cannot stop SLIM.
  const timeout = AbortSignal.timeout(30_000);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
  abort.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    let failure: Error | undefined;
    const child = spawn(process.execPath, [join(path, 'worker.mjs'), '--probe'], {
      cwd: path,
      shell: false,
      signal: abort,
      killSignal: 'SIGKILL',
      stdio: 'ignore',
      env: { PATH: dirname(process.execPath) + ':/usr/bin:/bin' },
    });
    child.once('error', (error) => {
      failure = error;
    });
    child.once('close', (code) =>
      code === 0 && !failure && !abort.aborted
        ? resolve()
        : reject(
            new Error(
              'The local embedding CPU runtime check stopped or could not load on this device. Retry installation.',
            ),
          ),
    );
  });
}

export class EmbeddingAddon {
  readonly directory: string;
  private base: string;
  private job?: Promise<void>;
  private controller?: AbortController;
  private error?: string;
  constructor(
    dataDir: string,
    private installer: AddonInstaller = installAddonDependencies,
    private source = addonSource,
    private probe = probeAddon,
  ) {
    this.base = join(dataDir, 'addons');
    this.directory = join(this.base, 'local-embeddings');
  }
  private async fingerprint() {
    const hash = createHash('sha256');
    for (const name of names) hash.update(name).update(await readFile(join(this.source, name)));
    return hash.digest('hex');
  }
  async status(): Promise<AddonState> {
    let status: AddonState['status'] = this.job
      ? 'installing'
      : this.error
        ? 'failed'
        : 'not-installed';
    if (!this.job && !this.error) {
      try {
        const receipt = JSON.parse(await readFile(join(this.directory, 'installed.json'), 'utf8'));
        const expected = await this.fingerprint();
        const installed = createHash('sha256');
        for (const name of names)
          installed.update(name).update(await readFile(join(this.directory, name)));
        const pkg = JSON.parse(
          await readFile(
            join(this.directory, 'node_modules/@huggingface/transformers/package.json'),
            'utf8',
          ),
        );
        if (
          receipt.fingerprint === expected &&
          installed.digest('hex') === expected &&
          pkg.version === '4.3.1'
        )
          status = 'ready';
        else status = 'interrupted';
      } catch {
        if (existsSync(this.directory) || existsSync(join(this.base, 'local-embeddings.pending')))
          status = 'interrupted';
      }
    }
    return {
      status,
      ...(this.error ? { error: this.error } : {}),
      location: this.directory,
      version: 'Transformers.js 4.3.1 · ONNX Runtime CPU',
    };
  }
  async requireReady() {
    if ((await this.status()).status !== 'ready')
      throw new AppError(
        409,
        'embedding_runtime_missing',
        'Install the optional local embedding runtime in Memory → Embeddings & models first. Lexical memory and hosted embeddings remain available.',
      );
    return join(this.directory, 'worker.mjs');
  }
  start() {
    if (this.job)
      throw new AppError(409, 'addon_busy', 'The local embedding runtime is already installing.');
    this.error = undefined;
    this.controller = new AbortController();
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(10 * 60_000)]);
    this.job = this.install(signal)
      .catch((error) => {
        this.error = signal.aborted
          ? 'Installation stopped. Retry to install the runtime; saved models and memory are unchanged.'
          : error instanceof Error
            ? error.message
            : 'Local embedding runtime installation failed.';
      })
      .finally(() => {
        this.job = undefined;
        this.controller = undefined;
      });
  }
  private async install(signal: AbortSignal) {
    const stage = join(this.base, 'local-embeddings.pending');
    await mkdir(this.base, { recursive: true, mode: 0o700 });
    // Only an explicit new install discards an incomplete staging directory after a crash.
    await rm(stage, { recursive: true, force: true });
    await mkdir(stage, { mode: 0o700 });
    for (const name of names) await copyFile(join(this.source, name), join(stage, name));
    await this.installer(stage, signal);
    signal.throwIfAborted();
    await this.probe(stage, signal);
    signal.throwIfAborted();
    await writeFile(
      join(stage, 'installed.json'),
      JSON.stringify({
        fingerprint: await this.fingerprint(),
        installedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    // Runtime use is serialized by LocalModel; replace only after the new runtime's native probe passes.
    await rm(this.directory, { recursive: true, force: true });
    await rename(stage, this.directory);
  }
  async cancel() {
    this.controller?.abort();
    await this.job;
  }
  async remove() {
    await this.cancel();
    await rm(this.directory, { recursive: true, force: true });
    await rm(join(this.base, 'local-embeddings.pending'), { recursive: true, force: true });
    this.error = undefined;
  }
  async settled() {
    await this.job;
  }
  async close() {
    await this.cancel();
  }
}
