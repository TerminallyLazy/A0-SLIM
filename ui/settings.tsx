import { useState } from 'react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  KeyRound,
  Plus,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import type { Connection } from '../src/domain.js';
import { api } from './api.js';
import { Heading } from './workspace.js';
type Actions = { refresh: () => Promise<void>; act: (fn: () => Promise<unknown>) => Promise<void> };
export function Connections({
  connections,
  refresh,
  act,
}: Actions & { connections: Connection[] }) {
  const [adding, setAdding] = useState(false),
    [kind, setKind] = useState('compatible'),
    [models, setModels] = useState<Record<string, { id: string; name: string }[]>>({}),
    [pending, setPending] = useState(false),
    [notice, setNotice] = useState('');
  return (
    <>
      <Heading label="Pick your perspective" title="Your models. Your choice.">
        Connect an API, a local model, or a ChatGPT account. Each conversation keeps its own
        connection.
      </Heading>
      <div className="connection-options">
        <button
          className="option"
          onClick={() => {
            setAdding(!adding);
          }}
        >
          <KeyRound size={21} />
          <strong>API or local model</strong>
          <span>
            Gateway, Ollama, LM Studio,
            <br />
            or a compatible endpoint.
          </span>
          <Plus size={18} />
        </button>
        <button
          className="option"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void act(async () => {
              const result = await api('/chatgpt/start', {});
              location.assign(result.url);
            }).finally(() => setPending(false));
          }}
        >
          <ShieldCheck size={21} />
          <strong>Sign in with ChatGPT</strong>
          <span>
            Dedicated account connection.
            <br />
            Experimental text/function bridge.
          </span>
          <ArrowUpRight size={18} />
        </button>
      </div>
      <p className="fine">
        ChatGPT reasoning-state replay is still a P0 compatibility gate. Sign-in and model discovery
        do not verify inference. Unsupported reasoning responses stop with an error.
      </p>
      {adding && (
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget,
              data = new FormData(form);
            setPending(true);
            void act(async () => {
              await api('/connections', {
                name: data.get('name'),
                kind,
                model: data.get('model'),
                ...(kind === 'compatible' ? { baseUrl: data.get('baseUrl') } : {}),
                apiKey: data.get('apiKey') || undefined,
              });
              form.reset();
              setAdding(false);
              await refresh();
            }).finally(() => setPending(false));
          }}
        >
          <h3>Add a model connection</h3>
          <label>
            Connection type
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="compatible">OpenAI-compatible API / local model</option>
              <option value="gateway">Vercel AI Gateway</option>
            </select>
          </label>
          <div className="form-grid">
            <label>
              Display name
              <input name="name" required maxLength={80} placeholder="My local model" />
            </label>
            <label>
              Model identifier
              <input
                name="model"
                required
                maxLength={200}
                placeholder={
                  kind === 'gateway' ? 'provider/model' : 'Model served by your endpoint'
                }
              />
            </label>
          </div>
          {kind === 'compatible' && (
            <label>
              API base URL
              <input name="baseUrl" type="url" required placeholder="http://127.0.0.1:11434/v1" />
            </label>
          )}
          <label>
            API key{' '}
            {kind === 'compatible' && <span className="muted">· optional for local models</span>}
            <input
              name="apiKey"
              type="password"
              required={kind === 'gateway'}
              autoComplete="off"
              placeholder="Stored in the encrypted local vault"
            />
          </label>
          <div className="form-actions">
            <button type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="primary" disabled={pending} type="submit">
              {pending ? 'Saving…' : 'Save connection'}
            </button>
          </div>
        </form>
      )}
      <div className="list-label">
        Saved connections <span>{connections.length}</span>
      </div>
      {connections.length === 0 ? (
        <div className="empty-row">
          <PlugMark />
          <p>
            Your next conversation starts with a connection.
            <small>Keys stay in the local service’s encrypted vault.</small>
          </p>
        </div>
      ) : (
        connections.map((c) => (
          <div className="connection-record" key={c.id}>
            <div className="connection-row">
              <div className="connection-glyph">
                {c.kind === 'chatgpt' ? (
                  <ShieldCheck size={19} />
                ) : c.kind === 'gateway' ? (
                  <KeyRound size={19} />
                ) : (
                  <Terminal size={19} />
                )}
              </div>
              <div className="connection-info">
                <h3>{c.name}</h3>
                <p>
                  {c.model || 'Choose an account model'} ·{' '}
                  {c.kind === 'chatgpt'
                    ? c.account?.label
                    : c.kind === 'gateway'
                      ? 'AI Gateway'
                      : c.baseUrl}
                </p>
              </div>
              <span className="pill">{c.verifiedAt ? 'Verified' : 'Not verified'}</span>
            </div>
            {c.kind === 'chatgpt' && (
              <div className="account-actions">
                {c.hasCredential ? (
                  <>
                    <button
                      onClick={() =>
                        void act(async () => {
                          const list = await api(`/connections/${c.id}/models`);
                          setModels((previous) => ({ ...previous, [c.id]: list }));
                        })
                      }
                    >
                      Load account models <ChevronDown size={14} />
                    </button>
                    <button
                      onClick={() =>
                        void act(async () => {
                          const result = await api(`/connections/${c.id}/disconnect`, {});
                          setNotice(result.message);
                          await refresh();
                        })
                      }
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() =>
                      void act(async () => {
                        const result = await api('/chatgpt/start', { connectionId: c.id });
                        location.assign(result.url);
                      })
                    }
                  >
                    Reconnect
                  </button>
                )}
                {models[c.id] && (
                  <label>
                    Account model
                    <select
                      value={c.model}
                      onChange={(event) =>
                        void act(async () => {
                          await api(`/connections/${c.id}/model`, { model: event.target.value });
                          await refresh();
                        })
                      }
                    >
                      <option value="" disabled>
                        Choose a model
                      </option>
                      {models[c.id]!.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>
        ))
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
function PlugMark() {
  return <KeyRound size={22} />;
}
export function Environments({
  configured,
  receipts,
  refresh,
  act,
}: Actions & { configured: boolean; receipts: Record<string, any>[] }) {
  const [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [consent, setConsent] = useState(false);
  return (
    <>
      <Heading label="A place for the work" title="Boundaries you can see.">
        The foundation runs with code execution off. This synthetic check tests the first cloud
        sandbox adapter.
      </Heading>
      <div className="notice">
        <ShieldCheck size={18} />
        <div>
          <strong>Project files stay on your computer during this check.</strong>
          <p>
            The probe creates a temporary sandbox, writes a synthetic note, runs Node, reads the
            result, and requests stop. It denies outbound network and exposes no ports.
          </p>
        </div>
      </div>
      <div className="connection-row">
        <div className="connection-glyph">
          <Terminal size={20} />
        </div>
        <div className="connection-info">
          <h3>Vercel Sandbox</h3>
          <p>{configured ? 'Credentials saved · live verification available' : 'Not configured'}</p>
        </div>
        <button onClick={() => setEditing(!editing)}>
          {configured ? 'Update connection' : 'Configure'}
        </button>
      </div>
      {editing && (
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget,
              data = new FormData(form);
            setBusy(true);
            void act(async () => {
              await api('/sandbox/vercel', Object.fromEntries(data));
              form.reset();
              setEditing(false);
              await refresh();
            }).finally(() => setBusy(false));
          }}
        >
          <div className="form-grid">
            <label>
              Team ID
              <input name="teamId" required autoComplete="off" />
            </label>
            <label>
              Project ID
              <input name="projectId" required autoComplete="off" />
            </label>
          </div>
          <label>
            Access token
            <input name="token" type="password" required autoComplete="off" />
          </label>
          <button className="primary" disabled={busy}>
            Save connection
          </button>
        </form>
      )}
      {configured && (
        <div className="proof-form">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{' '}
            Create a temporary sandbox using my Vercel account. Provider usage may be billed.
          </label>
          <button
            className="primary"
            disabled={!consent || busy}
            onClick={() => {
              setBusy(true);
              void act(async () => {
                await api('/sandbox/vercel/proof', { acknowledgeUsage: true });
                setConsent(false);
                await refresh();
              }).finally(() => setBusy(false));
            }}
          >
            {busy ? 'Checking the sandbox…' : 'Run synthetic check'} <ArrowUpRight size={16} />
          </button>
        </div>
      )}
      <div className="list-label">
        Verification receipts <span>{receipts.length}</span>
      </div>
      {!receipts.length && (
        <p className="empty-row">No sandbox has been created by this application.</p>
      )}
      {receipts.map((receipt) => (
        <div className="receipt" key={receipt.id}>
          <div>
            <Check size={16} />
            <strong>
              {receipt.status === 'passed'
                ? 'Synthetic artifact matched'
                : receipt.status === 'pending'
                  ? 'Check interrupted or still pending'
                  : 'Check did not pass'}
            </strong>
            <span className="pill">Cleanup: {receipt.cleanup}</span>
          </div>
          <p>
            {receipt.environmentId ?? 'Environment ID unavailable'} ·{' '}
            {new Date(receipt.startedAt).toLocaleString()}
          </p>
          {receipt.message && <p>{receipt.message}</p>}
          {receipt.cleanup === 'unknown' && (
            <p className="error">
              Inspect this environment in Vercel before retrying. The service could not confirm
              cleanup.
            </p>
          )}
        </div>
      ))}
      <p className="fine">
        The temporary session has a 60-second TTL and persistence disabled. A successful probe does
        not enable agent code execution. Additional adapters and artifact approval follow in later
        stages.
      </p>
    </>
  );
}
