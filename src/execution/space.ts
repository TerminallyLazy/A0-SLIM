import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { AppError } from '../domain.js';
import type { Store } from '../storage/store.js';
import type { Vault } from '../providers/vault.js';
import {
  spaceError,
  spaceOrigin,
  spaceRequest,
  readJSON,
  httpFailure,
  readSpaceEvents,
} from './space-http.js';

const schema = z.object({
  managementOrigin: z.string().max(2048).transform(spaceOrigin),
  dataPlaneOrigin: z.string().max(2048).transform(spaceOrigin),
  consoleOrigin: z.string().max(2048).transform(spaceOrigin),
  apiPrefix: z.enum(['/v1', '/api/v1']),
  template: z
    .string()
    .min(1)
    .max(384)
    .regex(/^[A-Za-z0-9._-]+(?::[A-Za-z0-9_][A-Za-z0-9_.-]*|@(?:sha256|blake3):[0-9a-f]{12,64})?$/)
    .refine((s) => !/^\.{1,2}([:@]|$)/.test(s)),
  runtime: z.enum(['firecracker', 'cloud-hypervisor', 'gvisor']),
  vcpu: z.number().int().min(1).max(4),
  memoryMiB: z.number().int().min(128).max(8192),
  diskMiB: z.number().int().min(512).max(32768),
  token: z
    .string()
    .max(8192)
    .regex(/^[\x21-\x7e]*$/)
    .optional(),
});
export type SpaceConfig = Omit<z.output<typeof schema>, 'token'> & {
  revision: string;
  hasToken: boolean;
};
type Saved = SpaceConfig & { token: string };
type Evidence = {
  id: string;
  revision: string;
  checkedAt: string;
  passed: boolean;
  message: string;
  version?: string;
  principal?: string;
};
type Intent = {
  method: 'POST' | 'DELETE';
  path: string;
  body?: string;
  key: string;
  at: string;
  operationId?: string;
};
export type SpaceReceipt = {
  id: string;
  kind: 'space-sandbox-proof';
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'passed' | 'failed' | 'interrupted';
  cleanup: 'not_created' | 'unknown' | 'deleted' | 'reviewed_absent';
  config: SpaceConfig;
  connectionRevision: string;
  principal?: string;
  version?: string;
  name: string;
  metadata: Record<string, string>;
  environmentId?: string;
  templateDigest?: string;
  create?: Intent;
  command?: Intent;
  deletion?: Intent;
  sessionId?: string;
  processId?: string;
  attachStartedAt?: string;
  outputVerified?: boolean;
  message?: string;
  reconcileMessage?: string;
  reviewedAt?: string;
  resolution?: string;
};
const kind = 'space-sandbox-proof';
const opaque = (value: unknown): value is string =>
  typeof value === 'string' && /^[\w-]{1,128}$/.test(value);
