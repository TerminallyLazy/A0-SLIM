/** Synthetic SDK peer: runs only test-supplied code locally, never contacts Vercel. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { VercelDependencies } from '../../src/execution/vercel-execution.js';
import type { Store } from '../../src/storage/store.js';
const execute = promisify(execFile);
export function vercelFixture(store: () => Store) {
  const f = {
    creates: 0,
    lifetimeMs: 15 * 60_000,
    vcpus: 1,
    commands: 0,
    deletes: 0,
    stops: 0,
    loseCreate: false,
    loseCommand: false,
    loseStop: false,
    loseDelete: false,
    wrongOwner: false,
    overflow: false,
    hold: false,
    name: '',
    tags: {} as Record<string, string>,
    exists: false,
    running: false,
  };
  const dependencies: VercelDependencies = {
    verify: async (credentials) => ({ ...credentials, teamId: 'team_fixture' }),
    create: async (options) => {
      f.creates++;
      f.exists = true;
      f.running = true;
      f.name = options!.name!;
      f.tags = options!.tags!;
      assert.equal(options!.persistent, false);
      assert.equal(options!.networkPolicy, 'deny-all');
      assert.equal(options!.timeout, f.lifetimeMs);
      assert.equal(options!.resources?.vcpus, f.vcpus);
      assert.equal(options!.runtime, 'node22');
      assert.deepEqual(options!.ports, []);
      assert.deepEqual(options!.env, {});
      const receipt = store()
        .receipts()
        .find((r) => r.environmentId === f.name)!;
      assert.equal(receipt.cleanup, 'unknown');
      if (f.loseCreate) throw new Error('SECRET-FIXTURE-CREATE-ERROR');
      return {
        name: f.name,
        runCommand: (async (options: any) => {
          f.commands++;
          assert.ok(
            store()
              .receipts()
              .find((r) => r.environmentId === f.name)?.commandRequestedAt,
          );
          assert.equal(options.cmd, 'node');
          assert.equal(options.sudo, false);
          assert.equal(
            options.timeoutMs,
            store()
              .receipts()
              .find((r) => r.environmentId === f.name)?.tool === 'bash'
              ? 35_000
              : 12_000,
          );
          if (f.loseCommand) throw new Error('SECRET-FIXTURE-COMMAND-ERROR');
          if (f.hold)
            await new Promise<void>((resolve, reject) => {
              if (options.signal.aborted) return reject(new Error('aborted'));
              options.signal.addEventListener('abort', () => reject(new Error('aborted')), {
                once: true,
              });
            });
          let stdout = '',
            stderr = '',
            exitCode = 0;
          try {
            const result = await execute(process.execPath, options.args, {
              timeout: 15_000,
              maxBuffer: 256 * 1024,
              env: {},
            });
            stdout = result.stdout;
            stderr = result.stderr;
          } catch (error: any) {
            stdout = error.stdout ?? '';
            stderr = error.stderr ?? '';
            exitCode = typeof error.code === 'number' ? error.code : 124;
          }
          if (f.overflow) stdout = 'x'.repeat(65537);
          options.stdout.write(stdout);
          options.stderr.write(stderr);
          return { exitCode };
        }) as any,
      };
    },
    get: async (options) => {
      assert.equal(options.resume, false);
      assert.equal(options.name, f.name);
      if (!f.exists) throw { response: new Response(null, { status: 404 }) };
      return {
        name: f.name,
        tags: f.wrongOwner ? {} : f.tags,
        status: f.running ? 'running' : 'stopped',
        stop: async () => {
          f.stops++;
          if (f.loseStop) throw new Error('stop unknown');
          f.running = false;
          return { status: 'stopped' } as any;
        },
        delete: async () => {
          f.deletes++;
          if (f.loseDelete) throw new Error('delete unknown');
          f.exists = false;
        },
      };
    },
  };
  return { f, dependencies };
}
