import { Sandbox, ConnectionConfig, NotFoundError, type SandboxOpts } from 'e2b';
import { AppError } from '../domain.js';
import type { CloudCheckDriver, CloudKeyCredentials, CloudIdentity } from './cloud-check.js';

export function e2bOptions(credentials: CloudKeyCredentials): SandboxOpts {
  const options: SandboxOpts = {
    apiKey: credentials.apiKey,
    apiUrl: 'https://api.e2b.app',
    domain: 'e2b.app',
    debug: false,
    retries: 0,
    requestTimeoutMs: 15000,
  };
  // The deprecated sandbox URL can still be inherited independently of the API URL.
  if (new ConnectionConfig(options).sandboxUrl)
    throw new AppError(
      400,
      'e2b_endpoint',
      'Remove the custom E2B sandbox URL override before connecting.',
    );
  return options;
}
type SDK = Pick<typeof Sandbox, 'list' | 'getInfo' | 'kill'> & {
  create(options: SandboxOpts): Promise<Sandbox>;
};
export function createE2BDriver(
  credentials: CloudKeyCredentials,
  sdk: SDK = Sandbox,
): CloudCheckDriver {
  const options = e2bOptions(credentials);
  let created: Sandbox | undefined;
  const get = async (id: string): Promise<CloudIdentity | null> => {
    try {
      const info = await sdk.getInfo(id, options);
      return { id: info.sandboxId, metadata: info.metadata };
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  };
  return {
    async create(_name, metadata) {
      created = await sdk.create({
        ...options,
        template: 'base',
        metadata,
        timeoutMs: 60000,
        allowInternetAccess: false,
        network: { allowPublicTraffic: false },
        envs: {},
        volumeMounts: {},
        lifecycle: { onTimeout: 'kill', autoResume: false },
      });
      const resource = await get(created.sandboxId);
      if (!resource) throw new Error('Created sandbox unavailable.');
      return resource;
    },
    get,
    async find(_name, metadata) {
      const pages = sdk.list({
        ...options,
        query: { metadata, state: ['running', 'paused'] },
        limit: 100,
      });
      const found: CloudIdentity[] = [];
      for (let page = 0; pages.hasNext; page++) {
        if (page >= 10) throw new Error('Sandbox search exceeded its bound.');
        found.push(
          ...(await pages.nextItems()).map((info) => ({
            id: info.sandboxId,
            metadata: info.metadata,
          })),
        );
      }
      return found;
    },
    async execute(id) {
      if (!created || created.sandboxId !== id)
        throw new Error('Cannot execute a recovered sandbox.');
      const result = await created.commands.run(
        "printf 'a0 slim synthetic sandbox proof\\n' > /tmp/a0-slim-proof.txt && tr '[:lower:]' '[:upper:]' < /tmp/a0-slim-proof.txt",
        { timeoutMs: 10000, requestTimeoutMs: 15000, envs: {} },
      );
      if (result.exitCode !== 0) throw new Error('Synthetic command failed.');
      return result.stdout;
    },
    async destroy(id) {
      await sdk.kill(id, options);
    },
    async close() {},
  };
}
