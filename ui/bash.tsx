import { useEffect, useState } from 'react';
import type { Project } from '../src/domain.js';
import { api } from './api.js';

export function BashSettings({
  project,
  receipts,
  refresh,
  act,
}: {
  project: Project;
  receipts: Record<string, any>[];
  refresh: () => Promise<void>;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [ready, setReady] = useState(false),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false);
  const [dockerReady, setDockerReady] = useState(false);
  const [reviews, setReviews] = useState<Record<string, string>>({});
  useEffect(() => {
    void act(async () => {
      const state = await api('/bash');
      setReady(state.available);
      setDockerReady(state.docker.available);
    });
  }, []);
  const perform = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void act(async () => {
      await fn();
      await refresh();
    }).finally(() => setBusy(false));
  };
  const calls = receipts.filter((r) => r.kind === 'bash' && r.projectId === project.id);
  return (
    <section className="environment-card bash-settings">
      <div className="environment-heading">
        <h3>Bash</h3>
        <span className="pill">Host {project.hostBashGrant ? 'enabled' : 'disabled'}</span>
      </div>
      <p>
        New chats can run Bash in their selected sandbox. Scripts support pipes, redirects and
        heredocs, with separate output and error streams. Sandbox files last for one call; combine
        related steps into one script.
      </p>
      {project.execution === 'docker' && (
        <p className="fine">
          Docker Bash: {dockerReady ? 'image installed' : 'image setup required'}
        </p>
      )}
      <p className="fine">
        Commands: 10 seconds by default, up to 30 seconds. Both: 32 KiB of output. No interactive
        terminal or background jobs. Local Docker needs the Bash image shown below; Microsandbox
        needs the current add-on setup.
      </p>
      <p>
        Host Bash runs directly on this computer with your OS account’s file and network access.
        Commands can change files immediately, outside this project too. The working directory is
        not a security boundary. Shell profiles and inherited credentials are excluded, but commands
        can still read credentials stored on disk.
      </p>
      {project.hostBashGrant ? (
        <button
          disabled={busy}
          onClick={() => perform(() => api(`/projects/${project.id}/bash`, { enabled: false }))}
        >
          Disable host Bash and stop its commands
        </button>
      ) : (
        <>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Allow agent commands for {project.name} to access this computer directly.
          </label>
          <button
            disabled={!ready || !consent || busy}
            onClick={() =>
              perform(async () => {
                await api(`/projects/${project.id}/bash`, {
                  enabled: true,
                  acknowledgeHostAccess: true,
                });
                setConsent(false);
              })
            }
          >
            Enable host Bash for new chats
          </button>
          {!ready && <p className="fine">Host Bash requires /bin/bash on macOS or Linux.</p>}
        </>
      )}
      <p className="fine">
        Start a new chat after enabling host access. Disabling it stops active host commands and
        blocks older chats. Host cwd selections persist per chat; cd, variables and shell state last
        for one call.
      </p>
      {calls.slice(0, 20).map((r) => (
        <details key={r.id} className="receipt">
          <summary>
            {r.target === 'host' ? 'Host Bash' : 'Sandbox Bash'} · {r.status}
            {r.exitCode != null ? ` · exit ${r.exitCode}` : ''}
            {r.timedOut ? ' · timed out' : ''}
            {r.truncated ? ' · output limit' : ''}
            {r.cancelled ? ' · stopped' : ''}
          </summary>
          <p className="fine">
            {r.cwd} · {r.startedAt}
            {r.sandboxReceiptId ? ` · Sandbox receipt ${r.sandboxReceiptId}` : ''}
          </p>
          {(r.message || r.error) && <p>{r.message || r.error}</p>}
          <pre aria-label="Standard output">{r.stdout || '(no stdout)'}</pre>
          <pre aria-label="Standard error">{r.stderr || '(no stderr)'}</pre>
          {r.status === 'unknown' && !r.reviewedAt && (
            <>
              <p>
                Inspect the original effects and stop any remaining processes. Sandbox commands also
                require “Recheck and stop” on their sandbox receipt. This review records your
                assessment; it does not undo effects or retry the command.
              </p>
              {r.pid && (
                <p className="fine">
                  Original process ID: {r.pid}. Verify its identity before acting; process IDs may
                  be reused.
                </p>
              )}
              <label>
                Recovery notes
                <textarea
                  value={reviews[r.id] ?? ''}
                  onChange={(e) => setReviews({ ...reviews, [r.id]: e.target.value })}
                />
              </label>
              <button
                disabled={busy || (reviews[r.id]?.trim().length ?? 0) < 12}
                onClick={() =>
                  perform(() =>
                    api(`/bash/${r.id}/review`, {
                      resolution: reviews[r.id],
                      acknowledgeEffects: true,
                    }),
                  )
                }
              >
                Record that I inspected and stopped the original work
              </button>
            </>
          )}
          {r.reviewedAt && <p>Reviewed: {r.resolution}. The original outcome remains unknown.</p>}
        </details>
      ))}
    </section>
  );
}
