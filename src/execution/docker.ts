import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FxAgentHostTool } from 'libfx';
import type { Store } from '../storage/store.js';
import { AppError } from '../domain.js';
import { sandboxSizing } from './settings.js';
const execute = promisify(execFile);
export const dockerImage =
  'node@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1';
export const dockerBashImage =
  'node@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d';
type Command = (
  args: string[],
  options?: { timeout?: number; signal?: AbortSignal },
) => Promise<{ stdout: string; stderr: string }>;
const command: Command = async (args, options) => {
  const env = { ...process.env };
  if (args[0] === '--host')
    for (const key of Object.keys(env)) if (key.startsWith('DOCKER_')) delete env[key];
  return execute('docker', args, {
    ...options,
    timeout: options?.timeout ?? 10_000,
    maxBuffer: 128 * 1024,
    env,
  });
};
const supervisor = `const{spawnSync}=require('node:child_process');const r=spawnSync(process.execPath,['-e',process.argv[1]],{input:process.argv[2],timeout:5000,killSignal:'SIGKILL',maxBuffer:65536});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error)process.stderr.write('Sandbox execution limit reached.');process.exitCode=typeof r.status==='number'?r.status:124;`;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export class DockerSandbox {
  private active = false;
  get busy() {
    return this.active;
  }
  constructor(
    private store: Store,
    private runCommand: Command = command,
  ) {}
  private async endpoint() {
    const result = await this.runCommand([
      'context',
      'inspect',
      '--format',
      '{{json .Endpoints.docker.Host}}',
    ]);
    const host = JSON.parse(result.stdout);
    if (typeof host !== 'string' || !host.startsWith('unix:///') || host.includes('\0'))
      throw new AppError(
        400,
        'local_engine_required',
        'Choose a local Unix-socket Docker context. Remote Docker hosts are not supported.',
      );
    return host;
  }
  async availability() {
    try {
      const host = await this.endpoint();
      const version = await this.runCommand([
        '--host',
        host,
        'version',
        '--format',
        '{{.Server.Version}}',
      ]);
      await this.runCommand([
        '--host',
        host,
        'image',
        'inspect',
        dockerImage,
        '--format',
        '{{.Id}}',
      ]);
      return { available: true, version: version.stdout.trim(), image: dockerImage };
    } catch {
      return {
        available: false,
        message: `Start a local Docker-compatible engine and install the pinned Node image: docker pull ${dockerImage}`,
      };
    }
  }
  async bashAvailability() {
    try {
      const host = await this.endpoint();
      await this.runCommand([
        '--host',
        host,
        'image',
        'inspect',
        dockerBashImage,
        '--format',
        '{{.Id}}',
      ]);
      return { available: true, image: dockerBashImage };
    } catch {
      return {
        available: false,
        image: dockerBashImage,
        message: `Install Bash support: docker pull ${dockerBashImage}`,
      };
    }
  }
  private async remove(receipt: Record<string, unknown> & { id: string }) {
    if (
      typeof receipt.host !== 'string' ||
      !receipt.host.startsWith('unix:///') ||
      typeof receipt.environmentId !== 'string'
    )
      throw new Error('Invalid local resource identity.');
    const args = ['--host', receipt.host],
      name = receipt.environmentId;
    const listed = (
      await this.runCommand([
        ...args,
        'container',
        'ls',
        '--all',
        '--quiet',
        '--filter',
        `name=^/${name}$`,
      ])
    ).stdout.trim();
    if (!listed) {
      receipt.cleanup = 'removed';
      return;
    }
    const info = JSON.parse(
      (await this.runCommand([...args, 'container', 'inspect', name])).stdout,
    )[0];
    if (
      info.Config?.Labels?.['io.a0-slim.operation'] !== receipt.id ||
      info.Config?.Labels?.['io.a0-slim.host'] !== this.store.meta('host_id')
    )
      throw new Error('Container ownership did not match.');
    await this.runCommand([...args, 'container', 'rm', '--force', name]);
    const remaining = (
      await this.runCommand([
        ...args,
        'container',
        'ls',
        '--all',
        '--quiet',
        '--filter',
        `name=^/${name}$`,
      ])
    ).stdout.trim();
    if (remaining) throw new Error('Container removal was not confirmed.');
    receipt.cleanup = 'removed';
  }
  async reconcile(id: string) {
    if (this.active)
      throw new AppError(409, 'sandbox_busy', 'Wait for the local sandbox to finish.');
    const receipt = this.store
      .receipts()
      .find((r) => r.id === id && r.kind === 'docker-sandbox') as
      (Record<string, unknown> & { id: string }) | undefined;
    if (!receipt) throw new AppError(404, 'receipt_missing', 'Local sandbox receipt not found.');
    if (receipt.cleanup !== 'unknown') return receipt;
    this.active = true;
    try {
      await this.remove(receipt);
      receipt.reconciledAt = new Date().toISOString();
      delete receipt.reconcileMessage;
    } catch {
      receipt.reconcileMessage =
        'Could not confirm removal of this exact container. Inspect it in your local engine before repeating the operation.';
    } finally {
      this.store.receipt(receipt);
      this.active = false;
    }
    return receipt;
  }
  async run(
    code: string,
    input: string = '',
    options: { callKey?: string; projectId?: string; signal?: AbortSignal; bash?: boolean } = {},
  ) {
    if (Buffer.byteLength(code) > 32 * 1024 || Buffer.byteLength(input) > 64 * 1024)
      throw new AppError(413, 'sandbox_input', 'Use at most 32 KiB of code and 64 KiB of input.');
    if (this.active)
      throw new AppError(409, 'sandbox_busy', 'One local sandbox may run at a time.');
    if (this.store.receipts().some((r) => r.kind === 'docker-sandbox' && r.cleanup === 'unknown'))
      throw new AppError(
        409,
        'sandbox_unreconciled',
        'Reconcile the interrupted local container before starting another.',
      );
    const image = options.bash ? dockerBashImage : dockerImage;
    const digest = hash(JSON.stringify({ code, input, ...(options.bash ? { image } : {}) }));
    const key = options.callKey ? `docker-call:${hash(options.callKey)}` : undefined;
    const previousId = key ? this.store.meta(key) : undefined;
    if (previousId) {
      const previous = this.store.receipts().find((r) => r.id === previousId)!;
      if (previous.digest !== digest)
        throw new AppError(409, 'action_changed', 'A repeated code call changed its input.');
      return previous;
    }
    const sizing = sandboxSizing(this.store, 'docker');
    this.active = true;
    const receipt: Record<string, unknown> & { id: string } = {
      id: randomUUID(),
      kind: 'docker-sandbox',
      startedAt: new Date().toISOString(),
      status: 'pending',
      cleanup: 'not_created',
      digest,
      projectId: options.projectId,
      image,
      sizing,
    };
    let created = false;
    try {
      options.signal?.throwIfAborted();
      receipt.host = await this.endpoint();
      receipt.environmentId = `a0-slim-${receipt.id}`;
      const base = ['--host', String(receipt.host)];
      await this.runCommand([...base, 'image', 'inspect', image, '--format', '{{.Id}}']);
      receipt.cleanup = 'unknown';
      this.store.receipt(receipt);
      if (key) this.store.setMeta(key, receipt.id);
      await this.runCommand(
        [
          ...base,
          'create',
          '--name',
          String(receipt.environmentId),
          '--label',
          `io.a0-slim.operation=${receipt.id}`,
          '--label',
          `io.a0-slim.host=${this.store.meta('host_id')}`,
          '--network',
          'none',
          '--read-only',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          '--pids-limit',
          '64',
          '--memory',
          `${sizing.memoryMiB}m`,
          '--memory-swap',
          `${sizing.memoryMiB}m`,
          '--cpus',
          String(sizing.vcpus),
          '--user',
          '65534:65534',
          '--tmpfs',
          '/work:rw,noexec,nosuid,size=16m,mode=1777',
          '--workdir',
          '/work',
          '--entrypoint',
          'node',
          image,
          '-e',
          options.bash ? supervisor.replace('timeout:5000', 'timeout:32000') : supervisor,
          code,
          input,
        ],
        { signal: options.signal },
      );
      created = true;
      const result = await this.runCommand(
        [...base, 'start', '--attach', String(receipt.environmentId)],
        { timeout: options.bash ? 35_000 : 12_000, signal: options.signal },
      );
      const state = JSON.parse(
        (
          await this.runCommand([
            ...base,
            'container',
            'inspect',
            String(receipt.environmentId),
            '--format',
            '{{json .State}}',
          ])
        ).stdout,
      );
      receipt.output = result.stdout;
      receipt.stderr = result.stderr;
      receipt.exitCode = state.ExitCode;
      receipt.status = state.Running === false && state.ExitCode === 0 ? 'passed' : 'failed';
      if (receipt.status === 'failed')
        receipt.message = 'The sandbox process failed or reached its execution limits.';
    } catch (error) {
      receipt.status = 'failed';
      receipt.message =
        error instanceof AppError
          ? error.message
          : 'Local execution failed, was cancelled, or exceeded its limits. Review the cleanup receipt.';
    } finally {
      if (created) {
        try {
          await this.remove(receipt);
        } catch {
          receipt.cleanup = 'unknown';
        }
      }
      receipt.finishedAt = new Date().toISOString();
      this.store.receipt(receipt);
      this.active = false;
    }
    return receipt;
  }
  async proof() {
    const receipt = await this.run(
      "process.stdout.write(require('node:fs').readFileSync(0,'utf8').toUpperCase())",
      'A0 SLIM synthetic local sandbox proof\n',
    );
    if (
      receipt.status === 'passed' &&
      receipt.output !== 'A0 SLIM SYNTHETIC LOCAL SANDBOX PROOF\n'
    ) {
      receipt.status = 'failed';
      receipt.message = 'Synthetic output did not match.';
      this.store.receipt(receipt as { id: string });
    }
    return receipt;
  }
  tool(projectId: string): FxAgentHostTool {
    return {
      name: 'run_javascript',
      description:
        'Run Node.js in a disposable local container using the resources selected in Environments. No network, no host files, no credentials. Pass optional stdin text as input. Limits: 5 seconds and 64 KiB output. Use write_file to stage any returned artifact for approval.',
      inputSchema: {
        type: 'object',
        properties: { code: { type: 'string' }, input: { type: 'string' } },
        required: ['code'],
        additionalProperties: false,
      },
      idempotent: true,
      writes: true,
      execute: async (value, context) => {
        const parsed = z
          .object({ code: z.string().min(1).max(32768), input: z.string().max(65536).default('') })
          .strict()
          .parse(value);
        const messageId = (context.context as { messageId?: string } | undefined)?.messageId;
        if (!messageId)
          throw new AppError(409, 'scope_missing', 'Code execution requires an owning chat turn.');
        const receipt = await this.run(parsed.code, parsed.input, {
          projectId,
          callKey: `${context.sessionId}:${messageId}:${context.executionId}`,
          signal: context.signal,
        });
        return {
          receiptId: receipt.id,
          status: receipt.status,
          cleanup: receipt.cleanup,
          output: receipt.output ?? '',
          stderr: receipt.stderr ?? '',
          message: receipt.message ?? '',
        };
      },
    };
  }
}
