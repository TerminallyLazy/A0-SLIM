import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { SpaceProof } from '../src/execution/space.js';
import { api } from './api.js';

type State = ReturnType<SpaceProof['state']>;
export function SpaceEnvironment({
  refresh,
  act,
}: {
  refresh: () => Promise<void>;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [state, setState] = useState<State | null>(null),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [usage, setUsage] = useState(false),
    [cleanup, setCleanup] = useState(false);
  const reload = async () => setState(await api<State>('/sandbox/space'));
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const poll = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const value = await api<State>('/sandbox/space', undefined, controller.signal);
        if (!controller.signal.aborted) setState(value);
      } catch {
        /* Retain historical evidence while the local service is unreachable. */
      } finally {
        pending = false;
      }
    };
    void act(reload);
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, []);
  const perform = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void act(async () => {
      try {
        await fn();
      } finally {
        await reload();
        await refresh();
      }
    }).finally(() => setBusy(false));
  };
  const config = state?.config,
    disabled = busy || !!state?.busy;
  return (
    <section className="environment-card space-environment" aria-label="SPACE">
      <div className="environment-heading">
        <div className="provider-mark">
          <img src="/providers/space.png" alt="Perplexity" />
        </div>
        <div>
          <h3>SPACE</h3>
          <p role="status" className="environment-connection">
            {state?.busy
              ? 'Checking or cleaning up…'
              : {
                  not_configured: 'Not connected',
                  unchecked: 'Saved · not verified',
                  changed: 'Settings changed · check again',
                  passed: 'Connected at last check',
                  failed: 'Connection check failed',
                }[state?.status.connection ?? 'not_configured']}
          </p>
        </div>
        <span className="pill">Self-hosted</span>
      </div>
      <p>
        Connect a SPACE server you operate. SLIM runs on your Mac; the documented server setup needs
        a Linux host with KVM. Your hosting and compute costs apply.
      </p>
      <div className="provider-links">
        <a
          href="https://space.docs.perplexity.ai/guide/installation.html"
          target="_blank"
          rel="noreferrer"
        >
          Server setup <ArrowUpRight size={14} />
        </a>
        <a
          href="https://space.docs.perplexity.ai/guide/first-sandbox.html"
          target="_blank"
          rel="noreferrer"
        >
          First sandbox guide <ArrowUpRight size={14} />
        </a>
        {config && (
          <a href={config.consoleOrigin} target="_blank" rel="noreferrer">
            Open console / sign in <ArrowUpRight size={14} />
          </a>
        )}
        <button disabled={disabled} onClick={() => setEditing(!editing)}>
          {editing ? 'Close settings' : config ? 'Edit connection' : 'Set up connection'}
        </button>
      </div>
      {editing && (
        <form
          key={config?.revision ?? 'new'}
          className="settings-form space-settings"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const fields = Object.fromEntries(form);
            perform(async () => {
              await api('/sandbox/space', {
                ...fields,
                vcpu: Number(fields.vcpu),
                memoryMiB: Number(fields.memoryMiB),
                diskMiB: Number(fields.diskMiB),
              });
              setEditing(false);
              setUsage(false);
              setCleanup(false);
            });
          }}
        >
          <p className="space-full">
            Use your deployment’s console to sign in and obtain a management bearer token. Enter it
            only here; it is encrypted locally and never displayed again. A Perplexity subscription
            does not provide a SPACE server.
          </p>
          <label>
            Management origin
            <input
              name="managementOrigin"
              type="url"
              required
              defaultValue={config?.managementOrigin}
              placeholder="https://space.example.com"
              autoComplete="off"
            />
          </label>
          <label>
            Data-plane origin
            <input
              name="dataPlaneOrigin"
              type="url"
              required
              defaultValue={config?.dataPlaneOrigin}
              placeholder="https://data.space.example.com"
              autoComplete="off"
            />
          </label>
          <label>
            Console origin
            <input
              name="consoleOrigin"
              type="url"
              required
              defaultValue={config?.consoleOrigin}
              placeholder="https://console.space.example.com"
              autoComplete="off"
            />
          </label>
          <label>
            Management API prefix
            <select name="apiPrefix" defaultValue={config?.apiPrefix ?? '/v1'}>
              <option>/v1</option>
              <option>/api/v1</option>
            </select>
          </label>
          <label>
            Published template
            <input
              name="template"
              required
              maxLength={384}
              defaultValue={config?.template}
              placeholder="seed:latest"
              autoComplete="off"
            />
          </label>
          <label>
            Runtime
            <select name="runtime" defaultValue={config?.runtime ?? 'firecracker'}>
              <option value="firecracker">Firecracker</option>
              <option value="cloud-hypervisor">Cloud Hypervisor</option>
              <option value="gvisor">gVisor</option>
            </select>
          </label>
          <label>
            Requested CPUs
            <input
              name="vcpu"
              type="number"
              min={1}
              max={4}
              required
              defaultValue={config?.vcpu ?? 1}
            />
          </label>
          <label>
            Requested memory (MiB)
            <input
              name="memoryMiB"
              type="number"
              min={128}
              max={8192}
              required
              defaultValue={config?.memoryMiB ?? 512}
            />
          </label>
          <label>
            Requested disk (MiB)
            <input
              name="diskMiB"
              type="number"
              min={512}
              max={32768}
              required
              defaultValue={config?.diskMiB ?? 1024}
            />
          </label>
          <label>
            Management token
            <input
              name="token"
              type="password"
              required={!config?.hasToken}
              autoComplete="new-password"
              placeholder={config?.hasToken ? 'Saved · leave blank to keep' : 'Bearer token'}
            />
          </label>
          <p className="fine space-full">
            Use HTTPS, or HTTP through a loopback tunnel. Origins have no path or query. Changing
            the management origin requires a new token. Requests do not follow redirects or use
            system proxies.
          </p>
          <button type="submit" disabled={disabled}>
            Save SPACE connection
          </button>
        </form>
      )}
      {config && (
        <>
          <p className="fine">
            {config.managementOrigin} · {config.template} ·{' '}
            {state?.check?.checkedAt
              ? `Last check ${new Date(state.check.checkedAt).toLocaleString()}`
              : 'No connection check yet'}
          </p>
          {state?.check && (
            <p className={state.check.passed ? 'fine' : 'error'}>{state.check.message}</p>
          )}
          <p role="status">
            {state?.status.activity === 'unknown'
              ? 'Recovery required · a sandbox may still exist.'
              : state?.busy
                ? 'An operation is in progress.'
                : 'No active sandbox tracked by SLIM.'}
          </p>
          <div className="environment-actions">
            <button
              disabled={disabled}
              onClick={() => perform(() => api('/sandbox/space/check', {}))}
            >
              Check connection
            </button>
          </div>
          <p className="fine">
            Connection checks read the API version, account and sandbox listing without creating
            anything.
          </p>
          <details className="space-synthetic">
            <summary>Test sandbox execution</summary>
            <p className="fine">
              Create one sandbox, write and read a temporary note, then request deletion.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={usage}
                disabled={disabled}
                onChange={(e) => setUsage(e.target.checked)}
              />
              I allow this check to use my server’s compute resources.
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={cleanup}
                disabled={disabled}
                onChange={(e) => setCleanup(e.target.checked)}
              />
              I can clean up on the server if the connection fails. The 30-second command limit does
              not limit the sandbox’s lifetime.
            </label>
            <div className="environment-actions">
              <button
                disabled={
                  disabled ||
                  !usage ||
                  !cleanup ||
                  state?.status.connection !== 'passed' ||
                  state?.status.activity === 'unknown'
                }
                onClick={() =>
                  perform(async () => {
                    await api('/sandbox/space/proof', {
                      acknowledgeUsage: true,
                      acknowledgeCleanup: true,
                    });
                    setUsage(false);
                    setCleanup(false);
                  })
                }
              >
                Run SPACE synthetic check
              </button>
            </div>
          </details>
        </>
      )}
      <p className="fine">
        SPACE 0.8.x · Connection and synthetic checks. Agent execution is not enabled.
      </p>
      {!!state?.receipts.length && <h4>SPACE receipts</h4>}
      {state?.receipts.map((r) => (
        <div className="receipt" key={r.id}>
          <div className="receipt-title">
            <strong>
              {r.status === 'running'
                ? 'Check in progress'
                : r.status === 'passed'
                  ? 'Synthetic check passed'
                  : 'Synthetic check incomplete'}
            </strong>
            <span className="pill">{r.cleanup.replaceAll('_', ' ')}</span>
          </div>
          <p>
            {r.environmentId ?? r.name} · {new Date(r.startedAt).toLocaleString()}
          </p>
          {r.message && <p>{r.message}</p>}
          {r.reconcileMessage && <p className="error">{r.reconcileMessage}</p>}
          {r.resolution && <p>Provider review: {r.resolution}</p>}
          <details>
            <summary>Operation details</summary>
            <dl className="space-details">
              <dt>Original server</dt>
              <dd>{r.config.managementOrigin}</dd>
              <dt>Create operation</dt>
              <dd>{r.create?.operationId ?? 'Not confirmed'}</dd>
              <dt>Delete operation</dt>
              <dd>{r.deletion?.operationId ?? 'Not confirmed'}</dd>
              <dt>Output verified</dt>
              <dd>{r.outputVerified ? 'Yes' : 'No'}</dd>
              <dt>Resolved template</dt>
              <dd>{r.templateDigest ?? 'Not confirmed'}</dd>
            </dl>
          </details>
          {r.cleanup === 'unknown' && (
            <>
              <p className="error">
                New SPACE sandboxes are blocked until this outcome is reconciled. Recovery never
                creates another sandbox or command.
              </p>
              <button
                disabled={disabled}
                onClick={() => perform(() => api(`/sandbox/space/receipts/${r.id}/reconcile`, {}))}
              >
                Recheck and clean up
              </button>
              <details>
                <summary>Record a provider review</summary>
                <p>
                  Use this after checking the original server and account. SLIM requires a complete
                  listing with no owned sandbox, verified account continuity, and at least 24 hours
                  since creation. The receipt remains incomplete; a review never claims deletion.
                </p>
                <form
                  className="settings-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    perform(() =>
                      api(`/sandbox/space/receipts/${r.id}/review-absence`, {
                        resolution: f.get('resolution'),
                        acknowledgeProviderReview: f.get('acknowledge') === 'on',
                      }),
                    );
                  }}
                >
                  <label>
                    What you verified
                    <textarea name="resolution" required minLength={20} maxLength={2000} />
                  </label>
                  <label className="checkbox">
                    <input name="acknowledge" type="checkbox" required />I verified this exact
                    resource is absent and no related operation is still pending on the original
                    SPACE server.
                  </label>
                  <button disabled={disabled}>Record SPACE review</button>
                </form>
              </details>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
