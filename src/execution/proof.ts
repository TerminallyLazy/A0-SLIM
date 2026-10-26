import { randomUUID } from 'node:crypto';
import { Sandbox } from '@vercel/sandbox';
import type { Store } from '../storage/store.js';
import type { Vault } from '../providers/vault.js';
import { AppError } from '../domain.js';
import { verifyVercelScope, vercelFailure, type SandboxCredentials } from './vercel-auth.js';

export type { SandboxCredentials } from './vercel-auth.js';
type ProofSandbox = Pick<
  Sandbox,
  'name' | 'writeFiles' | 'runCommand' | 'readFileToBuffer' | 'stop'
>;
type RecoverableSandbox = Pick<Sandbox, 'name' | 'status' | 'tags' | 'stop' | 'delete'>;
type Getter = (options: Parameters<typeof Sandbox.get>[0]) => Promise<RecoverableSandbox>;
type Factory = (options: Parameters<typeof Sandbox.create>[0]) => Promise<ProofSandbox>;
type Receipt = Record<string, unknown> & { id: string };
type AbsenceCheck = (credentials: SandboxCredentials, receipt: Receipt) => Promise<void>;
async function verifyAbsent(credentials: SandboxCredentials, receipt: Receipt) {
  const pages = await Sandbox.list({ ...credentials, signal: AbortSignal.timeout(15_000) });
  let count = 0;
  for await (const page of pages.pages()) {
    if (++count > 20)
      throw new AppError(
        409,
        'sandbox_review',
        'The sandbox listing is too large to verify absence. Contact the provider before resolving this check.',
      );
    if (
      page.sandboxes.some((s) => s.name === receipt.environmentId || s.tags?.proof === receipt.id)
    )
      throw new AppError(
        409,
        'sandbox_review',
        'A matching sandbox still exists. Use Recheck & clean up.',
      );
  }
}
/** A bounded synthetic probe; it never uploads the user's project or model credentials. */
export class SandboxProof {
  private running = false;
  get busy() {
    return this.running;
  }
  constructor(
    private store: Store,
    private vault: Vault,
    private create: Factory = (options) => Sandbox.create(options),
    private get: Getter = (options) => Sandbox.get(options),
    private verify = verifyVercelScope,
    private absence: AbsenceCheck = verifyAbsent,
  ) {}
  private async credentials(receipt?: Receipt) {
    const saved = await this.vault.get<SandboxCredentials>('sandbox:vercel');
    if (!saved)
      throw new AppError(400, 'sandbox_missing', 'Save a Vercel Sandbox connection first.');
    const credentials = await this.verify(saved);
    if (receipt) {
      const scope = receipt.scope as { teamId: string; projectId: string } | undefined;
      if (!scope || scope.projectId !== credentials.projectId)
        throw new AppError(
          409,
          'sandbox_scope',
          'Reconnect the original Vercel team and project to reconcile this resource.',
        );
      const original =
        scope.teamId === credentials.teamId
          ? credentials
          : await this.verify({ ...saved, ...scope });
      if (original.teamId !== credentials.teamId)
        throw new AppError(
          409,
          'sandbox_scope',
          'Reconnect the original Vercel team and project to reconcile this resource.',
        );
      receipt.verifiedScope = { teamId: credentials.teamId, projectId: credentials.projectId };
    }
    return credentials;
  }
  async reviewAbsence(id: string, resolution: string) {
    if (this.running)
      throw new AppError(409, 'proof_running', 'A sandbox check is already running.');
    const receipt = this.store
      .receipts()
      .find((r) => r.id === id && r.kind === 'vercel-sandbox-proof') as Receipt | undefined;
    if (!receipt || typeof receipt.environmentId !== 'string')
      throw new AppError(404, 'receipt_missing', 'Sandbox receipt not found.');
    if (receipt.cleanup !== 'unknown')
      throw new AppError(409, 'sandbox_review', 'Only an unknown outcome needs a provider review.');
    if (resolution.trim().length < 20 || resolution.length > 2000)
      throw new AppError(
        400,
        'sandbox_review',
        'Describe the provider review in at least 20 characters.',
      );
    if (
      !Number.isFinite(Date.parse(String(receipt.startedAt))) ||
      Date.now() - Date.parse(String(receipt.startedAt)) < 60_000
    )
      throw new AppError(
        409,
        'sandbox_review',
        'Wait until the original 60-second lifetime has elapsed before reviewing absence.',
      );
    this.running = true;
    try {
      const credentials = await this.credentials(receipt);
      try {
        await this.get({
          ...credentials,
          name: receipt.environmentId,
          resume: false,
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        if ((error as { response?: Response }).response?.status !== 404) throw error;
        await this.absence(credentials, receipt);
        receipt.cleanup = 'reviewed_absent';
        receipt.resolution = resolution.trim();
        receipt.reconciledAt = new Date().toISOString();
        receipt.resolutionEvidence =
          'Verified project ownership, exact-name 404 and complete project sandbox listing; explicit operator review.';
        delete receipt.reconcileMessage;
        this.store.receipt(receipt);
        return receipt;
      }
      throw new AppError(
        409,
        'sandbox_review',
        'This sandbox still exists. Use Recheck & clean up.',
      );
    } catch (error) {
      throw new AppError(409, 'sandbox_review', vercelFailure(error));
    } finally {
      this.running = false;
    }
  }
  async reconcile(id: string) {
    if (this.running)
      throw new AppError(409, 'proof_running', 'A sandbox check is already running.');
    const receipt = this.store
      .receipts()
      .find((r) => r.id === id && r.kind === 'vercel-sandbox-proof') as Receipt | undefined;
    if (!receipt || typeof receipt.environmentId !== 'string')
      throw new AppError(404, 'receipt_missing', 'Sandbox receipt not found.');
    if (receipt.cleanup !== 'unknown' && receipt.cleanup !== 'stopped') return receipt;
    this.running = true;
    try {
      const credentials = await this.credentials(receipt);
      let sandbox: RecoverableSandbox;
      try {
        sandbox = await this.get({
          ...credentials,
          name: receipt.environmentId,
          resume: false,
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        if (
          receipt.deletionConfirmed === true &&
          (error as { response?: Response }).response?.status === 404
        ) {
          receipt.cleanup = 'deleted';
          receipt.reconciledAt = new Date().toISOString();
          delete receipt.reconcileMessage;
          this.store.receipt(receipt as { id: string });
          return receipt;
        }
        throw error;
      }
      if (
        sandbox.name !== receipt.environmentId ||
        sandbox.tags?.proof !== receipt.id ||
        sandbox.tags?.app !== 'a0-slim'
      )
        throw new AppError(
          409,
          'sandbox_identity',
          'The remote resource did not match this application’s receipt.',
        );
      const stopped =
        sandbox.status === 'stopped'
          ? { status: 'stopped' }
          : await sandbox.stop({ signal: AbortSignal.timeout(15_000) });
      receipt.stopStatus = stopped.status;
      if (stopped.status !== 'stopped') throw new Error('Stop remains unconfirmed.');
      receipt.cleanup = 'stopped';
      this.store.receipt(receipt as { id: string });
      await sandbox.delete({ deleteOrphanSnapshots: true, signal: AbortSignal.timeout(15_000) });
      receipt.deletionConfirmed = true;
      this.store.receipt(receipt as { id: string });
      try {
        await this.get({
          ...credentials,
          name: receipt.environmentId,
          resume: false,
          signal: AbortSignal.timeout(15_000),
        });
      } catch (error) {
        if ((error as { response?: Response }).response?.status === 404)
          receipt.cleanup = 'deleted';
        else throw error;
      }
      delete receipt.reconcileMessage;
      receipt.reconciledAt = new Date().toISOString();
      this.store.receipt(receipt as { id: string });
      return receipt;
    } catch (error) {
      receipt.reconcileMessage = vercelFailure(error);
      this.store.receipt(receipt as { id: string });
      return receipt;
    } finally {
      this.running = false;
    }
  }
  async run() {
    if (this.running)
      throw new AppError(409, 'proof_running', 'A sandbox check is already running.');
    if (
      this.store
        .receipts()
        .some((receipt) => receipt.kind === 'vercel-sandbox-proof' && receipt.cleanup === 'unknown')
    )
      throw new AppError(
        409,
        'sandbox_unreconciled',
        'A previous sandbox outcome is unknown. Use Recheck & clean up, or record a provider review if the resource is absent, to reconcile it before creating another sandbox.',
      );
    this.running = true;
    let sandbox: ProofSandbox | undefined;
    const receipt: Record<string, unknown> & { id: string } = {
      id: randomUUID(),
      kind: 'vercel-sandbox-proof',
      startedAt: new Date().toISOString(),
      status: 'pending',
      cleanup: 'not_created',
      connectionRevision: this.store.meta('sandbox:vercel:revision'),
    };
    try {
      const credentials = await this.credentials();
      receipt.scope = { teamId: credentials.teamId, projectId: credentials.projectId };
      receipt.environmentId = `a0-slim-${receipt.id}`;
      this.store.receipt(receipt);
      // Persist intent before creation. A failed response may still have created a resource.
      receipt.cleanup = 'unknown';
      this.store.receipt(receipt);
      let dispatched = false;
      sandbox = await this.create({
        ...credentials,
        name: String(receipt.environmentId),
        timeout: 60_000,
        persistent: false,
        networkPolicy: 'deny-all',
        ports: [],
        resources: { vcpus: 1 },
        tags: { app: 'a0-slim', proof: receipt.id },
        signal: AbortSignal.timeout(30_000),
        fetch: async (url, init) => {
          if (
            init?.method === 'POST' &&
            /^\/v[23]\/sandboxes$/.test(new URL(String(url)).pathname)
          ) {
            if (dispatched) throw new Error('Sandbox creation will not be retried.');
            dispatched = true;
          }
          return fetch(url, { ...init, redirect: 'error' });
        },
      });
      if (sandbox.name !== receipt.environmentId)
        throw new Error('Sandbox identity did not match creation intent.');
      receipt.creationConfirmed = true;
      this.store.receipt(receipt);
      await sandbox.writeFiles(
        [{ path: 'proof.txt', content: 'A0 SLIM synthetic sandbox proof\n' }],
        { signal: AbortSignal.timeout(10_000) },
      );
      const command = await sandbox.runCommand({
        cmd: 'node',
        args: [
          '-e',
          "const fs=require('node:fs');fs.writeFileSync('result.txt',fs.readFileSync('proof.txt','utf8').toUpperCase())",
        ],
        signal: AbortSignal.timeout(15_000),
      });
      if (command.exitCode !== 0) throw new Error('Synthetic command failed.');
      const result = await sandbox.readFileToBuffer(
        { path: 'result.txt' },
        { signal: AbortSignal.timeout(10_000) },
      );
      if (result?.toString('utf8') !== 'A0 SLIM SYNTHETIC SANDBOX PROOF\n')
        throw new Error('Synthetic artifact did not match.');
      receipt.status = 'passed';
      receipt.artifact = result.toString('utf8');
    } catch (error) {
      receipt.status = 'failed';
      receipt.message = vercelFailure(error);
    } finally {
      if (sandbox) {
        try {
          const stopped = await sandbox.stop({ signal: AbortSignal.timeout(15_000) });
          receipt.cleanup = stopped.status === 'stopped' ? 'stopped' : 'unknown';
          receipt.stopStatus = stopped.status;
        } catch {
          receipt.cleanup = 'unknown';
        }
      }
      receipt.finishedAt = new Date().toISOString();
      this.store.receipt(receipt);
      this.running = false;
    }
    return receipt;
  }
}
