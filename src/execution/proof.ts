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
type Factory = (options: Parameters<typeof Sandbox.create>[0]) => Promise<ProofSandbox>;
/** A bounded synthetic probe; it never uploads the user's project or model credentials. */
export class SandboxProof {
  private running = false;
  constructor(
    private store: Store,
    private vault: Vault,
    private create: Factory = (options) => Sandbox.create(options),
  ) {}
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
        'A previous sandbox outcome is unknown. Inspect it in Vercel; automatic repetition is disabled until reconciliation is implemented.',
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
      this.store.receipt(receipt);
      // Persist intent before creation. A failed response may still have created a resource.
      receipt.cleanup = 'unknown';
      this.store.receipt(receipt);
      sandbox = await this.create({
        ...credentials,
        timeout: 60_000,
        persistent: false,
        networkPolicy: 'deny-all',
        ports: [],
        resources: { vcpus: 1 },
        tags: { app: 'a0-slim', proof: receipt.id },
        signal: AbortSignal.timeout(30_000),
      });
      receipt.environmentId = sandbox.name;
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
