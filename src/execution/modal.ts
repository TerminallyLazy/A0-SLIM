import { createHash, randomUUID } from 'node:crypto';
import { ModalClient, type Sandbox } from 'modal';
import { z } from 'zod';
import type { Store } from '../storage/store.js';
import type { Vault } from '../providers/vault.js';
import { AppError } from '../domain.js';

export const modalCredentials = z
  .object({
    tokenId: z.string().trim().min(1).max(200),
    tokenSecret: z.string().min(1).max(8192),
    appName: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .default('a0-slim'),
    environment: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .default('main'),
  })
  .strict();
type Credentials = z.infer<typeof modalCredentials>;
type Client = Pick<ModalClient, 'apps' | 'images' | 'sandboxes' | 'close'>;
type Resource = Pick<Sandbox, 'sandboxId' | 'getTags' | 'exec' | 'terminate' | 'poll'>;
async function bounded<T>(work: Promise<T>, ms = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Modal request timed out.')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
const scope = (c: Credentials) =>
  createHash('sha256')
    .update(JSON.stringify([c.tokenId, c.appName, c.environment]))
    .digest('hex');
export const createModalClient = (c: Credentials): ModalClient => {
  const client = new ModalClient({
    tokenId: c.tokenId,
    tokenSecret: c.tokenSecret,
    environment: c.environment,
    maxThrottleWaitSecs: 0,
    logLevel: 'error',
  });
  // 0.11.1 exposes an endpoint parameter but resolves its transport from the profile.
  // Reject inherited custom endpoints before issuing any authenticated RPC.
  const endpoint = new URL(client.profile.serverUrl);
  if (
    endpoint.origin !== 'https://api.modal.com' ||
    endpoint.pathname !== '/' ||
    endpoint.search ||
    endpoint.username ||
    endpoint.password
  ) {
    client.close();
    throw new AppError(
      400,
      'modal_endpoint',
      'Remove the custom Modal endpoint override before using this connection.',
    );
  }
  return client;
};

/** Explicit, synthetic-only cloud check. No project bytes or model credentials are uploaded. */
export class ModalProof {
  private running = false;
  constructor(
    private store: Store,
    private vault: Vault,
    private factory: (c: Credentials) => Client = createModalClient,
  ) {}
  private async stop(resource: Resource, receipt: Record<string, unknown> & { id: string }) {
    const tags = await bounded(resource.getTags());
    if (
      tags.app !== 'a0-slim' ||
      tags.proof !== receipt.id ||
      tags.host !== this.store.meta('host_id')
    )
      throw new Error('Resource ownership did not match.');
    const existing = await bounded(resource.poll());
    if (existing === null) await bounded(resource.terminate({ wait: true }));
    if ((await bounded(resource.poll())) === null) throw new Error('Termination unconfirmed.');
    receipt.cleanup = 'terminated';
  }
  async reconcile(id: string) {
    if (this.running) throw new AppError(409, 'proof_running', 'A Modal check is already running.');
    const receipt = this.store
      .receipts()
      .find((r) => r.id === id && r.kind === 'modal-sandbox-proof') as
      (Record<string, unknown> & { id: string }) | undefined;
    if (!receipt) throw new AppError(404, 'receipt_missing', 'Sandbox receipt not found.');
    if (receipt.cleanup !== 'unknown') return receipt;
    this.running = true;
    let client: Client | undefined;
    try {
      const credentials = await this.vault.get<Credentials>('sandbox:modal');
      if (!credentials || scope(credentials) !== receipt.scope)
        throw new AppError(
          409,
          'sandbox_scope',
          'Reconnect the original Modal token ID, app and environment before reconciling.',
        );
      client = this.factory(credentials);
      const sandbox = await bounded(
        client.sandboxes.fromName(credentials.appName, String(receipt.environmentId), {
          environment: credentials.environment,
          includeTerminated: true,
        }),
      );
      if (receipt.resourceId && receipt.resourceId !== sandbox.sandboxId)
        throw new Error('Resource identity changed.');
      await this.stop(sandbox, receipt);
      receipt.reconciledAt = new Date().toISOString();
      delete receipt.reconcileMessage;
    } catch (error) {
      receipt.reconcileMessage =
        error instanceof AppError
          ? error.message
          : 'Modal cleanup could not be confirmed. Check this exact sandbox in your Modal dashboard; no replacement was created.';
    } finally {
      client?.close();
      this.store.receipt(receipt);
      this.running = false;
    }
    return receipt;
  }
  async run() {
    if (this.running) throw new AppError(409, 'proof_running', 'A Modal check is already running.');
    if (
      this.store.receipts().some((r) => r.kind === 'modal-sandbox-proof' && r.cleanup === 'unknown')
    )
      throw new AppError(
        409,
        'sandbox_unreconciled',
        'Reconcile the previous Modal sandbox before creating another.',
      );
    this.running = true;
    const receipt: Record<string, unknown> & { id: string } = {
      id: randomUUID(),
      kind: 'modal-sandbox-proof',
      startedAt: new Date().toISOString(),
      status: 'pending',
      cleanup: 'not_created',
    };
    let client: Client | undefined, sandbox: Resource | undefined;
    try {
      const credentials = await this.vault.get<Credentials>('sandbox:modal');
      if (!credentials)
        throw new AppError(400, 'sandbox_missing', 'Save a Modal connection first.');
      client = this.factory(credentials);
      receipt.scope = scope(credentials);
      receipt.environmentId = `a0-slim-${receipt.id}`;
      const app = await bounded(
        client.apps.fromName(credentials.appName, {
          environment: credentials.environment,
          createIfMissing: true,
        }),
      );
      const image = client.images.fromRegistry('python:3.13-slim');
      receipt.cleanup = 'unknown';
      this.store.receipt(receipt);
      sandbox = await bounded(
        client.sandboxes.create(app, image, {
          name: String(receipt.environmentId),
          tags: { app: 'a0-slim', proof: receipt.id, host: this.store.meta('host_id')! },
          cpu: 0.25,
          cpuLimit: 1,
          memoryMiB: 128,
          memoryLimitMiB: 256,
          timeoutMs: 60000,
          blockNetwork: true,
          encryptedPorts: [],
          h2Ports: [],
          unencryptedPorts: [],
          secrets: [],
          volumes: {},
          cloudBucketMounts: {},
          includeOidcIdentityToken: false,
        }),
        30000,
      );
      receipt.resourceId = sandbox.sandboxId;
      this.store.receipt(receipt);
      const process = await bounded(
        sandbox.exec(
          [
            'python',
            '-c',
            "from pathlib import Path; p=Path('/tmp/a0-slim-proof.txt'); p.write_text('A0 SLIM synthetic Modal proof\\n'); print(p.read_text().upper(), end='')",
          ],
          { timeoutMs: 10000, secrets: [] },
        ),
      );
      const [output, exitCode] = await bounded(
        Promise.all([process.stdout.readText(), process.wait()]),
      );
      if (exitCode !== 0 || output !== 'A0 SLIM SYNTHETIC MODAL PROOF\n')
        throw new Error('Synthetic artifact did not match.');
      receipt.status = 'passed';
      receipt.artifact = output;
    } catch (error) {
      receipt.status = 'failed';
      receipt.message =
        error instanceof AppError
          ? error.message
          : 'Modal check failed. Review the cleanup receipt before retrying.';
    } finally {
      if (sandbox)
        try {
          await this.stop(sandbox, receipt);
        } catch {
          receipt.cleanup = 'unknown';
        }
      client?.close();
      receipt.finishedAt = new Date().toISOString();
      this.store.receipt(receipt);
      this.running = false;
    }
    return receipt;
  }
}
