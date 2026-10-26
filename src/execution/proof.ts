import { randomUUID } from 'node:crypto';
import { Sandbox } from '@vercel/sandbox';
import type { Store } from '../storage/store.js';
import type { Vault } from '../providers/vault.js';
import { AppError } from '../domain.js';

export type SandboxCredentials = { token: string; teamId: string; projectId: string };
type ProofSandbox = Pick<
  Sandbox,
  'name' | 'writeFiles' | 'runCommand' | 'readFileToBuffer' | 'stop'
>;
type RecoverableSandbox = Pick<Sandbox, 'name' | 'status' | 'tags' | 'stop' | 'delete'>;
type Getter = (options: Parameters<typeof Sandbox.get>[0]) => Promise<RecoverableSandbox>;
type Factory = (options: Parameters<typeof Sandbox.create>[0]) => Promise<ProofSandbox>;
/** A bounded synthetic probe; it never uploads the user's project or model credentials. */
export class SandboxProof {
  private running = false;
  constructor(
    private store: Store,
    private vault: Vault,
    private create: Factory = (options) => Sandbox.create(options),
    private get: Getter = (options) => Sandbox.get(options),
  ) {}
  async reconcile(id: string) {
    if (this.running)
      throw new AppError(409, 'proof_running', 'A sandbox check is already running.');
    const receipt = this.store
      .receipts()
      .find((r) => r.id === id && r.kind === 'vercel-sandbox-proof');
    if (!receipt || typeof receipt.environmentId !== 'string')
      throw new AppError(404, 'receipt_missing', 'Sandbox receipt not found.');
    if (receipt.cleanup !== 'unknown' && receipt.cleanup !== 'stopped') return receipt;
    this.running = true;
    try {
      const credentials = await this.vault.get<SandboxCredentials>('sandbox:vercel');
      const scope = receipt.scope as { teamId: string; projectId: string } | undefined;
      if (
        !credentials ||
        !scope ||
        credentials.teamId !== scope.teamId ||
        credentials.projectId !== scope.projectId
      )
        throw new AppError(
          409,
          'sandbox_scope',
          'Reconnect the original Vercel team and project to reconcile this resource.',
        );
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
      receipt.reconcileMessage =
        error instanceof AppError
          ? error.message
          : 'Remote cleanup could not be confirmed. Recheck this exact environment in Vercel; no new resource was created.';
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
        'A previous sandbox outcome is unknown. Use Recheck and stop to reconcile it before creating another sandbox.',
      );
    this.running = true;
    let sandbox: ProofSandbox | undefined;
    const receipt: Record<string, unknown> & { id: string } = {
      id: randomUUID(),
      kind: 'vercel-sandbox-proof',
      startedAt: new Date().toISOString(),
      status: 'pending',
      cleanup: 'not_created',
    };
    try {
      const credentials = await this.vault.get<SandboxCredentials>('sandbox:vercel');
      if (!credentials)
        throw new AppError(400, 'sandbox_missing', 'Save a Vercel Sandbox connection first.');
      receipt.scope = { teamId: credentials.teamId, projectId: credentials.projectId };
      receipt.environmentId = `a0-slim-${receipt.id}`;
      this.store.receipt(receipt);
      // Persist intent before creation. A failed response may still have created a resource.
      receipt.cleanup = 'unknown';
      this.store.receipt(receipt);
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
      receipt.message =
        error instanceof AppError
          ? error.message
          : 'Sandbox check failed. Review the environment in Vercel before retrying.';
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
