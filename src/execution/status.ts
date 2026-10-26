import type { Store } from '../storage/store.js';

export const cloudProviders = ['vercel', 'modal', 'e2b', 'daytona'] as const;
export function environmentStatus(store: Store, active: Record<string, boolean>) {
  const receipts = store.receipts();
  return Object.fromEntries(
    ['docker', ...cloudProviders].map((provider) => {
      const checks = receipts.filter(
        (r) => r.kind === (provider === 'docker' ? 'docker-sandbox' : `${provider}-sandbox-proof`),
      );
      const latest = checks[0];
      const configured =
        provider === 'docker' || store.meta(`sandbox:${provider}`) === 'configured';
      const revision = store.meta(`sandbox:${provider}:revision`);
      const unknown = checks.some((r) => r.cleanup === 'unknown');
      return [
        provider,
        {
          configured,
          connection: !configured
            ? 'not_configured'
            : !latest
              ? 'unchecked'
              : latest.connectionRevision !== revision
                ? 'changed'
                : latest.status === 'passed'
                  ? 'passed'
                  : 'failed',
          checkedAt: typeof latest?.finishedAt === 'string' ? latest.finishedAt : null,
          activity: active[provider] ? 'working' : unknown ? 'unknown' : 'idle',
          lastCleanup: latest?.cleanup ?? null,
        },
      ];
    }),
  );
}
export type EnvironmentStatus = ReturnType<typeof environmentStatus>;
