import { createHash, randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { Sandbox } from '@vercel/sandbox';
import { z } from 'zod';
import type { FxAgentHostTool } from 'libfx';
import { AppError, type Chat } from '../domain.js';
import type { Store } from '../storage/store.js';
import type { Vault } from '../providers/vault.js';
import { SandboxProof, type VercelGetter } from './proof.js';
import { verifyVercelScope, vercelFailure } from './vercel-auth.js';
import { sandboxSizing } from './settings.js';

export type VercelFactory = (
  options: Parameters<typeof Sandbox.create>[0],
) => Promise<Pick<Sandbox, 'name' | 'runCommand'>>;
export type VercelDependencies = {
  create?: VercelFactory;
  get?: VercelGetter;
  verify?: typeof verifyVercelScope;
};
export const vercelLimits = {
  callsPerTurn: 3,
  callsPerWindow: 10,
  windowMs: 600_000,
  codeBytes: 32768,
  inputBytes: 65536,
  outputBytes: 65536,
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const inputSchema = z
  .object({
    code: z.string().min(1).max(vercelLimits.codeBytes),
    input: z.string().max(vercelLimits.inputBytes).default(''),
  })
  .strict();
// The VM lifetime and provider-enforced exec timeout remain the outer limits, even for child processes.
export const vercelSupervisor =
  "const{spawnSync}=require('node:child_process');const r=spawnSync(process.execPath,['--max-old-space-size=128','-e',process.argv[1]],{input:process.argv[2],env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',TMPDIR:'/tmp'},timeout:10000,killSignal:'SIGKILL',maxBuffer:65536});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error)process.stderr.write('Execution limit reached.');process.exitCode=r.error?124:typeof r.status==='number'?r.status:124;";
type Receipt = Record<string, unknown> & { id: string; cleanup: string; status: string };

/** One create and one command per invocation; bounded transport before the SDK parses output. */
export function vercelExecutionFetch(transport: typeof fetch = fetch): typeof fetch {
  const sent = new Set<string>();
  return async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname.replace(/^\/api\//, '/');
    if (
      !(
        (url.origin === 'https://vercel.com' && url.pathname.startsWith('/api/')) ||
        url.origin === 'https://api.vercel.com'
      ) ||
      url.username ||
      url.password
    )
      throw new AppError(403, 'vercel_destination', 'Unexpected Vercel API destination.');
    if (url.searchParams.has('resume') && url.searchParams.get('resume') !== 'false')
      throw new AppError(409, 'vercel_replay', 'Automatic sandbox resume was blocked.');
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method !== 'GET') {
      if (
        method !== 'POST' ||
        !(/^\/v[23]\/sandboxes$/.test(path) || /^\/v2\/sandboxes\/sessions\/[^/]+\/cmd$/.test(path))
      )
        throw new AppError(
          409,
          'vercel_replay',
          'Unexpected sandbox mutation or automatic resume was blocked.',
        );
      const key = method + path;
      if (sent.has(key))
        throw new AppError(
          409,
          'vercel_replay',
          'A sandbox creation or command will not be retried.',
        );
      sent.add(key);
    }
    if (/\/cmd\/[^/]+\/logs$/.test(path))
      throw new AppError(
        409,
        'vercel_output',
        'The command stream was interrupted. Its output will not be replayed automatically.',
      );
    const response = await transport(input, { ...init, redirect: 'error' });
    if (!response.body) return response;
    let bytes = 0;
    const stream = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > 2 * 1024 * 1024)
            throw new AppError(
              413,
              'vercel_output',
              'Vercel response exceeded the transport limit.',
            );
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export class VercelExecution {
  readonly proof: SandboxProof;
  private create: VercelFactory;
  constructor(
    private store: Store,
    vault: Vault,
    dependencies: VercelDependencies = {},
  ) {
    this.proof = new SandboxProof(store, vault, undefined, dependencies.get, dependencies.verify);
    this.create = dependencies.create ?? ((options) => Sandbox.create(options));
  }
  get busy() {
    return this.proof.busy;
  }
  revision() {
    return this.store.meta('sandbox:vercel:revision') ?? 'legacy';
  }
  readiness() {
    const receipts = this.store.receipts();
    const check = receipts.find((r) => r.kind === 'vercel-sandbox-proof');
    const reason =
      this.store.meta('sandbox:vercel') !== 'configured'
        ? 'Save a Vercel connection first.'
        : receipts.some(
              (r) =>
                ['vercel-sandbox-proof', 'vercel-execution'].includes(String(r.kind)) &&
                r.cleanup === 'unknown',
            )
          ? 'Reconcile the unresolved Vercel sandbox before starting another.'
          : check?.status !== 'passed' || (check.connectionRevision ?? 'legacy') !== this.revision()
            ? 'Run the Vercel sandbox test with your current connection first.'
            : null;
    return { available: reason === null, reason, revision: this.revision() };
  }
  authorize(projectId: string) {
    const ready = this.readiness();
    if (!ready.available) throw new AppError(409, 'vercel_not_ready', ready.reason!);
    const project = this.store.project(projectId);
    this.store.saveProject({
      ...project,
      execution: 'vercel',
      vercelGrant: { revision: ready.revision, approvedAt: new Date().toISOString() },
    });
  }
  revoke(projectId: string) {
    const project = this.store.project(projectId);
    this.store.saveProject({
      ...project,
      execution: project.execution === 'vercel' ? 'none' : project.execution,
      vercelGrant: undefined,
    });
  }
  assertAuthorized(chat: Chat) {
    const grant = this.store.project(chat.projectId).vercelGrant;
    if (
      chat.backend === 'acp' ||
      chat.parentChatId ||
      chat.execution !== 'vercel' ||
      !grant ||
      grant.revision !== this.revision() ||
      chat.executionRevision !== grant.revision
    )
      throw new AppError(
        409,
        'vercel_permission',
        'Authorize Vercel cloud usage in Environments and start a new chat. This chat cannot use a changed or revoked connection.',
      );
    const ready = this.readiness();
    if (!ready.available) throw new AppError(409, 'vercel_not_ready', ready.reason!);
  }
  private cached(chatId: string, messageId: string, callId: string, digest: string) {
    const rows = this.store
      .receipts()
      .filter(
        (r) => r.kind === 'vercel-execution' && r.chatId === chatId && r.messageId === messageId,
      );
    const sameCall = rows.find((r) => r.callId === callId);
    if (sameCall && sameCall.digest !== digest)
      throw new AppError(409, 'action_changed', 'A repeated Vercel call changed its input.');
    // A crash can change a runtime execution ID. Identical work in the same turn still never repeats.
    return sameCall ?? rows.find((r) => r.digest === digest);
  }
  async run(
    value: unknown,
    context: {
      projectId: string;
      sessionId: string;
      messageId: string;
      callId: string;
      signal?: AbortSignal;
      bash?: boolean;
    },
  ) {
    const { code, input } = inputSchema.parse(value);
    if (
      Buffer.byteLength(code) > vercelLimits.codeBytes ||
      Buffer.byteLength(input) > vercelLimits.inputBytes
    )
      throw new AppError(413, 'vercel_input', 'Use at most 32 KiB of code and 64 KiB of input.');
    const chat = this.store
      .chats()
      .find((c) => c.projectId === context.projectId && c.sessionId === context.sessionId);
    if (
      !chat ||
      chat.backend === 'acp' ||
      chat.parentChatId ||
      !context.messageId ||
      !context.callId
    )
      throw new AppError(
        409,
        'scope_missing',
        'Vercel execution requires its owning native chat turn.',
      );
    const digest = hash(JSON.stringify({ code, input, ...(context.bash ? { bash: true } : {}) }));
    const cached = this.cached(chat.id, context.messageId, context.callId, digest);
    if (cached) return cached;
    return this.proof.withLease(async () => {
      this.assertAuthorized(chat);
      context.signal?.throwIfAborted();
      const revision = this.revision();
      const sizing = sandboxSizing(this.store, 'vercel');
      const credentials = await this.proof.credentials();
      // Saving settings or revoking a project while auth was in flight must not grant a stale call.
      this.assertAuthorized(chat);
      context.signal?.throwIfAborted();
      if (revision !== this.revision())
        throw new AppError(409, 'vercel_changed', 'The Vercel connection changed.');
      const receipts = this.store.receipts().filter((r) => r.kind === 'vercel-execution');
      if (
        receipts.filter((r) => r.chatId === chat.id && r.messageId === context.messageId).length >=
          vercelLimits.callsPerTurn ||
        receipts.filter((r) => Date.parse(String(r.startedAt)) > Date.now() - vercelLimits.windowMs)
          .length >= vercelLimits.callsPerWindow
      )
        throw new AppError(
          429,
          'vercel_budget',
          'Vercel usage limit reached: three sandboxes per turn and ten across SLIM in ten minutes.',
        );
      const id = randomUUID();
      let receipt: Receipt = {
        id,
        kind: 'vercel-execution',
        status: 'pending',
        cleanup: 'unknown',
        startedAt: new Date().toISOString(),
        projectId: chat.projectId,
        chatId: chat.id,
        messageId: context.messageId,
        callId: context.callId,
        digest,
        connectionRevision: revision,
        scope: { teamId: credentials.teamId, projectId: credentials.projectId },
        environmentId: `a0-slim-${id}`,
        limits: { ...vercelLimits, lifetimeMs: sizing.sessionTimeoutMinutes * 60_000 },
        lifetimeMs: sizing.sessionTimeoutMinutes * 60_000,
        sizing,
        runtime: 'node22',
        tool: context.bash ? 'bash' : 'run_javascript',
        codeBytes: Buffer.byteLength(code),
        inputBytes: Buffer.byteLength(input),
      };
      this.store.receipt(receipt); // Durable creation intent before any remote mutation; code/input stay out of the receipt.
      let sandbox: Awaited<ReturnType<VercelFactory>> | undefined;
      const output: Buffer[] = [],
        stderr: Buffer[] = [];
      let total = 0;
      const abort = new AbortController();
      const signal = AbortSignal.any([abort.signal, ...(context.signal ? [context.signal] : [])]);
      const sink = (chunks: Buffer[]) => {
        const stream = new Writable({
          write(chunk, _encoding, done) {
            const buffer = Buffer.from(chunk);
            total += buffer.byteLength;
            if (total > vercelLimits.outputBytes) {
              abort.abort();
              done(new Error('Output limit reached'));
            } else {
              chunks.push(buffer);
              done();
            }
          },
        });
        stream.on('error', () => abort.abort());
        return stream;
      };
      const stdoutSink = sink(output),
        stderrSink = sink(stderr);
      try {
        sandbox = await this.create({
          ...credentials,
          name: String(receipt.environmentId),
          runtime: 'node22',
          persistent: false,
          timeout: sizing.sessionTimeoutMinutes * 60_000,
          resources: { vcpus: sizing.vcpus },
          networkPolicy: 'deny-all',
          ports: [],
          env: {},
          tags: { app: 'a0-slim', proof: id, host: this.store.meta('host_id')! },
          signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
          fetch: vercelExecutionFetch(),
        });
        if (sandbox.name !== receipt.environmentId) throw new Error('Unexpected sandbox identity');
        receipt.creationConfirmed = true;
        this.store.receipt(receipt);
        this.assertGrantDuringCall(chat, revision);
        signal.throwIfAborted();
        receipt.commandRequestedAt = new Date().toISOString();
        this.store.receipt(receipt);
        const command = await sandbox.runCommand({
          cmd: 'node',
          args: [
            '-e',
            context.bash
              ? vercelSupervisor.replace('timeout:10000', 'timeout:32000')
              : vercelSupervisor,
            code,
            input,
          ],
          cwd: '/vercel/sandbox',
          sudo: false,
          timeoutMs: context.bash ? 35_000 : 12_000,
          stdout: stdoutSink,
          stderr: stderrSink,
          signal: AbortSignal.any([signal, AbortSignal.timeout(context.bash ? 40_000 : 18_000)]),
        });
        signal.throwIfAborted();
        receipt.exitCode = command.exitCode;
        receipt.status = command.exitCode === 0 ? 'passed' : 'failed';
        if (command.exitCode !== 0)
          receipt.message = 'The Vercel process failed or reached its execution limit.';
      } catch (error) {
        receipt.status = 'failed';
        receipt.message =
          total > vercelLimits.outputBytes
            ? 'Vercel output exceeded 64 KiB.'
            : signal.aborted
              ? 'Vercel execution was stopped. Review its cleanup receipt.'
              : vercelFailure(error);
      } finally {
        stdoutSink.destroy();
        stderrSink.destroy();
        receipt.output = Buffer.concat(output).toString('utf8');
        receipt.stderr = Buffer.concat(stderr).toString('utf8');
        this.store.receipt(receipt);
        // Never let cancellation skip remote cleanup. A lost create remains held for explicit discovery.
        if (sandbox) receipt = (await this.proof.reconcileHeld(id)) as Receipt;
        receipt.finishedAt = new Date().toISOString();
        this.store.receipt(receipt);
      }
      return receipt;
    });
  }
  private assertGrantDuringCall(chat: Chat, revision: string) {
    const grant = this.store.project(chat.projectId).vercelGrant;
    if (!grant || grant.revision !== revision || this.revision() !== revision)
      throw new AppError(
        409,
        'vercel_permission',
        'Vercel usage was revoked or the connection changed. No command was sent.',
      );
  }
  tool(projectId: string): FxAgentHostTool {
    return {
      name: 'run_javascript',
      description:
        'Run Node.js in a temporary Vercel sandbox using the session timeout and resources selected in Environments. Code and explicit stdin input go to Vercel and use the account allowance. No automatic project upload, model keys or network access. Limits: 10-second child process, 64 KiB output, 3 calls per turn. Use write_file to propose returned artifacts for local review.',
      inputSchema: {
        type: 'object',
        properties: { code: { type: 'string' }, input: { type: 'string' } },
        required: ['code'],
        additionalProperties: false,
      },
      idempotent: true,
      writes: true,
      execute: async (value, context) => {
        const messageId = (context.context as { messageId?: string } | undefined)?.messageId;
        if (!messageId)
          throw new AppError(409, 'scope_missing', 'Vercel execution requires an owning turn.');
        const receipt = await this.run(value, {
          projectId,
          sessionId: context.sessionId,
          messageId,
          callId: context.executionId,
          signal: context.signal,
        });
        return {
          receiptId: receipt.id,
          status: receipt.status,
          cleanup: receipt.cleanup,
          output: receipt.output ?? '',
          stderr: receipt.stderr ?? '',
          message: receipt.message ?? '',
          cleanupMessage: receipt.reconcileMessage ?? '',
        };
      },
    };
  }
}
