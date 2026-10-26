// Optional native code lives only in this child process, never in SLIM's server.
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  Sandbox,
  Image,
  resolveRuntime,
  resolveRuntimeVersion,
  setDefaultBackend,
} from 'microsandbox';
const config = JSON.parse(await readFile(new URL('./runtime.json', import.meta.url), 'utf8'));
setDefaultBackend('local');
process.once('disconnect', () => process.exit(1));
const runtime = resolveRuntime(); // Resolve the pinned package; never auto-download another binary.
if ((await resolveRuntimeVersion(runtime.msbPath)) !== config.version)
  throw Error('Unexpected Microsandbox runtime version.');
const send = (value) =>
  new Promise((resolve, reject) => process.send(value, (e) => (e ? reject(e) : resolve())));
const supervisor =
  "const{spawnSync}=require('node:child_process');const r=spawnSync(process.execPath,['--max-old-space-size=128','-e',process.argv[1]],{input:process.argv[2],env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',TMPDIR:'/tmp'},timeout:5000,killSignal:'SIGKILL',maxBuffer:65536});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);if(r.error)process.stderr.write('Execution limit reached.');process.exitCode=r.error?124:typeof r.status==='number'?r.status:124;";
async function get(name) {
  try {
    return await Sandbox.get(name);
  } catch (e) {
    if (e.code === 'sandboxNotFound') return null;
    throw e;
  }
}
function owned(handle, request) {
  if (
    handle.backendKind !== 'local' ||
    handle.name !== request.name ||
    (request.sandboxId && handle.id !== request.sandboxId) ||
    handle.config().labels?.['a0-slim-receipt'] !== request.receiptId ||
    handle.config().labels?.['a0-slim-host'] !== request.hostId
  )
    throw Error('Sandbox identity differs from the recovery receipt. No resource was changed.');
}
async function main(request) {
  if (request.action === 'probe' || request.action === 'prepare') {
    await promisify(execFile)(runtime.msbPath, ['doctor'], { timeout: 20_000, maxBuffer: 65536 });
    if (request.action === 'prepare')
      await promisify(execFile)(runtime.msbPath, ['pull', config.image], {
        timeout: 480_000,
        maxBuffer: 256 * 1024,
      });
    let imageReady = false;
    try {
      await Image.get(config.image);
      imageReady = true;
    } catch (e) {
      if (e.code !== 'imageNotFound') throw e;
    }
    return { version: config.version, imageReady };
  }
  if (!/^a0-slim-[0-9a-f-]{36}$/.test(request.name)) throw Error('Invalid sandbox name.');
  if (request.action === 'cleanup') {
    const handle = await get(request.name);
    if (!handle) return { absent: true, observedId: null };
    owned(handle, request);
    const observedId = handle.id;
    await handle.destroy({ force: true, timeoutMs: 15_000 });
    if (await get(request.name)) throw Error('The sandbox is still present. Recheck cleanup.');
    return { absent: true, observedId };
  }
  if (request.action !== 'run') throw Error('Unknown runtime action.');
  // No replace, connectOrCreate, resume, mounts, inherited credentials, published ports or guest network.
  const sandbox = await Sandbox.builder(request.name)
    .image(config.image)
    .pullPolicy('never')
    .cpus(config.cpus)
    .memory(config.memoryMiB)
    .rootDisk(512)
    .disableNetwork()
    .user('65534:65534')
    .workdir('/tmp')
    .security('restricted')
    .quietLogs()
    .maxDuration(config.lifetimeSeconds)
    .idleTimeout(30)
    .ephemeral(false)
    .detached(false)
    .labels({ 'a0-slim-receipt': request.receiptId, 'a0-slim-host': request.hostId })
    .create();
  const handle = await get(request.name);
  if (!handle) throw Error('Created sandbox cannot be inspected.');
  owned(handle, request);
  const actual = handle.config();
  // OCI image defaults (PATH, NODE_VERSION) are expected. SLIM supplies no guest env overrides.
  if (actual.network?.enabled !== false || actual.mounts?.length)
    throw Error('Sandbox isolation configuration did not match the adapter.');
  // Parent persists the stable identity before authorizing the one command.
  const acknowledged = new Promise((resolve) => process.once('message', resolve));
  await send({ phase: 'created', sandboxId: handle.id });
  const ack = await acknowledged;
  if (ack?.action !== 'execute') throw Error('Command authorization was interrupted.');
  const output = await sandbox.execWith('node', (b) =>
    b.args(['-e', supervisor, request.code, request.input ?? '']).timeout(8000),
  );
  const stdout = output.stdout(),
    stderr = output.stderr();
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > config.outputBytes)
    throw Error('Sandbox output exceeded 64 KiB.');
  return { output: stdout, stderr, exitCode: output.code };
}
process.once('message', async (request) => {
  try {
    await send({ result: await main(request) });
    process.exit(0);
  } catch (error) {
    // No command arguments or child output in errors: these may contain project text.
    const message =
      request.action === 'run' && error.code !== 'invalidConfig'
        ? `Microsandbox execution failed (${error.code ?? error.name ?? 'runtime'}). Check cleanup.`
        : String(error.message ?? error)
            .split('\n')[0]
            .slice(0, 400);
    await send({ error: message }).catch(() => {});
    process.exit(1);
  }
});
