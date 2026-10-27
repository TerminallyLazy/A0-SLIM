// Explicit disposable local acceptance; never connects to a model account or cloud sandbox.
// Microsandbox mode installs the optional runtime and pinned image into synthetic local data.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../../src/storage/store.js';
import { Vault } from '../../src/providers/vault.js';
import { Bash } from '../../src/tools/bash.js';
import { DockerSandbox } from '../../src/execution/docker.js';
import { VercelExecution } from '../../src/execution/vercel-execution.js';
import { Microsandbox } from '../../src/execution/microsandbox.js';
import { microRuntimeHome } from '../../src/execution/microsandbox-addon.js';
const target = process.argv[2] ?? 'docker';
assert.ok(['docker', 'microsandbox'].includes(target));
const dir = await mkdtemp(join(tmpdir(), 'slim-bash-local-')),
  store = new Store(join(dir, 'data'));
const adapters = {
  docker: new DockerSandbox(store),
  vercel: new VercelExecution(store, new Vault(store, async () => Buffer.alloc(32, 8))),
  microsandbox: new Microsandbox(store),
};
const bash = new Bash(store, adapters),
  projectId = randomUUID(),
  chatId = randomUUID(),
  root = join(dir, 'project');
await mkdir(root);
let accepted = false;
try {
  let revision: string | undefined;
  if (target === 'microsandbox') {
    console.log('Installing the optional Microsandbox runtime and Bash image in synthetic data.');
    await adapters.microsandbox.addon.start();
    await adapters.microsandbox.addon.settled();
    const proof = await adapters.microsandbox.proof();
    assert.equal(proof.status, 'passed', JSON.stringify(proof));
    assert.equal(proof.cleanup, 'deleted');
    revision = await adapters.microsandbox.assertReady();
  } else
    assert.equal(
      (await adapters.docker.bashAvailability()).available,
      true,
      'Install the pinned Bash image first.',
    );
  store.saveProject({ id: projectId, name: 'Synthetic Bash check', root });
  store.saveChat({
    id: chatId,
    projectId,
    connectionId: randomUUID(),
    model: 'fixture',
    title: 'Bash check',
    sessionId: 'session',
    status: 'idle',
    createdAt: new Date().toISOString(),
    execution: target as 'docker' | 'microsandbox',
    executionRevision: revision,
    bashVersion: 1,
  });
  const context = () => ({
    projectId,
    sessionId: 'session',
    messageId: randomUUID(),
    callId: randomUUID(),
  });
  const r = await bash.run(
    {
      command:
        'temporary=$(mktemp); rm \"$temporary\"; items=(paper garden); printf \'%s\\n\' "${items[*]}"; cat > note; cat note; printf error >&2; test -z "$A0_SLIM_VAULT_KEY"; test ! -d /Users',
      input: 'fixture note\n',
    },
    context(),
  );
  assert.equal(r.status, 'passed', JSON.stringify(r));
  assert.equal(r.stdout, 'paper garden\nfixture note\n');
  assert.equal(r.stderr, 'error');
  assert.ok(['removed', 'deleted'].includes(String(r.cleanup)));
  const longer = await bash.run(
    { command: 'sleep 6; printf completed', timeout_ms: 10000 },
    context(),
  );
  assert.equal(longer.stdout, 'completed', JSON.stringify(longer));
  const timeout = await bash.run({ command: 'sleep 30', timeout_ms: 150 }, context());
  assert.equal(timeout.timedOut, true, JSON.stringify(timeout));
  const pipe = await bash.run({ command: 'false | cat' }, context());
  assert.equal(pipe.exitCode, 1, JSON.stringify(pipe));
  const output = await bash.run({ command: 'yes x' }, context());
  assert.equal(output.truncated, true, JSON.stringify(output));
  assert.ok(
    store
      .receipts()
      .filter((r) => r.kind !== 'bash')
      .every((r) => ['removed', 'deleted'].includes(String(r.cleanup))),
  );
  console.log(
    JSON.stringify(
      {
        target,
        checks: [
          'Bash arrays, stdin and redirection',
          'separate stderr',
          'host isolation',
          'six-second script beyond legacy Node timeout',
          'timeout',
          'pipefail',
          'output cap',
          'verified cleanup',
        ],
        passed: true,
      },
      null,
      2,
    ),
  );
  accepted = true;
} finally {
  await bash.close();
  await adapters.microsandbox.close();
  store.close();
  if (accepted) {
    await rm(dir, { recursive: true, force: true });
    if (target === 'microsandbox')
      await rm(microRuntimeHome(adapters.microsandbox.addon.home), {
        recursive: true,
        force: true,
      });
  } else console.error(`Synthetic data retained for recovery: ${dir}`);
}
