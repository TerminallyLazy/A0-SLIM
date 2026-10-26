import { useState } from 'react';
import { ArrowUpRight, ChevronDown, KeyRound, Plus, ShieldCheck, Terminal } from 'lucide-react';
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
        ChatGPT text and function conversations keep encrypted provider state locally. Sign-in and
        model discovery do not verify inference. Changed or compacted history requires a new chat
        with a reviewed summary.
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
