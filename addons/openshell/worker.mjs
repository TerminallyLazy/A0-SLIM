// Runs the optional official SDK in an owned child process. Credentials arrive only by IPC.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export const expectedOutput = 'A0 SLIM OpenShell synthetic check\n';
export async function dispatch(client, request) {
  const { action, config, name, sandboxId, labels } = request;
  const scope = { workspace: config.workspace };
  const reference = (r) => ({
    id: r.id,
    name: r.name,
    workspace: r.workspace,
    phase: r.phase,
    labels: Object.fromEntries(
      ['slim-host', 'slim-receipt']
        .filter((k) => r.labels?.[k] !== undefined)
        .map((k) => [k, r.labels[k]]),
    ),
  });
  const get = async () => {
    try {
      return reference(await client.sandbox.get(name, scope));
    } catch (e) {
      if (e.code === 'not_found') return null;
      throw e;
    }
  };
  const owned = async () => {
    const r = await get();
    if (
      !r ||
      r.id !== sandboxId ||
      r.name !== name ||
      r.workspace !== config.workspace ||
      !Object.entries(labels).every(([k, v]) => r.labels[k] === v)
    )
      throw Error('identity');
    return r;
  };
  if (action === 'inspect') {
    const result = { health: 'failed', authentication: 'unchecked', access: 'unchecked' };
    let health;
    try {
      health = await client.health();
    } catch {
      return result;
    }
    result.health = health.status === 'healthy' ? 'healthy' : 'failed';
    result.version =
      typeof health.version === 'string' && /^v?\d+\.\d+\.\d+$/.test(health.version)
        ? health.version
        : 'unknown';
    if (result.health !== 'healthy') return result;
    try {
      const me = await client.raw.getCurrentUser({});
      if (
        typeof me.subject !== 'string' ||
        !me.subject ||
        me.subject.length > 4096 ||
        typeof me.identityProvider !== 'string' ||
        me.identityProvider.length > 4096
      )
        throw Error('identity');
      result.principal = createHash('sha256')
        .update(JSON.stringify([me.identityProvider, me.subject]))
        .digest('hex');
      result.authentication = 'verified';
    } catch (e) {
      result.authentication = e.code === 12 ? 'unsupported' : 'failed';
      return result;
    }
    try {
      // A single protected, workspace-scoped page checks read authorization. Do not require admin gateway-info permissions.
      await client.raw.listSandboxes({
        workspaceScope: { selection: { case: 'workspace', value: config.workspace } },
        pageSize: 1,
      });
      result.access = 'verified';
    } catch {
      result.access = 'failed';
    }
    return result;
  }
  if (action === 'get') return { sandbox: await get() };
  if (action === 'create')
    return {
      sandbox: reference(
        await client.sandbox.create({
          name,
          ...scope,
          image: config.image,
          labels,
          providers: [],
          environment: {},
        }),
      ),
    };
  if (action === 'ready') {
    await client.sandbox.waitReady(name, 90, scope);
    return { sandbox: await owned() };
  }
  if (action === 'execute') {
    await owned();
    let bytes = 0,
      stdout = '',
      stderr = '',
      exitCode;
    const signal = AbortSignal.timeout(35_000);
    for await (const event of client.sandbox.execStream(
      name,
      [
        'sh',
        '-c',
        'set -eu; f=$(mktemp /tmp/a0-slim-XXXXXX); trap \'rm -f "$f"\' EXIT; printf \'A0 SLIM OpenShell synthetic check\\n\' > "$f"; cat "$f"',
      ],
      { ...scope, timeoutSecs: 30, noLoginShell: true, signal },
    )) {
      if (event.type === 'exit') {
        exitCode = event.exitCode;
        continue;
      }
      bytes += event.data.length;
      if (bytes > 16_384) throw Error('output_limit');
      if (event.stream === 'stdout') stdout += event.data.toString('utf8');
      else stderr += event.data.toString('utf8');
    }
    if (exitCode !== 0 || stdout !== expectedOutput || stderr !== '') throw Error('output');
    return { outputVerified: true };
  }
  if (action === 'delete') {
    await owned();
    // The gateway API has no atomic expected-ID deletion precondition. Never retry this mutation.
    const r = await client.sandbox.delete(name, scope);
    return { deletion: { outcome: r.outcome, sandboxId: r.sandboxId } };
  }
  if (action === 'wait-deleted') {
    if (!sandboxId) throw Error('identity');
    await client.sandbox.waitDeleted(name, 45, { ...scope, expectedSandboxId: sandboxId });
    return { absent: true };
  }
  throw Error('action');
}

if (process.send)
  process.once('message', async (request) => {
    let response;
    try {
      const root = join(request.directory, 'node_modules/@nvidia/openshell-sdk');
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      if (pkg.name !== '@nvidia/openshell-sdk' || pkg.version !== '0.1.6') throw Error('sdk');
      const { OpenShellClient } = await import(pathToFileURL(join(root, 'dist/index.js')).href);
      const c = request.config;
      const client = await OpenShellClient.connect({
        gateway: c.gateway,
        ...(c.caCert ? { caCert: Buffer.from(c.caCert) } : {}),
        ...(c.auth === 'mtls'
          ? { clientCert: Buffer.from(c.clientCert), clientKey: Buffer.from(c.clientKey) }
          : { oidcToken: c.token }),
      });
      response = { result: await dispatch(client, request) };
    } catch {
      // Upstream errors can contain headers, tokens, command output or server-provided strings.
      response = {
        error:
          'OpenShell did not complete this operation. Check gateway access and the recovery receipt.',
      };
    }
    process.send(response, () => process.exit(0));
  });
