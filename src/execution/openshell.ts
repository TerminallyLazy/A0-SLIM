import { createHash, randomUUID, X509Certificate, createPrivateKey } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from '../domain.js';
import type { Store } from '../storage/store.js';
import type { Vault } from '../providers/vault.js';
import {
  openShellAddon,
  openShellWorker,
  type OpenShellRunner,
  type OpenShellRequest,
} from './openshell-sdk.js';

const error = (text: string) => new AppError(409, 'openshell', text);
const now = () => new Date().toISOString();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function openShellOrigin(value: string) {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw error('Enter a valid OpenShell gateway origin.');
  }
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== '/'
  )
    throw error(
      'Use an HTTPS gateway origin without a path, credentials, query or fragment. TLS verification is required.',
    );
  return u.origin;
}
const configSchema = z
  .object({
    gateway: z.string().max(2048).transform(openShellOrigin),
    workspace: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}$/),
    image: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9./_:@-]+$/),
    auth: z.enum(['mtls', 'oidc']),
    caCert: z.string().max(32768).optional(),
    clearCa: z.boolean().optional(),
    clientCert: z.string().max(32768).optional(),
    clientKey: z.string().max(32768).optional(),
    token: z
      .string()
      .max(8192)
      .regex(/^[\x21-\x7e]*$/)
      .optional(),
  })
  .strict();
export type OpenShellConfig = {
  gateway: string;
  workspace: string;
  image: string;
  auth: 'mtls' | 'oidc';
  revision: string;
  caFingerprint: string;
  hasCa: boolean;
  hasCredentials: boolean;
};
export type OpenShellSaved = OpenShellConfig & {
  caCert: string;
  clientCert: string;
  clientKey: string;
  token: string;
};
const inspectionSchema = z.object({
  health: z.enum(['healthy', 'failed']),
  authentication: z.enum(['verified', 'unchecked', 'unsupported', 'failed']),
  access: z.enum(['verified', 'unchecked', 'failed']),
  version: z
    .string()
    .regex(/^v?\d+\.\d+\.\d+$|^unknown$/)
    .optional(),
  principal: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
type Inspection = z.infer<typeof inspectionSchema>;
type Check = Inspection & {
  id: string;
  revision: string;
  checkedAt: string;
  passed: boolean;
  message: string;
};
const refSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/),
  name: z.string().max(128),
  workspace: z.string().max(128),
  phase: z.string().max(40),
  labels: z.record(z.string().max(64), z.string().max(128)),
});
type Ref = z.infer<typeof refSchema>;
const kind = 'openshell-sandbox-proof';
export type OpenShellReceipt = {
  id: string;
  kind: typeof kind;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'passed' | 'failed' | 'interrupted';
  cleanup: 'not_created' | 'unknown' | 'deleted' | 'reviewed_absent';
  config: OpenShellConfig;
  principal?: string;
  name: string;
  labels: Record<string, string>;
  sandboxId?: string;
  createIntentAt?: string;
  executeIntentAt?: string;
  deleteIntentAt?: string;
  deletionOutcome?: string;
  deletionSandboxId?: string;
  identityConflict?: boolean;
  outputVerified?: boolean;
  cleanupVerifiedAt?: string;
  message?: string;
  recoveryMessage?: string;
  reviewedAt?: string;
  resolution?: string;
};
const publicConfig = (c: OpenShellSaved): OpenShellConfig => {
  const { caCert: _ca, clientCert: _cert, clientKey: _key, token: _token, ...safe } = c;
  return safe;
};
const safeMessage = (e: unknown) =>
  e instanceof AppError && e.code === 'openshell'
    ? e.message
    : 'OpenShell did not complete the operation. Check gateway access and the recovery receipt.';