const resourceId = (value: unknown, prefix: 'sbx' | 'op' | 'proc'): value is string =>
  typeof value === 'string' &&
  new RegExp(
    `^${prefix}_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
  ).test(value);
const message = (error: unknown) =>
  error instanceof AppError
    ? error.message
    : 'The SPACE check was interrupted or returned an invalid response. Review the server before retrying.';
const now = () => new Date().toISOString();

export class SpaceProof {
  private job?: Promise<void>;
  private controller?: AbortController;
  private locked = false;
  private closing = false;
  constructor(
    private store: Store,
    private vault: Vault,
    private timing = { poll: 750, operation: 45_000, request: 5_000, events: 45_000 },
  ) {
    for (const receipt of this.receipts())
      if (receipt.status === 'running') {
        receipt.status = 'interrupted';
        receipt.finishedAt = now();
        receipt.message =
          'SLIM restarted during this check. Reconcile any unknown outcome before creating another sandbox.';
        this.persist(receipt);
      }
  }
  get busy() {
    return this.locked;
  }
  receipts() {
    return this.store.receipts().filter((r) => r.kind === kind) as SpaceReceipt[];
  }
  state() {
    const config = this.store.records<SpaceConfig & { id: string }>('space-config')[0] ?? null;
    const check = this.store.records<Evidence>('space-check')[0] ?? null;
    const receipts = this.receipts();
    return {
      config,
      check,
      receipts,
      busy: this.busy,
      status: {
        configured: !!config,
        connection: !config
          ? 'not_configured'
          : !check
            ? 'unchecked'
            : check.revision !== config.revision
              ? 'changed'
              : check.passed
                ? 'passed'
                : 'failed',
        checkedAt: check?.checkedAt ?? null,
        activity: this.busy
          ? 'working'
          : receipts.some((r) => r.cleanup === 'unknown')
            ? 'unknown'
            : 'idle',
        lastCleanup: receipts[0]?.cleanup ?? null,
      },
    };
  }
  private persist(r: SpaceReceipt) {
    this.store.receipt(r);
  }
  private lock() {
    if (this.locked || this.closing) throw spaceError('A SPACE action is already in progress.');
    this.locked = true;
  }
  async save(input: unknown) {
    this.lock();
    try {
      const parsed = schema.parse(input),
        old = await this.vault.get<Saved>('sandbox:space');
      const token =
        parsed.token || (old?.managementOrigin === parsed.managementOrigin ? old.token : '');
      if (!token) throw spaceError('Enter a management token for this SPACE server.');
      const { token: _token, ...fields } = parsed;
      const next = { ...fields, token, hasToken: true };
      const { revision: _revision, ...previous } = old ?? { revision: '' };
      const revision =
        old && JSON.stringify(previous) === JSON.stringify(next) ? old.revision : randomUUID();
      await this.vault.set('sandbox:space', { ...next, revision });
      const { token: _secret, ...publicConfig } = next;
      this.store.record('space-config', { id: 'current', ...publicConfig, revision });
      return this.state();
    } finally {
      this.locked = false;
    }
  }
  private async saved() {
    const config = await this.vault.get<Saved>('sandbox:space');
    if (!config) throw spaceError('Save a SPACE connection first.');
    return config;
  }
  private async json(
    c: Saved,
    path: string,
    signal: AbortSignal,
    intent?: Intent,
    publicRead = false,
  ) {
    const response = await spaceRequest(c.managementOrigin + path, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.timing.request)]),
      token: publicRead ? undefined : c.token,
      method: intent?.method,
      body: intent?.body,
      key: intent?.key,
    });
    const data = await readJSON(response);
    if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
      const failure = httpFailure(response.statusCode, data);
      throw spaceError(failure.message.replaceAll(c.token, '[redacted]'));
    }
    return data;
  }
  private async inspect(c: Saved, signal: AbortSignal) {
    const spec = await this.json(c, '/openapi-m1.json', signal, undefined, true);
    if (
      typeof spec.info?.version !== 'string' ||
      !/^0\.8\.\d+$/.test(spec.info.version) ||
      !spec.paths?.['/sandboxes']?.post ||
      !spec.paths?.['/sandboxes/{sandbox_id}']?.delete ||
      !spec.paths?.['/operations/{operation_id}']?.get ||
      !spec.paths?.['/sandboxes/{sandbox_id}/commands']?.post ||
      !spec.paths?.['/sessions/{session_id}/events']?.get
    )
      throw spaceError(
        'This adapter requires the SPACE 0.8.x public M1 API. The deployed schema is missing or incompatible.',
      );
    const me = await this.json(c, '/auth/v1/me', signal);
    const cluster = await this.json(c, '/auth/v1/cluster', signal);
    if (
      !opaque(me.user?.id) ||
      !opaque(me.org?.id) ||
      me.user.org_id !== me.org.id ||
      !opaque(cluster.id)
    )
      throw spaceError('SPACE did not provide a verifiable account and deployment identity.');
    const page = await this.json(c, `${c.apiPrefix}/sandboxes?limit=1`, signal);
    this.page(page);
    return {
      version: spec.info.version as string,
      principal: createHash('sha256')
        .update(JSON.stringify([cluster.id, me.org.id, me.user.id]))
        .digest('hex'),
    };
  }
  private async evidence(c: Saved, signal: AbortSignal) {
    const base = { id: 'current', revision: c.revision, checkedAt: now() };
    try {
      const result = await this.inspect(c, signal);
      this.store.record('space-check', {
        ...base,
        ...result,
        passed: true,
        message:
          'Account and SPACE 0.8.x API verified. Data-plane execution requires a synthetic check.',
      });
      return result;
    } catch (error) {
      this.store.record('space-check', { ...base, passed: false, message: message(error) });
      throw error;
    }
  }
  async check() {
    this.lock();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.job = (async () => {
      await this.evidence(await this.saved(), signal);
    })();
    try {
      await this.job;
    } finally {
      this.job = undefined;
      this.controller = undefined;
      this.locked = false;
    }
    return this.state();
  }
  async start() {
    this.lock();
    try {
      if (this.receipts().some((r) => r.cleanup === 'unknown'))
        throw spaceError(
          'A previous SPACE outcome is unknown. Recheck and clean up its receipt before creating another sandbox.',
        );
      const c = await this.saved();
      const check = this.store.records<Evidence>('space-check')[0];
      if (
        !check?.passed ||
        check.revision !== c.revision ||
        Date.now() - Date.parse(check.checkedAt) > 10 * 60_000
      )
        throw spaceError('Run Check connection with these settings before the synthetic check.');
      const { token: _secret, ...config } = c;
      const id = randomUUID(),
        r: SpaceReceipt = {
          id,
          kind,
          startedAt: now(),
          status: 'running',
          cleanup: 'not_created',
          config,
          connectionRevision: c.revision,
          name: `a0-slim-${id}`,
          metadata: { app: 'a0-slim', proof: id, host: this.store.meta('host_id')! },
        };
      this.persist(r);
      this.controller = new AbortController();
      this.job = this.run(r, c, this.controller.signal).finally(() => {
        this.locked = false;
        this.controller = undefined;
        this.job = undefined;
      });
      return r;
    } catch (error) {
      this.locked = false;
      throw error;
    }
  }
  private intent(method: 'POST' | 'DELETE', path: string, body?: unknown): Intent {
    return {
      method,
      path,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      key: randomUUID(),
      at: now(),
    };
  }
  private async run(r: SpaceReceipt, c: Saved, signal: AbortSignal) {
    try {
      Object.assign(r, await this.evidence(c, signal));
      r.create = this.intent('POST', `${c.apiPrefix}/sandboxes`, {
        template: c.template,
        runtime: c.runtime,
        name: r.name,
        metadata: r.metadata,
        resources: { vcpu: c.vcpu, memory_mib: c.memoryMiB, disk_mib: c.diskMiB },
      });
      r.cleanup = 'unknown';
      this.persist(r);
      const created = await this.json(c, r.create.path, signal, r.create);
      if (resourceId(created.sandbox_id, 'sbx')) r.environmentId = created.sandbox_id;
      if (resourceId(created.operation_id, 'op')) r.create.operationId = created.operation_id;
      this.persist(r);
      if (!r.create.operationId)
        throw spaceError('SPACE creation returned no operation ID. Recovery is required.');
      await this.operation(r, c, r.create, 'create_sandbox', signal);
      const sandbox = await this.owned(r, c, signal);
      if (sandbox.state !== 'running') throw spaceError('The SPACE sandbox is not running.');
      if (
        typeof sandbox.template_digest === 'string' &&
        /^[\w:-]{1,160}$/.test(sandbox.template_digest)
      )
        r.templateDigest = sandbox.template_digest;
      this.page(
        await this.json(c, `${c.apiPrefix}/sandboxes/${r.environmentId}/processes?limit=1`, signal),
      );
      r.command = this.intent('POST', `${c.apiPrefix}/sandboxes/${r.environmentId}/commands`, {
        command: [
          'sh',
          '-c',
          'set -eu; f=$(mktemp /tmp/a0-slim-XXXXXX); trap \'rm -f "$f"\' EXIT; printf \'A0 SLIM SPACE SYNTHETIC PROOF\\n\' > "$f"; cat "$f"',
        ],
        cwd: '/tmp',
        timeout: '30s',
      });
      this.persist(r);
      const command = await this.json(c, r.command.path, signal, r.command);
      if (resourceId(command.session_id, 'proc')) r.sessionId = command.session_id;
      if (
        typeof command.process_id === 'string' &&
        command.process_id.length > 0 &&
        command.process_id.length <= 128 &&
        !/[\x00-\x1f\x7f]/.test(command.process_id)
      )
        r.processId = command.process_id;
      this.persist(r);
      if (!r.sessionId || !r.processId || command.sandbox_id !== r.environmentId)
        throw spaceError('SPACE returned an invalid command identity.');
      const attach = command.attach,
        expectedPath = `/v1/sessions/${r.sessionId}/events`;
      if (typeof attach?.events_url !== 'string')
        throw spaceError('SPACE did not provide an output attachment.');
      const target = new URL(attach.events_url, c.dataPlaneOrigin);
      if (
        target.origin !== c.dataPlaneOrigin ||
        target.pathname !== expectedPath ||
        target.search ||
        target.hash ||
        target.username ||
        target.password ||
        !Array.isArray(attach.token_transport) ||
        !attach.token_transport.includes('authorization_header') ||
        typeof attach.token !== 'string' ||
        !/^[\x21-\x7e]{1,8192}$/.test(attach.token) ||
        !Number.isFinite(Date.parse(attach.expires_at)) ||
        Date.parse(attach.expires_at) <= Date.now()
      )
        throw spaceError(
          'SPACE attachment address, token transport or expiry is invalid. No command was attached.',
        );
      r.attachStartedAt = now();
      this.persist(r);
      const stream = await spaceRequest(target.href, {
        token: attach.token,
        accept: 'text/event-stream',
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timing.events)]),
      });
      try {
        if (
          stream.statusCode !== 200 ||
          !stream.headers['content-type']?.startsWith('text/event-stream')
        )
          throw spaceError('SPACE did not return an event stream.');
        await readSpaceEvents(stream, r.processId);
      } finally {
        stream.destroy();
      }
      r.outputVerified = true;
      this.persist(r);
    } catch (error) {
      r.message = message(error);
    } finally {
      if (r.cleanup === 'unknown' && r.environmentId) {
        try {
          await this.cleanup(r, c, signal);
        } catch (error) {
          r.reconcileMessage = message(error);
        }
      }
      r.status = r.outputVerified && r.cleanup === 'deleted' ? 'passed' : 'failed';
      r.finishedAt = now();
      if (r.status === 'passed')
        r.message = 'Synthetic file bytes and process exit verified; delete operation succeeded.';
      this.persist(r);
    }
  }
  private async operation(
    r: SpaceReceipt,
    c: Saved,
    intent: Intent,
    kind: string,
    signal: AbortSignal,
    allowFailure = false,
  ) {
    const deadline = Date.now() + this.timing.operation;
    do {
      const op = await this.json(c, `${c.apiPrefix}/operations/${intent.operationId}`, signal);
      if (
        op.id !== intent.operationId ||
        op.kind !== kind ||
        op.target_type !== 'sandbox' ||
        !resourceId(op.target_id, 'sbx') ||
        (r.environmentId && op.target_id !== r.environmentId)
      )
        throw spaceError('SPACE operation identity does not match this receipt.');
      if (!r.environmentId) {
        r.environmentId = op.target_id;
        this.persist(r);
      }
      if (
        op.state === 'succeeded' ||
        (allowFailure && ['failed', 'canceled', 'expired'].includes(op.state))
      )
        return;
      if (!['queued', 'running'].includes(op.state))
        throw spaceError(
          'SPACE operation failed or returned an unsupported state. Recovery is required.',
        );
      await delay(this.timing.poll, undefined, { signal });
    } while (Date.now() < deadline);
    throw spaceError('SPACE operation is still unresolved. Recheck its receipt.');
  }
  private async owned(r: SpaceReceipt, c: Saved, signal: AbortSignal) {
    const sandbox = await this.json(c, `${c.apiPrefix}/sandboxes/${r.environmentId}`, signal);
    if (
      sandbox.id !== r.environmentId ||
      sandbox.name !== r.name ||
      !Object.entries(r.metadata).every(([key, value]) => sandbox.metadata?.[key] === value)
    )
      throw spaceError(
        'SPACE sandbox ownership does not match this receipt. No deletion was sent.',
      );
    return sandbox;
  }
  private async cleanup(r: SpaceReceipt, c: Saved, signal: AbortSignal) {
    if (!r.deletion) {
      // Do not declare deletion complete while the original creation could still finish.
      if (r.create?.operationId)
        await this.operation(r, c, r.create, 'create_sandbox', signal, true);
      const sandbox = await this.owned(r, c, signal);
      if (
        !r.create?.operationId &&
        !['running', 'failed', 'stopped', 'paused', 'suspended'].includes(sandbox.state)
      )
        throw spaceError(
          'SPACE creation is still unresolved. Wait for a stable sandbox state before cleanup.',
        );
      r.deletion = this.intent('DELETE', `${c.apiPrefix}/sandboxes/${r.environmentId}`);
      this.persist(r);
    }
    if (!r.deletion.operationId) {
      if (Date.now() - Date.parse(r.deletion.at) >= 24 * 60 * 60_000)
        throw spaceError(
          'The original delete key expired. Review this resource on the SPACE server; a new deletion is not sent automatically.',
        );
      const result = await this.json(c, r.deletion.path, signal, r.deletion);
      if (resourceId(result.operation_id, 'op')) r.deletion.operationId = result.operation_id;
      this.persist(r);
      if (!r.deletion.operationId)
        throw spaceError('SPACE deletion returned no operation ID. Its outcome is unknown.');
    }
    await this.operation(r, c, r.deletion, 'delete_sandbox', signal);
    r.cleanup = 'deleted';
    r.reconcileMessage = undefined;
    this.persist(r);
  }
  private page(page: Record<string, any>) {
    if (
      !Array.isArray(page.data) ||
      !(
        page.next_cursor === null ||
        (typeof page.next_cursor === 'string' &&
          page.next_cursor.length > 0 &&
          page.next_cursor.length <= 4096)
      )
    )
      throw spaceError('SPACE returned an invalid listing.');
  }
  private async locate(r: SpaceReceipt, c: Saved, signal: AbortSignal) {
    let cursor: string | null = null;
    const seen = new Set<string>(),
      matches = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const page = await this.json(
        c,
        `${c.apiPrefix}/sandboxes?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        signal,
      );
      this.page(page);
      for (const item of page.data)
        if (
          item.name === r.name &&
          Object.entries(r.metadata).every(([key, value]) => item.metadata?.[key] === value)
        ) {
          if (!resourceId(item.id, 'sbx'))
            throw spaceError('SPACE returned an invalid sandbox identity.');
          matches.add(item.id);
        }
      cursor = page.next_cursor;
      if (cursor === null) return [...matches];
      if (seen.has(cursor)) break;
      seen.add(cursor);
    }
    throw spaceError('SPACE listing did not complete. The recovery hold remains.');
  }
  private async recovery(r: SpaceReceipt, c: Saved, signal: AbortSignal) {
    if (
      c.managementOrigin !== r.config.managementOrigin ||
      c.apiPrefix !== r.config.apiPrefix ||
      c.dataPlaneOrigin !== r.config.dataPlaneOrigin
    )
      throw spaceError('Restore the original SPACE endpoints before recovery.');
    const current = await this.evidence(c, signal);
    if (current.principal !== r.principal)
      throw spaceError('Recovery requires the original SPACE account, organization and cluster.');
  }
  async reconcile(id: string, review?: string) {
    this.lock();
    try {
      const r = this.receipts().find((r) => r.id === id);
      if (!r || r.cleanup !== 'unknown')
        throw spaceError('This SPACE receipt has no unresolved cleanup.');
      const c = await this.saved();
      this.controller = new AbortController();
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(120_000)]);
      this.job = (async () => {
        try {
          await this.recovery(r, c, signal);
          if (review) {
            // A review is a separately attributed resolution, never proof of deletion or execution.
            if (!r.create || Date.now() - Date.parse(r.create.at) < 24 * 60 * 60_000)
              throw spaceError(
                'A provider review cannot release this hold until the original create request is at least 24 hours old. Recheck and clean up first.',
              );
            if (r.create.operationId) {
              await this.operation(r, c, r.create, 'create_sandbox', signal, true);
              this.persist(r);
            }
            if ((await this.locate(r, c, signal)).length)
              throw spaceError('The owned sandbox is still listed. Recheck and clean up first.');
            r.cleanup = 'reviewed_absent';
            r.reviewedAt = now();
            r.resolution = review;
            r.reconcileMessage = undefined;
          } else {
            if (!r.environmentId && r.create?.operationId)
              await this.operation(r, c, r.create, 'create_sandbox', signal, true);
            if (!r.environmentId) {
              const matches = await this.locate(r, c, signal);
              if (matches.length !== 1)
                throw spaceError(
                  'No unique owned sandbox was found. An empty list does not clear the recovery hold.',
                );
              r.environmentId = matches[0];
              this.persist(r);
            }
            await this.cleanup(r, c, signal);
          }
        } catch (error) {
          r.reconcileMessage = message(error);
        } finally {
          this.persist(r);
        }
      })().finally(() => {
        this.locked = false;
        this.controller = undefined;
        this.job = undefined;
      });
      return r;
    } catch (error) {
      this.locked = false;
      throw error;
    }
  }
  async settle() {
    await this.job;
  }
  async close() {
    this.closing = true;
    this.controller?.abort();
    await this.job?.catch(() => undefined);
  }
}
