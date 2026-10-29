import { useEffect, useState } from 'react';
import { ArrowUpRight, Copy, Check } from 'lucide-react';
import type { OpenShellState } from '../src/execution/openshell.js';
import { api } from './api.js';

const root = '/sandbox/openshell';
const statusText: Record<string, string> = {
  not_configured: 'Not configured',
  sdk_missing: 'SDK required',
  unchecked: 'Not checked',
  changed: 'Settings changed',
  stale: 'Check expired',
  verified: 'Gateway verified',
  failed: 'Connection needs attention',
};
export function OpenShellEnvironment({
  refresh,
  act,
}: {
  refresh: () => Promise<void>;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [state, setState] = useState<OpenShellState | null>(null);
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false);
  const [auth, setAuth] = useState<'mtls' | 'oidc'>('mtls');
  const [usage, setUsage] = useState(false),
    [dedicated, setDedicated] = useState(false);
  const [copied, setCopied] = useState(false);
  const reload = async () => setState(await api(root));
  useEffect(() => {
    let live = true;
    const read = () => {
      void api<OpenShellState>(root)
        .then((v) => {
          if (live) setState(v);
        })
        .catch(() => {});
    };
    read();
    const timer = setInterval(read, 1500);
    return () => {
      live = false;
      clearInterval(timer);
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
  const disabled = busy || !!state?.busy;
  const config = state?.config;
  const current = !!config && state?.check?.revision === config.revision;
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const install = state
    ? `npm install --prefix ${quote(state.addon.directory)} --ignore-scripts --registry=https://registry.npmjs.org --@nvidia:registry=https://npm.pkg.github.com @nvidia/openshell-sdk@0.1.6`
    : '';
  return (
    <section className="environment-card" aria-labelledby="openshell-heading">
      <div className="environment-heading">
        <div className="provider-mark">
          <img src="/providers/openshell.svg" alt="" />
        </div>
        <div>
          <h3 id="openshell-heading">NVIDIA OpenShell</h3>
          <p>Connect to a gateway you manage</p>
        </div>
        <span className="pill">
          {state?.status.activity === 'unknown'
            ? 'Recovery required'
            : disabled
              ? 'Checking…'
              : statusText[state?.status.connection ?? 'not_configured']}
        </span>
      </div>
      <p>Gateway access and temporary sandbox checks. No sandbox is kept connected to chat.</p>
      <div className="provider-links">
        <a
          href="https://docs.nvidia.com/openshell/latest/about/installation"
          target="_blank"
          rel="noreferrer"
        >
          Set up a gateway <ArrowUpRight size={14} />
        </a>
        <a
          href="https://docs.nvidia.com/openshell/latest/how-it-works/gateways/authentication"
          target="_blank"
          rel="noreferrer"
        >
          Sign in and credentials <ArrowUpRight size={14} />
        </a>
        <a
          href="https://docs.nvidia.com/openshell/latest/sdk/typescript"
          target="_blank"
          rel="noreferrer"
        >
          SDK setup <ArrowUpRight size={14} />
        </a>
      </div>
      <details className="space-synthetic">
        <summary>Install the optional SDK{state?.addon.installed ? ' · installed' : ''}</summary>
        <p>
          NVIDIA distributes SDK 0.1.6 through GitHub Packages. Follow its SDK setup guide to
          authenticate npm with a GitHub token that has read:packages access, then run this command
          in your terminal. Keep that token in npm.
        </p>
        <pre className="openshell-command">
          <code>{install || 'Loading install command…'}</code>
        </pre>
        <button
          disabled={!install}
          onClick={() => {
            void act(async () => {
              await navigator.clipboard.writeText(install);
              setCopied(true);
            });
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}{' '}
          {copied ? 'Copied' : 'Copy install command'}
        </button>
        <p className="fine">
          This installs executable SDK code in SLIM’s add-on directory. It does not install a
          gateway, download a sandbox image, or change the core npm package.
        </p>
      </details>
      <div className="environment-actions">
        <button
          disabled={disabled}
          onClick={() => {
            setAuth(config?.auth ?? 'mtls');
            setEditing(!editing);
          }}
        >
          {editing ? 'Close settings' : config ? 'Edit connection' : 'Set up connection'}
        </button>
        {config && (
          <button
            disabled={disabled || !state?.addon.installed}
            onClick={() => perform(() => api(`${root}/check`, {}))}
          >
            Check connection
          </button>
        )}
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
              await api(root, { ...fields, clearCa: form.has('clearCa') });
              setEditing(false);
              setUsage(false);
              setDedicated(false);
            });
          }}
        >
          <p className="space-full">
            Use your gateway’s credentials. Certificates, private keys and bearer tokens are
            encrypted locally and never shown again. Blank secret fields retain credentials only for
            the same gateway and authentication method.
          </p>
          <label>
            Gateway origin
            <input
              name="gateway"
              type="url"
              required
              defaultValue={config?.gateway ?? 'https://localhost:17670'}
              autoComplete="off"
            />
          </label>
          <label>
            Dedicated workspace
            <input
              name="workspace"
              required
              defaultValue={config?.workspace ?? 'slim-checks'}
              pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}"
              autoComplete="off"
            />
          </label>
          <label className="space-full">
            Sandbox image
            <input
              name="image"
              required
              defaultValue={config?.image ?? ''}
              placeholder="Image supported by your gateway"
              autoComplete="off"
            />
            <span className="fine">
              Use an image with sh and mktemp. Image pulling and compute happen on your gateway.
            </span>
          </label>
          <label>
            Authentication
            <select
              name="auth"
              value={auth}
              onChange={(e) => setAuth(e.target.value as typeof auth)}
            >
              <option value="mtls">Client certificate (mTLS)</option>
              <option value="oidc">OIDC bearer token</option>
            </select>
          </label>
          <label>
            CA certificate (PEM, optional)
            <textarea
              name="caCert"
              rows={3}
              autoComplete="off"
              spellCheck={false}
              placeholder={
                config?.hasCa ? 'Saved · leave blank to retain' : 'System trust roots if omitted'
              }
            />
          </label>
          {config?.hasCa && (
            <label className="checkbox space-full">
              <input name="clearCa" type="checkbox" />
              Use system trust roots instead of the saved CA
            </label>
          )}
          {auth === 'mtls' ? (
            <>
              <label>
                Client certificate (PEM)
                <textarea
                  name="clientCert"
                  rows={3}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste certificate"
                />
              </label>
              <label>
                Client private key (PEM)
                <textarea
                  name="clientKey"
                  rows={3}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Paste private key · stored encrypted"
                />
              </label>
            </>
          ) : (
            <label>
              Bearer token
              <input
                name="token"
                type="password"
                autoComplete="new-password"
                placeholder={
                  config?.auth === 'oidc' ? 'Saved · leave blank to retain' : 'Paste access token'
                }
              />
            </label>
          )}
          <div className="space-full">
            <button className="primary" disabled={disabled}>
              Save connection
            </button>
          </div>
        </form>
      )}
      {config && (
        <>
          <p className="fine">
            {config.gateway} · workspace {config.workspace}
          </p>
          {state?.check && (
            <div role="status">
              <p>
                {current ? state.check.message : 'Settings changed. Check this connection again.'}
              </p>
              <p className="fine">
                {current
                  ? `Gateway health: ${state.check.health} · Authentication: ${state.check.authentication} · Workspace access: ${state.check.access}`
                  : 'Earlier connection evidence is retained for review.'}
                <br />
                Last checked {new Date(state.check.checkedAt).toLocaleString()}
                {state.check.version ? ` · Gateway ${state.check.version}` : ''}
              </p>
            </div>
          )}
          <details className="space-synthetic">
            <summary>Test sandbox execution</summary>
            <p>
              Create one sandbox, write and read a fixed temporary note, then verify deletion of its
              original ID. No project files or model keys are sent.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={usage}
                disabled={disabled}
                onChange={(e) => setUsage(e.target.checked)}
              />
              I allow image pulling and compute on this gateway; provider charges may apply.
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={dedicated}
                disabled={disabled}
                onChange={(e) => setDedicated(e.target.checked)}
              />
              This is a dedicated workspace. I can remove a sandbox if cleanup fails, and no other
              client will reuse this check’s name.
            </label>
            <p className="fine">
              OpenShell 0.1.6 deletes by name. SLIM checks ownership first and waits for the
              original ID to disappear, but cannot make deletion atomic with that ID check. The
              command timeout does not limit the sandbox’s lifetime.
            </p>
            <button
              disabled={
                disabled ||
                !usage ||
                !dedicated ||
                state?.status.connection !== 'verified' ||
                state?.status.activity === 'unknown'
              }
              onClick={() =>
                perform(async () => {
                  await api(`${root}/proof`, {
                    acknowledgeUsage: true,
                    acknowledgeDedicatedWorkspace: true,
                  });
                  setUsage(false);
                  setDedicated(false);
                })
              }
            >
              Run OpenShell synthetic check
            </button>
          </details>
        </>
      )}
      {!!state?.receipts.length && <h4>OpenShell receipts</h4>}
      {state?.receipts.map((r) => (
        <div className="receipt" key={r.id}>
          <div className="receipt-title">
            <strong>
              {r.status === 'passed'
                ? 'Synthetic check passed'
                : r.status === 'running'
                  ? 'Check in progress'
                  : 'Synthetic check incomplete'}
            </strong>
            <span className="pill">{r.cleanup.replaceAll('_', ' ')}</span>
          </div>
          <p>
            {r.sandboxId ?? r.name} · {new Date(r.startedAt).toLocaleString()}
          </p>
          {r.message && <p>{r.message}</p>}
          {r.recoveryMessage && <p>{r.recoveryMessage}</p>}
          <details>
            <summary>Operation details</summary>
            <dl className="space-details">
              <dt>Gateway</dt>
              <dd>{r.config.gateway}</dd>
              <dt>Workspace</dt>
              <dd>{r.config.workspace}</dd>
              <dt>Name</dt>
              <dd>{r.name}</dd>
              <dt>Original ID</dt>
              <dd>{r.sandboxId ?? 'Not confirmed'}</dd>
              <dt>Delete response ID</dt>
              <dd>{r.deletionSandboxId ?? 'Not confirmed'}</dd>
              <dt>Output verified</dt>
              <dd>{r.outputVerified ? 'Yes' : 'No'}</dd>
              <dt>Cleanup verified</dt>
              <dd>{r.cleanupVerifiedAt ?? 'Not confirmed'}</dd>
            </dl>
          </details>
          {r.resolution && <p>Operator review: {r.resolution}</p>}
          {r.cleanup === 'unknown' && (
            <>
              <p className="error">
                New OpenShell sandboxes are blocked. Recovery uses the original gateway, workspace
                and identity, and never repeats the command.
              </p>
              <button
                disabled={disabled}
                onClick={() => perform(() => api(`${root}/receipts/${r.id}/reconcile`, {}))}
              >
                Recheck and clean up
              </button>
              <details>
                <summary>Record operator review</summary>
                <p>
                  Use only after checking the original gateway and workspace and removing any
                  remaining resource. A failed lookup alone does not resolve a lost creation.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const f = new FormData(event.currentTarget);
                    perform(() =>
                      api(`${root}/receipts/${r.id}/review-absence`, {
                        acknowledgeProviderReview: true,
                        resolution: f.get('resolution'),
                      }),
                    );
                  }}
                >
                  <label>
                    Review evidence
                    <textarea name="resolution" required minLength={20} maxLength={2000} rows={3} />
                  </label>
                  <label className="checkbox">
                    <input type="checkbox" required disabled={disabled} />I reviewed the original
                    gateway and confirmed this resource is absent.
                  </label>
                  <button disabled={disabled}>Record review and recheck absence</button>
                </form>
              </details>
            </>
          )}
        </div>
      ))}
      <p className="fine">
        SDK and gateway 0.1.6 · Synthetic checks only. Native SLIM and MCP remain available.
      </p>
    </section>
  );
}
