import { createHash, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../domain.js';
import { installAddonDependencies, type AddonInstaller } from '../memory/embedding-addon.js';

const here = dirname(fileURLToPath(import.meta.url));
export const microsandboxSource = resolve(
  here,
  here.endsWith(`${sep}src${sep}execution`)
    ? '../../addons/microsandbox'
    : '../../../addons/microsandbox',
);
const files = ['package.json', 'npm-shrinkwrap.json', 'worker.mjs', 'runtime.json'];
export type MicroRequest = {
  action: 'probe' | 'prepare' | 'run' | 'cleanup';
  name?: string;
  sandboxId?: string;
  receiptId?: string;
  hostId?: string;
  bash?: boolean;
  code?: string;
  input?: string;
  runtimeId?: string;
};
export type MicroResult = {
  version?: string;
  imageReady?: boolean;
  absent?: boolean;
  observedId?: string | null;
  output?: string;
  stderr?: string;
  exitCode?: number;
  runtimeId?: string;
};
export type MicroRunner = (
  directory: string,
  home: string,
  request: MicroRequest,
  signal?: AbortSignal,
  created?: (id: string) => void,
) => Promise<MicroResult>;
// macOS Unix sockets have a 104-byte path limit. Keep the SDK's durable home short,
// isolated by SLIM data directory, and outside temporary/install staging directories.
export const microRuntimeHome = (home: string) =>
  join(homedir(), '.a0-msb', createHash('sha256').update(resolve(home)).digest('hex').slice(0, 16));
export const microWorker: MicroRunner = async (directory, home, request, signal, created) => {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const temporary = join(home, 'tmp');
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  const runtimeHome = microRuntimeHome(home);
  for (const dir of [dirname(runtimeHome), runtimeHome]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const info = await lstat(dir);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (process.getuid && info.uid !== process.getuid()) ||
      info.mode & 0o077
    )
      throw Error('Microsandbox storage must be a private directory owned by this user.');
  }
  const marker = join(runtimeHome, '.slim-runtime-id');
  if (request.action === 'prepare') {
    try {
      await writeFile(marker, randomUUID(), { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  const runtimeId = await readFile(marker, 'utf8');
  if (['run', 'cleanup'].includes(request.action) && !request.runtimeId)
    throw Error(
      'This operation has no recorded runtime identity. Recovery cannot select another runtime.',
    );
  if (request.runtimeId && request.runtimeId !== runtimeId)
    throw Error(
      'Microsandbox storage identity changed. Restore the original runtime directory for recovery.',
    );
  const timeout = AbortSignal.timeout(
    request.action === 'prepare' ? 540_000 : request.action === 'run' ? 90_000 : 30_000,
  );
  const abort = signal ? AbortSignal.any([timeout, signal]) : timeout;
  abort.throwIfAborted();
  return new Promise((resolve, reject) => {
    let result: MicroResult | undefined,
      failure: Error | undefined,
      identitySeen = false;
    const child = fork(join(directory, 'worker.mjs'), [], {
      execPath: process.execPath,
      execArgv: [],
      cwd: home,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      signal: abort,
      killSignal: 'SIGKILL',
      env: {
        PATH: dirname(process.execPath) + ':/usr/bin:/bin',
        HOME: home,
        TMPDIR: temporary,
        MSB_HOME: runtimeHome,
        MSB_BACKEND: 'local',
      },
    });
    const stop = () => {
      // Setup may be pulling an image through an SDK CLI child. Stop that process
      // group too, so cancellation cannot leave a downloader writing during retry.
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= error as Error;
        }
      } else child.kill('SIGKILL');
    };
    abort.addEventListener('abort', stop, { once: true });
    if (abort.aborted) stop();
    child.on('message', (message: any) => {
      try {
        if (message.phase === 'created') {
          if (
            request.action !== 'run' ||
            identitySeen ||
            typeof message.sandboxId !== 'string' ||
            !message.sandboxId ||
            message.sandboxId.length > 128
          )
            throw Error('Invalid sandbox identity response.');
          identitySeen = true;
          created?.(message.sandboxId);
          abort.throwIfAborted();
          child.send({ action: 'execute' });
        } else if (message.error) failure = new Error(String(message.error).slice(0, 400));
        else if (message.result) result = message.result;
      } catch (e) {
        failure = e as Error;
        stop();
      }
    });
    child.once('error', (e) => {
      failure = e;
    });
    // Do not release the lease until the worker is gone. A timeout never establishes VM cleanup.
    child.once('close', (code) => {
      abort.removeEventListener('abort', stop);
      if (failure || code !== 0 || !result || abort.aborted)
        reject(failure ?? new Error('Microsandbox worker stopped. Check its recovery receipt.'));
      else resolve({ ...result, runtimeId });
    });
    child.send(request, (error) => {
      if (error) {
        failure = error;
        stop();
      }
    });
  });
};

export class MicrosandboxAddon {
  readonly directory: string;
  readonly home: string;
  private stage: string;
  private job?: Promise<void>;
  private controller?: AbortController;
  private error?: string;
  constructor(
    dataDir: string,
    readonly runner: MicroRunner = microWorker,
    private installer: AddonInstaller = installAddonDependencies,
    private source = microsandboxSource,
  ) {
    this.directory = join(dataDir, 'addons', 'microsandbox');
    this.stage = this.directory + '.pending';
    this.home = join(dataDir, 'microsandbox');
  }
  async fingerprint(directory = this.source) {
    const hash = createHash('sha256');
    for (const name of files) hash.update(name).update(await readFile(join(directory, name)));
    return hash.digest('hex');
  }
  async state() {
    let recoveryAvailable = false;
    let status:
      'not-installed' | 'installing' | 'installed' | 'update-required' | 'interrupted' | 'failed' =
      this.job ? 'installing' : this.error ? 'failed' : 'not-installed';
    if (!this.job && !this.error) {
      try {
        const receipt = JSON.parse(await readFile(join(this.directory, 'installed.json'), 'utf8'));
        const pkg = JSON.parse(
          await readFile(join(this.directory, 'node_modules/microsandbox/package.json'), 'utf8'),
        );
        recoveryAvailable =
          receipt.fingerprint === (await this.fingerprint(this.directory)) &&
          pkg.version === '0.7.11';
        status = !recoveryAvailable
          ? 'interrupted'
          : receipt.fingerprint === (await this.fingerprint())
            ? 'installed'
            : 'update-required';
      } catch {
        if (existsSync(this.directory) || existsSync(this.stage)) status = 'interrupted';
      }
    }
    return {
      status,
      recoveryAvailable,
      version: '0.7.11',
      location: this.directory,
      runtimeHome: microRuntimeHome(this.home),
      error: this.error ?? null,
      supported:
        (process.platform === 'darwin' && process.arch === 'arm64') ||
        (process.platform === 'linux' && ['arm64', 'x64'].includes(process.arch)),
    };
  }
  async requireInstalled() {
    if ((await this.state()).status !== 'installed')
      throw new AppError(
        409,
        'microsandbox_missing',
        'Install the optional Microsandbox runtime in Environments first.',
      );
  }
  async start() {
    if (this.job)
      throw new AppError(409, 'microsandbox_busy', 'Microsandbox setup is already running.');
    if (!(await this.state()).supported)
      throw new AppError(
        409,
        'microsandbox_platform',
        'This add-on supports Apple Silicon macOS and Linux x64/arm64 with KVM.',
      );
    this.error = undefined;
    this.controller = new AbortController();
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(600_000)]);
    this.job = this.install(signal)
      .catch((e) => {
        this.error = signal.aborted
          ? 'Setup interrupted. Retry installation.'
          : String(e.message ?? e).slice(0, 400);
      })
      .finally(() => {
        this.job = undefined;
        this.controller = undefined;
      });
  }
  private async install(signal: AbortSignal) {
    await mkdir(dirname(this.directory), { recursive: true, mode: 0o700 });
    await rm(this.stage, { recursive: true, force: true });
    await mkdir(this.stage, { mode: 0o700 });
    for (const name of files) await copyFile(join(this.source, name), join(this.stage, name));
    await this.installer(this.stage, signal);
    const result = await this.runner(this.stage, this.home, { action: 'prepare' }, signal);
    if (result.version !== '0.7.11' || !result.imageReady)
      throw Error('Runtime or pinned image verification failed.');
    signal.throwIfAborted();
    await writeFile(
      join(this.stage, 'installed.json'),
      JSON.stringify({
        fingerprint: await this.fingerprint(),
        installedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    await rm(this.directory, { recursive: true, force: true });
    await rename(this.stage, this.directory);
  }
  async call(request: MicroRequest, signal?: AbortSignal, created?: (id: string) => void) {
    if (request.action === 'cleanup') {
      if (!(await this.state()).recoveryAvailable)
        throw Error(
          'The installed runtime failed integrity checks. Restore its original files before recovery.',
        );
    } else await this.requireInstalled();
    return this.runner(this.directory, this.home, request, signal, created);
  }
  async settled() {
    await this.job;
  }
  async close() {
    this.controller?.abort();
    await this.job;
  }
  async remove() {
    await this.close();
    await rm(this.directory, { recursive: true, force: true });
    await rm(this.stage, { recursive: true, force: true });
    // VM records and the image cache are retained for inspection/reinstallation.
    this.error = undefined;
  }
}
