/** Opt-in contract check against an installed/built official SDK, with a local TLS gRPC fixture. No gateway or compute is used. */
import assert from 'node:assert/strict';
import { createSecureServer } from 'node:http2';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Store } from '../../src/storage/store.js';
import { Vault } from '../../src/providers/vault.js';
import { OpenShellProof } from '../../src/execution/openshell.js';

const sdk = resolve(process.argv[2] ?? 'missing-sdk');
const pkg = JSON.parse(await readFile(join(sdk, 'package.json'), 'utf8'));
assert.equal(pkg.version, '0.1.6');
const require = createRequire(join(sdk, 'package.json'));
const { connectNodeAdapter } = await import(
  pathToFileURL(require.resolve('@connectrpc/connect-node')).href
);
const { ConnectError, Code } = await import(
  pathToFileURL(require.resolve('@connectrpc/connect')).href
);
const { OpenShell, SandboxPhase, DeletionOutcome } = await import(
  pathToFileURL(join(sdk, 'dist/raw.js')).href
);
const dir = await mkdtemp(join(tmpdir(), 'slim-openshell-sdk-'));
const store = new Store(dir),
  vault = new Vault(store, async () => Buffer.alloc(32, 7));
const service = new OpenShellProof(store, vault);
let sandbox: any = null,
  creates = 0,
  deletes = 0,
  commands = 0,
  identityReads = 0,
  mode = 'oidc';
let holdCreate = false,
  creationStarted!: () => void;
const creating = new Promise<void>((resolve) => {
  creationStarted = resolve;
});
const token = 'synthetic-fixture-token';
const scope = (request: any) =>
  assert.deepEqual(request.workspaceScope.selection, { case: 'workspace', value: 'slim-checks' });
try {
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  const cert = await readFile(join(dir, 'cert.pem')),
    key = await readFile(join(dir, 'key.pem'));
  await mkdir(join(service.directory, 'node_modules/@nvidia'), { recursive: true });
  await symlink(sdk, join(service.directory, 'node_modules/@nvidia/openshell-sdk'));
  const server = createSecureServer(
    { cert, key, ca: cert, requestCert: true, rejectUnauthorized: false },
    connectNodeAdapter({
      routes(router: any) {
        router.service(OpenShell, {
          health() {
            return { status: 1, version: '0.1.6' };
          },
          getCurrentUser(_request: any, context: any) {
            identityReads++;
            if (mode === 'oidc' && context.requestHeader.get('authorization') !== `Bearer ${token}`)
              throw new ConnectError('fixture auth denied', Code.Unauthenticated);
            return { subject: 'fixture-user', identityProvider: 'fixture' };
          },
          listSandboxes(request: any) {
            scope(request);
            return { sandboxes: [] };
          },
          async createSandbox(request: any, context: any) {
            scope(request);
            creates++;
            assert.deepEqual(request.spec.providers, []);
            assert.deepEqual(request.spec.environment, {});
            sandbox = {
              metadata: {
                id: 'original-id',
                name: request.name,
                workspace: 'slim-checks',
                labels: request.labels,
                resourceVersion: 1n,
              },
              spec: request.spec,
              status: { phase: SandboxPhase.READY },
            };
            if (holdCreate) {
              creationStarted();
              await new Promise<void>((resolve) =>
                context.signal.addEventListener('abort', () => resolve(), { once: true }),
              );
              throw new ConnectError('fixture canceled', Code.Canceled);
            }
            return { sandbox };
          },
          getSandbox(request: any) {
            scope(request);
            if (!sandbox) throw new ConnectError('fixture absent', Code.NotFound);
            return { sandbox };
          },
          async *execSandbox(request: any) {
            scope(request);
            commands++;
            assert.equal(request.noLoginShell, true);
            assert.equal(request.executionTimeout.seconds, 30n);
            yield {
              payload: {
                case: 'stdout',
                value: { data: Buffer.from('A0 SLIM OpenShell synthetic check\n') },
              },
            };
            yield { payload: { case: 'exit', value: { exitCode: 0 } } };
          },
          deleteSandbox(request: any) {
            scope(request);
            deletes++;
            assert.equal(sandbox.metadata.id, 'original-id');
            // A replacement appears after deletion. Expected-ID waiting must finish without deleting it.
            sandbox = {
              ...sandbox,
              metadata: { ...sandbox.metadata, id: 'replacement-id', labels: {} },
            };
            return { outcome: DeletionOutcome.ACCEPTED, sandboxId: 'original-id' };
          },
        });
      },
    }),
  );
  let sawClientCertificate = false;
  server.on('secureConnection', (socket) => {
    if (socket.getPeerCertificate().subject) sawClientCertificate = true;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const config = {
      gateway: `https://127.0.0.1:${address.port}`,
      workspace: 'slim-checks',
      image: 'fixture/shell:1',
      auth: 'oidc',
      caCert: cert.toString(),
      token,
    };
    await service.save(config);
    assert.equal(identityReads, 0, 'constructing and saving must not access the gateway');
    await service.check();
    const receipt = await service.start();
    await service.wait();
    const result = service.receipts().find((r) => r.id === receipt.id)!;
    assert.equal(result.status, 'passed');
    assert.equal(result.cleanup, 'deleted');
    assert.equal(sandbox.metadata.id, 'replacement-id');
    assert.deepEqual({ creates, commands, deletes }, { creates: 1, commands: 1, deletes: 1 });
    await service.save({ ...config, token: 'wrong-fixture-token' });
    await assert.rejects(service.check());
    assert.equal((await service.state()).check!.health, 'healthy');
    assert.equal((await service.state()).check!.authentication, 'failed');
    mode = 'mtls';
    await service.save({
      ...config,
      auth: 'mtls',
      token: '',
      clientCert: cert.toString(),
      clientKey: key.toString(),
    });
    await service.check();
    assert.ok(sawClientCertificate);
    await service.save({ ...config, clearCa: true });
    await assert.rejects(service.check());
    assert.equal(
      (await service.state()).check!.health,
      'failed',
      'an untrusted CA must not be bypassed',
    );
    mode = 'oidc';
    await service.save(config);
    await service.check();
    holdCreate = true;
    const interrupted = await service.start();
    await creating;
    await service.close();
    assert.equal(service.receipts().find((r) => r.id === interrupted.id)!.cleanup, 'unknown');
    assert.equal(commands, 1);
    assert.equal(deletes, 1);
    console.log(
      JSON.stringify({
        sdk: pkg.version,
        transport: 'TLS HTTP/2 gRPC',
        oidc: 'verified',
        mtls: 'certificate observed',
        untrustedCa: 'rejected',
        publicHealthWithBadAuth: 'distinguished',
        syntheticLifecycle: 'passed',
        replacement: 'untouched',
        shutdown: 'worker exited; unknown creation retained',
        creates,
        commands,
        deletes,
      }),
    );
  } finally {
    await service.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
} finally {
  store.close();
  await rm(dir, { recursive: true, force: true });
}
