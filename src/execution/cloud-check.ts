import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../domain.js';
import type { Store } from '../storage/store.js';
import type { Vault } from '../providers/vault.js';

export const cloudKeyCredentials = z
  .object({ apiKey: z.string().trim().min(1).max(8192) })
  .strict();
export type CloudKeyCredentials = z.infer<typeof cloudKeyCredentials>;
export type CloudIdentity = { id: string; metadata: Record<string, string> };
export interface CloudCheckDriver {
  create(name: string, metadata: Record<string, string>): Promise<CloudIdentity>;
  get(id: string): Promise<CloudIdentity | null>;
  find(name: string, metadata: Record<string, string>): Promise<CloudIdentity[]>;
  execute(id: string): Promise<string>;
  destroy(id: string): Promise<void>;
  close(): Promise<void>;
}
export async function bounded<T>(work: Promise<T>, ms = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Cloud request timed out.')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
type Receipt = Record<string, unknown> & { id: string };
const scope = (key: string) => createHash('sha256').update(key).digest('hex');

/** Synthetic checks only. Persist creation intent before sending any resource request. */
export class CloudCheck {
  private running = false;
  constructor(
    private provider: 'e2b' | 'daytona',
    private store: Store,
    private vault: Vault,
    private factory: (credentials: CloudKeyCredentials) => CloudCheckDriver,
  ) {}
  private get kind() {
    return `${this.provider}-sandbox-proof`;
  }
  private metadata(receipt: Receipt) {
    return { app: 'a0-slim', proof: receipt.id, host: this.store.meta('host_id')! };
  }
  private owns(resource: CloudIdentity, receipt: Receipt) {
    if (
      (receipt.resourceId && resource.id !== receipt.resourceId) ||
      Object.entries(this.metadata(receipt)).some(([k, v]) => resource.metadata[k] !== v)
    )
      throw new Error('Sandbox ownership did not match.');
  }
  private async cleanup(driver: CloudCheckDriver, receipt: Receipt) {
    let resource: CloudIdentity | null;
    if (typeof receipt.resourceId === 'string') {
      resource = await bounded(driver.get(receipt.resourceId));
      if (!resource) {
        receipt.cleanup = 'deleted';
        return;
      }
    } else {
      const matches = await bounded(
        driver.find(String(receipt.environmentId), this.metadata(receipt)),
      );
      // An empty list after a lost create response is not proof that creation never happened.
      if (matches.length !== 1) throw new Error('Creation outcome is still unknown.');
      resource = matches[0]!;
    }
    this.owns(resource, receipt);
    receipt.resourceId = resource.id;
    this.store.receipt(receipt);
    await bounded(driver.destroy(resource.id));
    if (await bounded(driver.get(resource.id))) throw new Error('Deletion unconfirmed.');
    receipt.cleanup = 'deleted';
  }
  private lock() {
    if (this.running)
      throw new AppError(409, 'proof_running', 'A check for this provider is already running.');
    this.running = true;
  }
  async run() {
    if (this.store.receipts().some((r) => r.kind === this.kind && r.cleanup === 'unknown'))
      throw new AppError(
        409,
        'sandbox_unreconciled',
        'Reconcile the previous sandbox before creating another.',
      );
    this.lock();
    const receipt: Receipt = {
      id: randomUUID(),
      kind: this.kind,
      startedAt: new Date().toISOString(),
      status: 'pending',
      cleanup: 'not_created',
    };
    let driver: CloudCheckDriver | undefined;
    try {
      const credentials = await this.vault.get<CloudKeyCredentials>(`sandbox:${this.provider}`);
      if (!credentials)
        throw new AppError(400, 'sandbox_missing', 'Save a connection for this provider first.');
      driver = this.factory(credentials);
      receipt.scope = scope(credentials.apiKey);
      receipt.environmentId = `a0-slim-${receipt.id}`;
      receipt.cleanup = 'unknown';
      this.store.receipt(receipt);
      const resource = await bounded(
        driver.create(String(receipt.environmentId), this.metadata(receipt)),
        35000,
      );
      this.owns(resource, receipt);
      receipt.resourceId = resource.id;
      this.store.receipt(receipt);
      const output = await bounded(driver.execute(resource.id));
      if (output !== 'A0 SLIM SYNTHETIC SANDBOX PROOF\n')
        throw new Error('Synthetic artifact did not match.');
      receipt.artifact = output;
      receipt.status = 'passed';
    } catch (error) {
      receipt.status = 'failed';
      receipt.message =
        error instanceof AppError
          ? error.message
          : 'Sandbox check failed. Review its cleanup receipt and provider dashboard before retrying.';
    } finally {
      if (driver && receipt.resourceId) {
        try {
          await this.cleanup(driver, receipt);
        } catch {
          receipt.cleanup = 'unknown';
        }
      }
      await driver?.close().catch(() => {});
      receipt.finishedAt = new Date().toISOString();
      this.store.receipt(receipt);
      this.running = false;
    }
    return receipt;
  }
  async reconcile(id: string) {
    const receipt = this.store.receipts().find((r) => r.id === id && r.kind === this.kind) as
      Receipt | undefined;
    if (!receipt) throw new AppError(404, 'receipt_missing', 'Sandbox receipt not found.');
    if (receipt.cleanup !== 'unknown') return receipt;
    this.lock();
    let driver: CloudCheckDriver | undefined;
    try {
      const credentials = await this.vault.get<CloudKeyCredentials>(`sandbox:${this.provider}`);
      if (!credentials || scope(credentials.apiKey) !== receipt.scope)
        throw new AppError(
          409,
          'sandbox_scope',
          'Reconnect the original API key before reconciling this sandbox.',
        );
      driver = this.factory(credentials);
      await this.cleanup(driver, receipt);
      receipt.reconciledAt = new Date().toISOString();
      delete receipt.reconcileMessage;
    } catch (error) {
      receipt.reconcileMessage =
        error instanceof AppError
          ? error.message
          : 'Cleanup is still unconfirmed. Check this exact sandbox in your provider dashboard; no replacement was created.';
    } finally {
      await driver?.close().catch(() => {});
      this.store.receipt(receipt);
      this.running = false;
    }
    return receipt;
  }
}
