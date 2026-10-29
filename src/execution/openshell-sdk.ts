import { fork } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenShellSaved } from './openshell.js';

const here = dirname(fileURLToPath(import.meta.url));
export const openShellSource = resolve(
  here,
  here.endsWith(`${sep}src${sep}execution`)
    ? '../../addons/openshell'
    : '../../../addons/openshell',
);
export type OpenShellRequest = {
  action: 'inspect' | 'get' | 'create' | 'ready' | 'execute' | 'delete' | 'wait-deleted';
  config: OpenShellSaved;
  name?: string;
  sandboxId?: string;
  labels?: Record<string, string>;
};
export type OpenShellRunner = (
  directory: string,
  request: OpenShellRequest,
  signal: AbortSignal,
) => Promise<unknown>;
export async function openShellAddon(directory: string) {
  try {
    const pkg = JSON.parse(
      await readFile(join(directory, 'node_modules/@nvidia/openshell-sdk/package.json'), 'utf8'),
    );
    return pkg.name === '@nvidia/openshell-sdk' && pkg.version === '0.1.6';
  } catch {
    return false;
  }
}
export const openShellWorker: OpenShellRunner = async (directory, request, signal) => {
  const limits = {
    inspect: 15_000,
    get: 10_000,
    create: 30_000,
    ready: 95_000,
    execute: 40_000,
    delete: 15_000,
    'wait-deleted': 50_000,
  };
  const abort = AbortSignal.any([signal, AbortSignal.timeout(limits[request.action])]);
  abort.throwIfAborted();
  return new Promise((resolve, reject) => {
    let result: unknown,
      failure: Error | undefined,
      received = false;
    const child = fork(join(openShellSource, 'worker.mjs'), [], {
      execPath: process.execPath,
      execArgv: [],
      cwd: directory,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      signal: abort,
      killSignal: 'SIGKILL',
      env: { PATH: dirname(process.execPath), NODE_ENV: 'production' },
    });
    child.on('message', (message: any) => {
      if (received || !message || message.error)
        failure = Error(
          'OpenShell operation failed. Recheck gateway access and the recovery receipt.',
        );
      received = true;
      result = message?.result;
    });
    child.once('error', (error) => {
      failure = error;
    });
    // Wait for process death before releasing the service lock. A timed-out mutation remains unknown.
    child.once('close', (code) => {
      if (failure || abort.aborted || code !== 0 || !received || result === undefined)
        reject(
          Error(
            'OpenShell operation interrupted. Recheck gateway access and the recovery receipt.',
          ),
        );
      else resolve(result);
    });
    child.send({ ...request, directory }, (error) => {
      if (error) {
        failure = error;
        child.kill('SIGKILL');
      }
    });
  });
};