export class OpenShellProof {
  readonly directory: string;
  private locked = false;
  private closing = false;
  private job?: Promise<void>;
  private controller?: AbortController;
  private idle = Promise.resolve();
  private release?: () => void;
  constructor(
    private store: Store,
    private vault: Vault,
    private runner: OpenShellRunner = openShellWorker,
    private installed: (directory: string) => Promise<boolean> = openShellAddon,
  ) {
    this.directory = join(store.dir, 'addons', 'openshell');
    for (const r of this.receipts())
      if (r.status === 'running') {
        r.status = 'interrupted';
        r.finishedAt = now();
        r.message =
          'SLIM restarted during the check. Recheck its recovery receipt before creating another sandbox.';
        this.persist(r);
      }
  }
  receipts() {
    return this.store.receipts().filter((r) => r.kind === kind) as OpenShellReceipt[];
  }
  async state() {
    const config =
      this.store.records<OpenShellConfig & { id: string }>('openshell-config')[0] ?? null;
    const check = this.store.records<Check>('openshell-check')[0] ?? null;
    const receipts = this.receipts();
    const sdkInstalled = await this.installed(this.directory);
    return {
      config,
      check,
      receipts,
      busy: this.locked,
      addon: { installed: sdkInstalled, version: '0.1.6', directory: this.directory },
      status: {
        connection: !config
          ? 'not_configured'
          : !sdkInstalled
            ? 'sdk_missing'
            : !check
              ? 'unchecked'
              : check.revision !== config.revision
                ? 'changed'
                : Date.now() - Date.parse(check.checkedAt) > 600_000
                  ? 'stale'
                  : check.passed
                    ? 'verified'
                    : 'failed',
        activity: this.locked
          ? 'working'
          : receipts.some((r) => r.cleanup === 'unknown')
            ? 'unknown'
            : 'idle',
        execution: 'synthetic_only',
        // Historical proof is never a claim that a sandbox is currently connected.
        activeSandbox: null,
      },
    };
  }
  private persist(r: OpenShellReceipt) {
    this.store.receipt(r);
  }
  private lock() {
    if (this.locked || this.closing) throw error('An OpenShell action is already in progress.');
    this.locked = true;
    this.idle = new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }
  async save(input: unknown) {
    this.lock();
    try {
      const p = configSchema.parse(input);
      const old = await this.vault.get<OpenShellSaved>('sandbox:openshell');
      const same = old?.gateway === p.gateway && old.auth === p.auth;
      const caCert = p.clearCa
        ? ''
        : p.caCert?.trim() || (old?.gateway === p.gateway ? old.caCert : '') || '';
      const clientCert =
        p.auth === 'mtls' ? p.clientCert?.trim() || (same ? old!.clientCert : '') : '';
      const clientKey =
        p.auth === 'mtls' ? p.clientKey?.trim() || (same ? old!.clientKey : '') : '';
      const token = p.auth === 'oidc' ? p.token || (same ? old!.token : '') : '';
      if ((p.auth === 'oidc' && !token) || (p.auth === 'mtls' && (!clientCert || !clientKey)))
        throw error('Enter credentials for this gateway and authentication method.');
      try {
        if (caCert) new X509Certificate(caCert);
        if (
          p.auth === 'mtls' &&
          !new X509Certificate(clientCert).checkPrivateKey(createPrivateKey(clientKey))
        )
          throw Error('pair');
      } catch {
        throw error(
          'The PEM certificates or private key are invalid, or the client certificate and key do not match.',
        );
      }
      const fields = {
        gateway: p.gateway,
        workspace: p.workspace,
        image: p.image,
        auth: p.auth,
        caCert,
        clientCert,
        clientKey,
        token,
        hasCa: !!caCert,
        hasCredentials: true,
        caFingerprint: hash(caCert),
      };
      const { revision: _r, ...previous } = old ?? { revision: '' };
      const revision =
        old && JSON.stringify(previous) === JSON.stringify(fields) ? old.revision : randomUUID();
      const next = { ...fields, revision };
      await this.vault.set('sandbox:openshell', next);
      this.store.record('openshell-config', { id: 'current', ...publicConfig(next) });
      return await this.state();
    } finally {
      this.unlock();
    }
  }
  private async saved() {
    const c = await this.vault.get<OpenShellSaved>('sandbox:openshell');
    if (!c) throw error('Save an OpenShell connection first.');
    if (!(await this.installed(this.directory)))
      throw error(
        'Install the optional OpenShell SDK 0.1.6 in the displayed add-on directory first.',
      );
    return c;
  }
  private call(
    c: OpenShellSaved,
    action: OpenShellRequest['action'],
    signal: AbortSignal,
    r?: OpenShellReceipt,
  ) {
    signal.throwIfAborted();
    return this.runner(
      this.directory,
      {
        action,
        config: c,
        ...(r ? { name: r.name, sandboxId: r.sandboxId, labels: r.labels } : {}),
      },
      signal,
    );
  }
  private async inspect(c: OpenShellSaved, signal: AbortSignal) {
    const base = { id: 'current', revision: c.revision, checkedAt: now() };
    let result: Inspection = { health: 'failed', authentication: 'unchecked', access: 'unchecked' };
    try {
      result = inspectionSchema.parse(await this.call(c, 'inspect', signal));
    } catch {
      /* Do not store SDK error strings or credentials. */
    }
    const compatible = /^v?0\.1\.6$/.test(result.version ?? '');
    const passed =
      result.health === 'healthy' &&
      result.authentication === 'verified' &&
      result.access === 'verified' &&
      !!result.principal &&
      compatible;
    const message =
      result.health !== 'healthy'
        ? 'Gateway health could not be verified. Check its address, TLS and availability.'
        : !compatible
          ? 'Gateway is reachable, but this adapter requires OpenShell 0.1.6.'
          : result.authentication !== 'verified'
            ? 'Gateway is healthy; authenticated identity was not verified. Check your credentials.'
            : result.access !== 'verified'
              ? 'Identity verified; read access to this workspace was denied or unavailable.'
              : 'Gateway health, identity and workspace read access verified. Sandbox execution requires the synthetic check.';
    this.store.record('openshell-check', { ...base, ...result, passed, message });
    if (!passed) throw error(message);
    return result.principal!;
  }
  async check() {
    this.lock();
    this.controller = new AbortController();
    this.job = (async () => {
      await this.inspect(await this.saved(), this.controller!.signal);
    })();
    try {
      await this.job;
    } finally {
      this.unlock();
    }
    return this.state();
  }
  private unlock() {
    this.job = undefined;
    this.controller = undefined;
    this.locked = false;
    this.release?.();
    this.release = undefined;
  }
  async start() {
    this.lock();
    try {
      if (this.receipts().some((r) => r.cleanup === 'unknown'))
        throw error(
          'A previous OpenShell outcome is unknown. Recheck its receipt before creating another sandbox.',
        );
      const c = await this.saved();
      if (this.closing) throw error('SLIM is shutting down. No OpenShell check was started.');
      const check = this.store.records<Check>('openshell-check')[0];
      if (
        !check?.passed ||
        check.revision !== c.revision ||
        Date.now() - Date.parse(check.checkedAt) > 600_000
      )
        throw error('Run Check connection with these settings before the synthetic check.');
      const id = randomUUID();
      const r: OpenShellReceipt = {
        id,
        kind,
        startedAt: now(),
        status: 'running',
        cleanup: 'not_created',
        config: publicConfig(c),
        name: `slim-${id}`,
        labels: { 'slim-host': this.store.meta('host_id')!, 'slim-receipt': id },
      };
      this.persist(r);
      this.controller = new AbortController();
      this.job = this.run(r, c, this.controller.signal).finally(() => this.unlock());
      return r;
    } catch (e) {
      this.unlock();
      throw e;
    }
  }
  private parseRef(value: unknown) {
    return z.object({ sandbox: refSchema.nullable() }).parse(value).sandbox;
  }
  private owned(r: OpenShellReceipt, value: Ref | null) {
    if (
      !value ||
      (r.sandboxId && r.sandboxId !== value.id) ||
      r.name !== value.name ||
      r.config.workspace !== value.workspace ||
      !Object.entries(r.labels).every(([k, v]) => value.labels[k] === v)
    )
      throw error(
        'Sandbox identity or ownership does not match this receipt. No new command or deletion was sent.',
      );
    return value;
  }
  private async run(r: OpenShellReceipt, c: OpenShellSaved, signal: AbortSignal) {
    try {
      r.principal = await this.inspect(c, signal);
      // Creation can outlive a lost client response. Persist the hold before issuing it.
      r.createIntentAt = now();
      r.cleanup = 'unknown';
      this.persist(r);
      const ref = this.owned(r, this.parseRef(await this.call(c, 'create', signal, r)));
      r.sandboxId = ref.id;
      this.persist(r);
      this.owned(r, this.parseRef(await this.call(c, 'ready', signal, r)));
      r.executeIntentAt = now();
      this.persist(r);
      z.object({ outputVerified: z.literal(true) }).parse(await this.call(c, 'execute', signal, r));
      r.outputVerified = true;
      this.persist(r);
    } catch (e) {
      r.message = safeMessage(e);
    } finally {
      if (r.sandboxId && !signal.aborted) {
        try {
          await this.cleanup(r, c, signal);
        } catch (e) {
          r.recoveryMessage = safeMessage(e);
        }
      }
      r.status = r.outputVerified && r.cleanup === 'deleted' ? 'passed' : 'failed';
      r.finishedAt = now();
      if (r.status === 'passed')
        r.message =
          'Synthetic output and exit verified; original sandbox ID confirmed absent. No sandbox remains connected.';
      this.persist(r);
    }
  }
  private async cleanup(r: OpenShellReceipt, c: OpenShellSaved, signal: AbortSignal) {
    if (r.identityConflict)
      throw error(
        'Deletion returned a different sandbox ID. An operator must review this receipt.',
      );
    const current = this.parseRef(await this.call(c, 'get', signal, r));
    if (!r.sandboxId) {
      const found = this.owned(r, current);
      r.sandboxId = found.id;
      this.persist(r);
    }
    if (current?.id === r.sandboxId) {
      this.owned(r, current);
      if (!r.deleteIntentAt) {
        r.deleteIntentAt = now();
        this.persist(r);
        const { deletion } = z
          .object({
            deletion: z.object({
              outcome: z.enum([
                'accepted',
                'completed',
                'already_absent',
                'unknown',
                'unspecified',
              ]),
              sandboxId: z
                .string()
                .regex(/^[a-zA-Z0-9._-]{1,128}$/)
                .optional(),
            }),
          })
          .parse(await this.call(c, 'delete', signal, r));
        r.deletionOutcome = deletion.outcome;
        r.deletionSandboxId = deletion.sandboxId;
        if (deletion.sandboxId && deletion.sandboxId !== r.sandboxId) r.identityConflict = true;
        this.persist(r);
        if (
          r.identityConflict ||
          !['accepted', 'completed', 'already_absent'].includes(deletion.outcome) ||
          (deletion.outcome !== 'already_absent' && deletion.sandboxId !== r.sandboxId)
        )
          throw error(
            'Deletion did not identify the expected sandbox. Keep this receipt for recovery.',
          );
      }
      // An existing deletion intent is never submitted again, even after timeout/restart.
    }
    z.object({ absent: z.literal(true) }).parse(await this.call(c, 'wait-deleted', signal, r));
    r.cleanup = 'deleted';
    r.cleanupVerifiedAt = now();
    r.recoveryMessage =
      'Original sandbox ID is absent; any same-name replacement was left untouched.';
    this.persist(r);
  }
  async reconcile(id: string, resolution?: string) {
    this.lock();
    try {
      const r = this.receipts().find((r) => r.id === id);
      if (!r || r.cleanup !== 'unknown')
        throw error('This receipt has no unresolved OpenShell cleanup.');
      const c = await this.saved();
      if (this.closing) throw error('SLIM is shutting down. Recovery was not started.');
      if (
        c.gateway !== r.config.gateway ||
        c.workspace !== r.config.workspace ||
        c.caFingerprint !== r.config.caFingerprint ||
        c.auth !== r.config.auth
      )
        throw error(
          'Restore the original gateway, workspace, authentication method and CA for this receipt. Credentials can be rotated for the same identity.',
        );
      this.controller = new AbortController();
      const signal = this.controller.signal;
      this.job = (async () => {
        try {
          const principal = await this.inspect(c, signal);
          if (!r.principal || principal !== r.principal)
            throw error(
              'Authenticated identity changed. Restore the original identity before recovery.',
            );
          if (resolution !== undefined) {
            const current = this.parseRef(await this.call(c, 'get', signal, r));
            if (current)
              throw error(
                'A resource still exists at this name. Review and remove it in OpenShell before recording absence.',
              );
            r.cleanup = 'reviewed_absent';
            r.reviewedAt = now();
            r.resolution = resolution;
            r.recoveryMessage =
              'Operator reviewed the original gateway and workspace; absence recorded. Original execution outcome is unchanged.';
          } else await this.cleanup(r, c, signal);
        } catch (e) {
          r.recoveryMessage = safeMessage(e);
        }
        this.persist(r);
      })().finally(() => this.unlock());
      return r;
    } catch (e) {
      this.unlock();
      throw e;
    }
  }
  async wait() {
    await this.job;
  }
  async close() {
    this.closing = true;
    this.controller?.abort();
    await this.idle;
  }
}
export type OpenShellState = Awaited<ReturnType<OpenShellProof['state']>>;
