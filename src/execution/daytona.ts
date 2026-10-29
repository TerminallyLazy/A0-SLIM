import { Daytona, DaytonaNotFoundError, type Sandbox } from '@daytonaio/sdk';
import { defaultSizing } from './sizing.js';
import type { CloudCheckDriver, CloudKeyCredentials, CloudIdentity } from './cloud-check.js';

export function createDaytonaClient(credentials: CloudKeyCredentials): Daytona {
  // 0.226.1 treats otelEnabled:false as a fallback to dotenv. Override only these
  // flags during synchronous construction, then restore the process environment.
  const flags = ['DAYTONA_OTEL_ENABLED', 'DAYTONA_EXPERIMENTAL_OTEL_ENABLED'];
  const previous = flags.map((key) => process.env[key]);
  try {
    flags.forEach((key) => {
      process.env[key] = 'false';
    });
    return new Daytona({
      apiKey: credentials.apiKey,
      apiUrl: 'https://app.daytona.io/api',
      target: 'us',
      otelEnabled: false,
      useDeprecatedPolling: true,
      requestTimeoutMs: 15000,
    });
  } finally {
    flags.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
}
type Client = Pick<Daytona, 'create' | 'get' | typeof Symbol.asyncDispose>;
export function createDaytonaDriver(
  credentials: CloudKeyCredentials,
  factory: (c: CloudKeyCredentials) => Client = createDaytonaClient,
): CloudCheckDriver {
  const client = factory(credentials);
  let created: Sandbox | undefined;
  const identity = (sandbox: Sandbox): CloudIdentity => ({
    id: sandbox.id,
    metadata: sandbox.labels ?? {},
  });
  const get = async (id: string): Promise<CloudIdentity | null> => {
    try {
      return identity(await client.get(id));
    } catch (error) {
      if (error instanceof DaytonaNotFoundError) return null;
      throw error;
    }
  };
  return {
    async create(name, labels, sizing = defaultSizing.daytona) {
      created = await client.create(
        {
          name,
          labels,
          language: 'python',
          image: 'python:3.13-slim',
          resources: { cpu: sizing.vcpus, memory: sizing.memoryMiB / 1024, disk: 3 },
          public: false,
          networkBlockAll: true,
          envVars: {},
          volumes: [],
          secrets: {},
          autoStopInterval: sizing.sessionTimeoutMinutes,
          autoDeleteInterval: 0,
          ttlMinutes: sizing.sessionTimeoutMinutes,
          ephemeral: true,
        },
        { timeout: 30 },
      );
      return identity(created);
    },
    get,
    async find(name) {
      const resource = await get(name);
      return resource ? [resource] : [];
    },
    async execute(id) {
      if (!created || created.id !== id) throw new Error('Cannot execute a recovered sandbox.');
      const result = await created.process.executeCommand(
        "printf 'a0 slim synthetic sandbox proof\\n' > /tmp/a0-slim-proof.txt && tr '[:lower:]' '[:upper:]' < /tmp/a0-slim-proof.txt",
        undefined,
        {},
        10,
      );
      if (result.exitCode !== 0) throw new Error('Synthetic command failed.');
      return result.result;
    },
    async destroy(id) {
      await (await client.get(id)).delete(15, true);
    },
    async close() {
      await client[Symbol.asyncDispose]();
    },
  };
}
