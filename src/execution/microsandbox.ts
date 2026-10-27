import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FxAgentHostTool } from 'libfx';
import { AppError } from '../domain.js';
import type { Store } from '../storage/store.js';
import { MicrosandboxAddon } from './microsandbox-addon.js';

const now = () => new Date().toISOString();
const fail = (message: string) => new AppError(409, 'microsandbox', message);
const schema = z
  .object({ code: z.string().max(32768), input: z.string().max(65536).default('') })
  .strict();
export const microProofCode = `const fs=require('node:fs');fs.writeFileSync('/tmp/a0-synthetic.txt','A0 SLIM MICROSANDBOX CHECK');console.log(fs.readFileSync('/tmp/a0-synthetic.txt','utf8'));`;
export type MicroReceipt = {
  id: string;
  kind: 'microsandbox-proof' | 'microsandbox-execution';
  status: 'pending' | 'passed' | 'failed' | 'interrupted';
  cleanup: 'unknown' | 'deleted';
  name: string;
  hostId: string;
  sandboxId?: string;
  revision: string;
  runtimeId: string;
  startedAt: string;
  finishedAt?: string;
  commandRequestedAt?: string;
  message?: string;
  cleanupMessage?: string;
  output?: string;
  stderr?: string;
  exitCode?: number;
  chatId?: string;
  messageId?: string;
  callId?: string;
  digest?: string;
};
export class Microsandbox {
  readonly addon: MicrosandboxAddon;
  private active = false;
  private closing = false;
  private controller?: AbortController;
  private job?: Promise<unknown>;
  private connection?: {
    revision: string;
    checkedAt: string;
    passed: boolean;
    message?: string;
    runtimeId?: string;
  };
  constructor(
    private store: Store,
    addon?: MicrosandboxAddon,
  ) {
    this.addon = addon ?? new MicrosandboxAddon(store.dir);
    for (const r of this.receipts())
      if (r.status === 'pending')
        this.save({
          ...r,
          status: 'interrupted',
          message: 'SLIM restarted during this operation. Recheck and remove the sandbox.',
        });
  }
  private receipts() {
    return this.store
      .receipts()
      .filter((r) =>
        ['microsandbox-proof', 'microsandbox-execution'].includes(String(r.kind)),
      ) as MicroReceipt[];
  }
  private save(r: MicroReceipt) {
    this.store.receipt(r);
  }
  private holds() {
    return this.receipts().filter((r) => r.cleanup === 'unknown');
  }
  async state() {
    const runtime = await this.addon.state(),
      revision = await this.addon.fingerprint();
    const check = this.receipts().find((r) => r.kind === 'microsandbox-proof');
    const reason =
      runtime.status !== 'installed'
        ? 'Install the optional runtime and image first.'
        : this.holds().length
          ? 'Recheck and remove the unresolved sandbox first.'
          : !this.connection?.passed || this.connection.revision !== revision
            ? 'Check the local runtime.'
            : check?.status !== 'passed' ||
                check.revision !== revision ||
                check.cleanup !== 'deleted'
              ? 'Run the local sandbox check.'
              : null;
    return {
      runtime,
      revision,
      available: reason === null && !this.closing,
      reason,
      activity: this.active ? 'working' : this.holds().length ? 'unknown' : 'idle',
      connection: this.connection ?? null,
      receipts: this.receipts(),
    };
  }
  private async lease<T>(work: () => Promise<T>): Promise<T> {
    if (this.active || this.closing || (await this.addon.state()).status === 'installing')
      throw fail('A Microsandbox action is already in progress.');
    // Recheck after the asynchronous add-on read.
    if (this.active || this.closing) throw fail('A Microsandbox action is already in progress.');
    this.active = true;
    try {
      return await work();
    } finally {
      this.active = false;
    }
  }
  async install() {
    return this.lease(async () => {
      if (this.holds().length)
        throw fail('Resolve uncertain sandboxes before changing the runtime.');
      this.connection = undefined;
      await this.addon.start();
      return this.state();
    });
  }
  async cancelSetup() {
    if (this.active) throw fail('A sandbox action is in progress.');
    await this.addon.close();
    return this.state();
  }
  async remove() {
    return this.lease(async () => {
      if (this.holds().length)
        throw fail('Resolve uncertain sandboxes before removing the runtime.');
      await this.addon.remove();
      this.connection = undefined;
      return this.state();
    });
  }
  private async checkHeld() {
    const revision = await this.addon.fingerprint();
    try {
      const result = await this.addon.call({ action: 'probe' });
      if (result.version !== '0.7.11' || !result.imageReady || !result.runtimeId)
        throw Error('The pinned runtime or image is unavailable. Retry setup.');
      this.connection = { revision, checkedAt: now(), passed: true, runtimeId: result.runtimeId };
    } catch (error) {
      this.connection = {
        revision,
        checkedAt: now(),
        passed: false,
        message: String((error as Error).message),
      };
      throw error;
    }
  }
  async check() {
    return this.lease(async () => {
      await this.checkHeld();
      return this.state();
    });
  }
  async assertReady() {
    const state = await this.state();
    if (!state.available) throw fail(state.reason ?? 'Microsandbox is unavailable.');
    return state.revision;
  }
  private async cleanup(receipt: MicroReceipt) {
    try {
      const result = await this.addon.call({
        action: 'cleanup',
        name: receipt.name,
        sandboxId: receipt.sandboxId,
        receiptId: receipt.id,
        hostId: receipt.hostId,
        runtimeId: receipt.runtimeId,
      });
      // A lookup miss after a lost creation response never proves that creation failed.
      if (!result.absent || (!receipt.sandboxId && !result.observedId))
        throw Error(
          'Creation was not confirmed and no owned sandbox was found. The recovery hold remains.',
        );
      if (result.observedId && receipt.sandboxId && result.observedId !== receipt.sandboxId)
        throw Error('Sandbox identity changed.');
      receipt.sandboxId ??= result.observedId ?? undefined;
      receipt.cleanup = 'deleted';
      receipt.cleanupMessage = 'Sandbox deletion verified.';
    } catch (e) {
      receipt.cleanup = 'unknown';
      receipt.cleanupMessage = String((e as Error).message).slice(0, 400);
    }
    this.save(receipt);
  }
  async reconcile(id: string) {
    return this.lease(async () => {
      const receipt = this.receipts().find((r) => r.id === id);
      if (!receipt || receipt.cleanup !== 'unknown')
        throw fail('No unresolved Microsandbox receipt was found.');
      if (receipt.hostId !== this.store.meta('host_id'))
        throw fail('Recovery must use the original SLIM host.');
      await this.cleanup(receipt);
      return receipt;
    });
  }
  async reviewAbsence(id: string, resolution: string) {
    return this.lease(async () => {
      const receipt = this.receipts().find((r) => r.id === id);
      if (
        !receipt ||
        receipt.cleanup !== 'unknown' ||
        receipt.sandboxId ||
        receipt.hostId !== this.store.meta('host_id')
      )
        throw fail('This receipt is not eligible for an absence review.');
      if (Date.now() - Date.parse(receipt.startedAt) < 120_000)
        throw fail(
          'Wait until the creation and VM lifetime limits have expired before reviewing absence.',
        );
      const result = await this.addon.call({
        action: 'cleanup',
        name: receipt.name,
        receiptId: receipt.id,
        hostId: receipt.hostId,
        runtimeId: receipt.runtimeId,
      });
      if (!result.absent || result.observedId)
        throw fail('An owned sandbox was found. Recheck its cleanup receipt.');
      this.store.record('microsandbox-absence-review', {
        id: randomUUID(),
        receiptId: id,
        reviewedAt: now(),
        resolution,
      });
      receipt.cleanup = 'deleted';
      receipt.cleanupMessage =
        'Absence reviewed by the user after the lifetime limit; creation outcome remains unknown.';
      this.save(receipt);
      return receipt;
    });
  }
  private cached(chatId: string, messageId: string, callId: string, digest: string) {
    const rows = this.receipts().filter((r) => r.chatId === chatId && r.messageId === messageId);
    const exact = rows.find((r) => r.callId === callId);
    if (exact && exact.digest !== digest) throw fail('A repeated code call changed its input.');
    return exact ?? rows.find((r) => r.digest === digest);
  }
  async proof() {
    return this.lease(async () => {
      if (this.holds().length)
        throw fail('Reconcile the previous sandbox before creating another.');
      await this.checkHeld();
      return this.execute(microProofCode, '', { kind: 'microsandbox-proof' });
    });
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
    const { code, input } = schema.parse(value);
    if (Buffer.byteLength(code) > 32768 || Buffer.byteLength(input) > 65536)
      throw fail('Use at most 32 KiB of code and 64 KiB of input.');
    const chat = this.store
      .chats()
      .find((c) => c.projectId === context.projectId && c.sessionId === context.sessionId);
    if (
      !chat ||
      chat.backend === 'acp' ||
      chat.parentChatId ||
      chat.execution !== 'microsandbox' ||
      !context.messageId ||
      !context.callId
    )
      throw fail('Microsandbox execution requires its owning native chat turn.');
    const digest = createHash('sha256')
      .update(JSON.stringify({ code, input, ...(context.bash ? { bash: true } : {}) }))
      .digest('hex');
    const cached = this.cached(chat.id, context.messageId, context.callId, digest);
    if (cached) return cached;
    return this.lease(async () => {
      const cached = this.cached(chat.id, context.messageId, context.callId, digest);
      if (cached) return cached;
      const revision = await this.assertReady();
      if (chat.executionRevision !== revision)
        throw fail('The runtime changed. Run its check and start a new chat.');
      if (
        this.receipts().filter((r) => r.chatId === chat.id && r.messageId === context.messageId)
          .length >= 3
      )
        throw fail('Three code calls per turn are allowed.');
      context.signal?.throwIfAborted();
      return this.execute(
        code,
        input,
        {
          kind: 'microsandbox-execution',
          chatId: chat.id,
          messageId: context.messageId,
          callId: context.callId,
          digest,
        },
        context.signal,
        context.bash,
      );
    });
  }
  private async execute(
    code: string,
    input: string,
    fields: Pick<MicroReceipt, 'kind' | 'chatId' | 'messageId' | 'callId' | 'digest'>,
    signal?: AbortSignal,
    bash = false,
  ) {
    const id = randomUUID(),
      receipt: MicroReceipt = {
        ...fields,
        id,
        name: `a0-slim-${id}`,
        status: 'pending',
        cleanup: 'unknown',
        hostId: this.store.meta('host_id')!,
        runtimeId: this.connection!.runtimeId!,
        revision: await this.addon.fingerprint(),
        startedAt: now(),
      };
    this.save(receipt); // Creation intent is durable before spawning any worker.
    this.controller = new AbortController();
    const abort = signal
      ? AbortSignal.any([signal, this.controller.signal])
      : this.controller.signal;
    this.job = (async () => {
      try {
        const result = await this.addon.call(
          {
            action: 'run',
            name: receipt.name,
            receiptId: id,
            hostId: receipt.hostId,
            runtimeId: receipt.runtimeId,
            code,
            input,
            bash,
          },
          abort,
          (sandboxId) => {
            receipt.sandboxId = sandboxId;
            receipt.commandRequestedAt = now();
            this.save(receipt);
          },
        );
        if (
          !receipt.sandboxId ||
          typeof result.output !== 'string' ||
          typeof result.stderr !== 'string' ||
          !Number.isInteger(result.exitCode) ||
          Buffer.byteLength(result.output) + Buffer.byteLength(result.stderr) > 65536
        )
          throw Error('Invalid or oversized sandbox response.');
        receipt.output = result.output;
        receipt.stderr = result.stderr;
        receipt.exitCode = result.exitCode;
        receipt.status =
          result.exitCode === 0 &&
          (fields.kind !== 'microsandbox-proof' || result.output === 'A0 SLIM MICROSANDBOX CHECK\n')
            ? 'passed'
            : 'failed';
        if (receipt.status === 'failed')
          receipt.message = 'The command failed or reached its execution limit.';
      } catch (e) {
        receipt.status = 'failed';
        receipt.message = abort.aborted
          ? 'Execution stopped. Inspect cleanup before retrying.'
          : String((e as Error).message).slice(0, 400);
      } finally {
        this.save(receipt);
        await this.cleanup(receipt); // Cancellation never cancels cleanup or implies success.
        receipt.finishedAt = now();
        this.save(receipt);
      }
    })();
    try {
      await this.job;
    } finally {
      this.job = undefined;
      this.controller = undefined;
    }
    return receipt;
  }
  tool(projectId: string): FxAgentHostTool {
    return {
      name: 'run_javascript',
      description:
        'Run Node.js in a disposable local Microsandbox microVM. No Docker, network, host folder mounts or model credentials. Pass explicit text input. Limits: 5 seconds for code, 512 MiB VM, 64 KiB output, three calls per turn. Use write_file to propose local artifacts for review.',
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
        if (!messageId) throw fail('Code execution requires an owning turn.');
        const r = await this.run(value, {
          projectId,
          sessionId: context.sessionId,
          messageId,
          callId: context.executionId,
          signal: context.signal,
        });
        return {
          receiptId: r.id,
          status: r.status,
          cleanup: r.cleanup,
          output: r.output ?? '',
          stderr: r.stderr ?? '',
          message: r.message ?? '',
          cleanupMessage: r.cleanupMessage ?? '',
        };
      },
    };
  }
  async close() {
    this.closing = true;
    this.controller?.abort();
    await this.job;
    await this.addon.close();
  }
}
export type MicrosandboxState = Awaited<ReturnType<Microsandbox['state']>>;
