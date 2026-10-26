import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../src/storage/store.js';
import { Vault } from '../../src/providers/vault.js';
import { SpaceProof } from '../../src/execution/space.js';
import { spaceExpectedOutput } from '../../src/execution/space-http.js';
const paths = Object.fromEntries(
  [
    ['/sandboxes', 'post'],
    ['/sandboxes/{sandbox_id}', 'delete'],
    ['/operations/{operation_id}', 'get'],
    ['/sandboxes/{sandbox_id}/commands', 'post'],
    ['/sessions/{session_id}/events', 'get'],
  ].map(([path, method]) => [path, { [method!]: {} }]),
);
export const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export const event = (type: string, value: object) =>
  `event: ${type}\r\ndata: ${JSON.stringify({ type, ...value })}\r\n\r\n`;
export const output = (pid: string) =>
  ': heartbeat\r\n\r\n' +
  event('stdout', { seq: 1, data_base64: Buffer.from(spaceExpectedOutput).toString('base64') }) +
  event('process_exited', { process_id: pid, exit_code: 0, status: 'exited' });
export async function fixture(provided?: { store: Store; vault: Vault; service: SpaceProof }) {
  const dir = await mkdtemp(join(tmpdir(), 'slim-space-'));
  const store = provided?.store ?? new Store(dir),
    vault = provided?.vault ?? new Vault(store, async () => Buffer.alloc(32, 5));
  let service =
    provided?.service ??
    new SpaceProof(store, vault, {
      poll: 1,
      operation: 100,
      request: 150,
      events: 200,
    });
  const operations = new Map<string, any>(),
    requests: { method: string; path: string; key?: string; body: string; auth?: string }[] = [];
  const f = {
    token: 'PRIVATE-MANAGEMENT-TOKEN',
    attachment: 'PRIVATE-ATTACHMENT-TOKEN',
    user: 'user-original',
    version: '0.8.0',
    sandbox: null as any,
    creates: 0,
    commands: 0,
    attaches: 0,
    deletes: 0,
    listEmpty: false,
    lostCreate: false,
    partialCreate: false,
    missingSandbox: false,
    lostDelete: false,
    badAttachment: false,
    redirect: false,
    operation404: false,
    badOwner: false,
    badStream: false,
    pendingDelete: false,
    unknownCreate: false,
    foreignOp: false,
    paginate: false,
    repeatCursor: false,
  };
  let dataOrigin = '';
  const data = createServer(async (req, res) => {
    f.attaches++;
    assert.equal(req.headers.authorization, `Bearer ${f.attachment}`);
    assert.notEqual(req.headers.authorization, `Bearer ${f.token}`);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const pid = req.url!.split('/')[3]!;
    const stream = f.badStream
      ? event('stdout', {
          seq: 1,
          data_base64: Buffer.from(spaceExpectedOutput).toString('base64'),
        })
      : output(pid);
    // Exercise byte boundaries in real HTTP as well as the parser unit tests.
    res.write(stream.slice(0, 23));
    res.end(stream.slice(23));
  });
  const management = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const path = req.url!,
      method = req.method!,
      key = req.headers['idempotency-key'] as string | undefined;
    requests.push({ method, path, key, body, auth: req.headers.authorization });
    const send = (value: any, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (path === '/openapi-m1.json') {
      assert.equal(req.headers.authorization, undefined);
      return send({ info: { version: f.version }, paths });
    }
    if (req.headers.authorization !== `Bearer ${f.token}`)
      return send({ code: 'unauthorized', message: f.token }, 401);
    if (path === '/auth/v1/me')
      return send({ user: { id: f.user, org_id: 'org-original' }, org: { id: 'org-original' } });
    if (path === '/auth/v1/cluster') return send({ id: 'cluster-original' });
    if (method === 'GET' && path.startsWith('/v1/sandboxes?')) {
      if (f.redirect) {
        res.writeHead(302, { location: dataOrigin });
        return res.end('{}');
      }
      const next = f.repeatCursor
        ? 'repeated'
        : f.paginate && !path.includes('cursor=') && path.includes('limit=100')
          ? 'page2'
          : null;
      return send({
        data: f.listEmpty || !f.sandbox || next ? [] : [f.sandbox],
        next_cursor: next,
      });
    }
    if (method === 'POST' && path === '/v1/sandboxes') {
      f.creates++;
      const receipt = service.receipts()[0]!;
      assert.equal(receipt.cleanup, 'unknown');
      assert.equal(receipt.create?.key, key);
      assert.equal(receipt.create?.body, body);
      const input = JSON.parse(body),
        sbx = id('sbx'),
        op = id('op');
      assert.equal(input.template, 'seed:latest');
      assert.equal(input.resources.vcpu, 1);
      assert.equal(input.auto_lifecycle, undefined);
      assert.equal(input.network_policy, undefined);
      f.sandbox = {
        id: sbx,
        name: input.name,
        metadata: input.metadata,
        state: 'running',
        template_digest: 'sha256:abcdef',
      };
      operations.set(op, {
        id: op,
        kind: 'create_sandbox',
        state: f.unknownCreate ? 'future_state' : 'succeeded',
        target_type: 'sandbox',
        target_id: f.foreignOp ? id('sbx') : sbx,
      });
      if (f.lostCreate) {
        req.socket.destroy();
        return;
      }
      return send(
        {
          ...(!f.missingSandbox ? { sandbox_id: sbx } : {}),
          ...(!f.partialCreate ? { operation_id: op } : {}),
        },
        202,
      );
    }
    if (path.startsWith('/v1/operations/')) {
      if (f.operation404) return send({ code: 'not_found' }, 404);
      return send(operations.get(path.split('/').at(-1)!) ?? {}, 200);
    }
    if (method === 'GET' && path.endsWith('/processes?limit=1'))
      return send({ data: [], next_cursor: null });
    if (method === 'GET' && path.startsWith('/v1/sandboxes/')) {
      if (!f.sandbox) return send({ code: 'not_found' }, 404);
      return send({ ...f.sandbox, ...(f.badOwner ? { metadata: {} } : {}) });
    }
    if (method === 'POST' && path.endsWith('/commands')) {
      f.commands++;
      const command = JSON.parse(body);
      assert.equal(command.timeout, '30s');
      assert.equal(command.cwd, '/tmp');
      assert.equal(service.receipts()[0]!.command?.key, key);
      const pid = id('proc');
      return send(
        {
          sandbox_id: f.sandbox.id,
          session_id: pid,
          process_id: pid,
          attach: {
            events_url:
              (f.badAttachment ? 'https://attacker.invalid' : dataOrigin) +
              `/v1/sessions/${pid}/events`,
            token: f.attachment,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            token_transport: ['authorization_header'],
          },
        },
        201,
      );
    }
    if (method === 'DELETE' && path.startsWith('/v1/sandboxes/')) {
      f.deletes++;
      assert.equal(service.receipts()[0]!.deletion?.key, key);
      let op = [...operations.values()].find((o) => o.key === key);
      if (!op) {
        op = {
          id: id('op'),
          kind: 'delete_sandbox',
          state: f.pendingDelete ? 'running' : 'succeeded',
          target_type: 'sandbox',
          target_id: path.split('/').at(-1),
          key,
        };
        operations.set(op.id, op);
      }
      f.sandbox = null;
      if (f.lostDelete) {
        req.socket.destroy();
        return;
      }
      return send({ operation_id: op.id }, 202);
    }
    send({ code: 'not_found' }, 404);
  });
  const listen = async (server: Server) => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server.address() as any).port}`;
  };
  dataOrigin = await listen(data);
  const managementOrigin = await listen(management);
  const config = {
    managementOrigin,
    dataPlaneOrigin: dataOrigin,
    consoleOrigin: managementOrigin,
    apiPrefix: '/v1',
    template: 'seed:latest',
    runtime: 'firecracker',
    vcpu: 1,
    memoryMiB: 512,
    diskMiB: 1024,
    token: f.token,
  };
  await service.save(config);
  return {
    f,
    store,
    vault,
    config,
    requests,
    operations,
    get service() {
      return service;
    },
    reopen() {
      service = new SpaceProof(store, vault, {
        poll: 1,
        operation: 100,
        request: 150,
        events: 200,
      });
    },
    async run() {
      await service.check();
      const r = await service.start();
      await service.settle();
      return service.receipts().find((x) => x.id === r.id)!;
    },
    async recover(id: string, review?: string) {
      await service.reconcile(id, review);
      await service.settle();
      return service.receipts().find((x) => x.id === id)!;
    },
    async close() {
      await service.close();
      await Promise.all(
        [data, management].map(
          (s) =>
            new Promise<void>((resolve, reject) => s.close((e) => (e ? reject(e) : resolve()))),
        ),
      );
      if (!provided) store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
