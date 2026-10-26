import { useState, type FormEvent } from 'react';
import type { AgentProfile, AgentPermission, AgentTurn } from '../src/acp/client.js';
import { api } from './api.js';
import { Heading, Logo } from './workspace.js';

export type ACPState = {
  profiles: AgentProfile[];
  permissions: AgentPermission[];
  holds: AgentTurn[];
  connected: string[];
};
type Actions = { refresh: () => Promise<void>; act: (fn: () => Promise<unknown>) => Promise<void> };
export function AgentConnections({ state, refresh, act }: Actions & { state: ACPState }) {
  const [preset, setPreset] = useState('a0');
  const [check, setCheck] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    setBusy(true);
    await act(async () => {
      const args =
        preset === 'a0'
          ? [
              'acp',
              ...(String(data.get('host')).trim()
                ? ['--host', String(data.get('host')).trim()]
                : []),
              '--transport',
              'connector',
            ]
          : JSON.parse(String(data.get('args')));
      if (preset === 'a0' && String(data.get('host')).trim()) {
        const host = new URL(String(data.get('host')));
        if (
          host.username ||
          host.password ||
          host.search ||
          host.hash ||
          (host.protocol !== 'https:' &&
            !(
              host.protocol === 'http:' &&
              ['localhost', '127.0.0.1', '[::1]'].includes(host.hostname)
            ))
        )
          throw new Error(
            'Use HTTPS, or HTTP on loopback, without credentials, query parameters or a fragment.',
          );
      }
      await api('/agents', {
        name: String(data.get('name')),
        command: String(data.get('command')),
        args,
        acknowledgeHostAccess: data.get('trust') === 'on',
        readProjectFiles: data.get('read') === 'on',
      });
      form.reset();
      await refresh();
    });
    setBusy(false);
  }
  return (
    <>
      <Heading title="Agents">
        Connect an existing agent over ACP. Native SLIM chats and MCP tools remain available.
      </Heading>
      <div className="agent-grid">
        <section className="settings-card">
          <h2>
            <Logo small /> Agent Zero
          </h2>
          <p>
            Use your Agent Zero instance, including its plugins, memory and subordinate agents. Its
            model and permissions stay in Agent Zero.
          </p>
          <p>
            Install the A0 CLI and sign in there first. Use its absolute executable path below.
            Agent Zero’s ACP settings control host file writes and command execution.
          </p>
          <a
            href="https://github.com/agent0ai/agent-zero/blob/development/docs/guides/a0-cli-connector.md"
            target="_blank"
            rel="noreferrer"
          >
            CLI setup and sign-in ↗
          </a>
        </section>
        <form className="settings-card agent-form" onSubmit={submit}>
          <h2>Add an agent</h2>
          <label>
            Agent
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="a0">Agent Zero</option>
              <option value="custom">Other ACP agent</option>
            </select>
          </label>
          <label>
            Name
            <input
              key={preset}
              name="name"
              required
              maxLength={80}
              defaultValue={preset === 'a0' ? 'Agent Zero' : 'ACP agent'}
            />
          </label>
          <label>
            Executable
            <input name="command" required placeholder="/absolute/path/to/a0" />
          </label>
          {preset === 'a0' ? (
            <label>
              Instance URL (optional)
              <input key="host" name="host" type="url" placeholder="http://localhost:…" />
              <small>Leave blank to use the CLI’s saved instance or local discovery.</small>
            </label>
          ) : (
            <label>
              Arguments as JSON
              <input key="args" name="args" required defaultValue='["acp"]' />
            </label>
          )}
          <p>
            Use a trusted executable. It runs as your OS user and may access files or run commands
            independently of SLIM. ACP is not a sandbox. Keep secrets out of arguments; use the
            agent’s normal sign-in.
          </p>
          <label className="check-row">
            <input name="trust" type="checkbox" required /> I trust this agent with host access.
          </label>
          <label className="check-row">
            <input name="read" type="checkbox" /> Allow ACP requests to read project text files.
          </label>
          <small>
            SLIM offers no file-write or terminal callbacks. An agent may have its own tools and
            permissions. SLIM does not forward its model keys or MCP connections.
          </small>
          <button className="primary" disabled={busy}>
            Save agent
          </button>
        </form>
      </div>
      <div className="agent-list">
        {state.profiles.map((profile) => (
          <section className="settings-card" key={profile.id}>
            <h2>{profile.name}</h2>
            <p>{profile.disabled ? 'Disabled' : 'Configured'} · ACP over stdio</p>
            <code className="agent-command">
              {profile.command} {JSON.stringify(profile.args)}
            </code>
            <p>
              {profile.readProjectFiles
                ? 'Project-file read requests allowed.'
                : 'Client file access disabled.'}{' '}
              External agent permissions apply.
            </p>
            <div className="button-row">
              <button
                disabled={profile.disabled || busy}
                onClick={() => {
                  setBusy(true);
                  void act(async () => {
                    const result = await api<{
                      agentInfo?: { name: string; version: string };
                      protocolVersion: number;
                    }>('/agents/' + profile.id + '/check', {});
                    setCheck((old) => ({
                      ...old,
                      [profile.id]: `Responded: ${result.agentInfo?.name ?? 'Agent'} ${result.agentInfo?.version ?? ''} · ACP ${result.protocolVersion}. Initialization only; no task sent.`,
                    }));
                  }).finally(() => setBusy(false));
                }}
              >
                Check connection
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await api(`/agents/${profile.id}/disabled`, { disabled: !profile.disabled });
                    await refresh();
                  })
                }
              >
                {profile.disabled ? 'Enable' : 'Disable'}
              </button>
            </div>
            {check[profile.id] && <p role="status">{check[profile.id]}</p>}
          </section>
        ))}
      </div>
      <AgentRecovery state={state} act={act} refresh={refresh} />
    </>
  );
}
export function AgentPermissions({
  state,
  chatId,
  act,
  refresh,
}: Actions & { state: ACPState; chatId: string }) {
  return (
    <>
      {state.permissions
        .filter((p) => p.chatId === chatId)
        .map((p) => (
          <section className="agent-permission" key={p.id}>
            <h3>Agent permission request</h3>
            <p>{p.title}</p>
            <small>
              This decision applies to this request. Review the agent’s activity before allowing it.
            </small>
            <details>
              <summary>Requested action</summary>
              <pre>{p.detail}</pre>
            </details>
            <div className="button-row">
              {p.options.map((option) => (
                <button
                  key={option.optionId}
                  onClick={() =>
                    void act(async () => {
                      await api(`/agent-permissions/${p.id}`, { optionId: option.optionId });
                      await refresh();
                    })
                  }
                >
                  {option.kind === 'allow_once' ? 'Allow once' : 'Deny'} · {option.name}
                </button>
              ))}
            </div>
            {!p.options.length && (
              <p>No one-time decision is supported. Use Stop to cancel this request.</p>
            )}
          </section>
        ))}
    </>
  );
}
function AgentRecovery({ state, act, refresh }: Actions & { state: ACPState }) {
  return (
    <>
      {state.holds.map((hold) => (
        <form
          className="settings-card agent-form"
          key={hold.id}
          onSubmit={(e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            void act(async () => {
              await api(`/agent-turns/${hold.id}/review`, {
                resolution: data.get('resolution'),
                acknowledgeExternalReview: data.get('ack') === 'on',
              });
              await refresh();
            });
          }}
        >
          <h2>External outcome unknown</h2>
          <p>
            Chat {hold.chatId}. Check this task in the external agent and stop any work still
            running. Disconnecting ACP does not prove remote work has stopped. All new ACP tasks are
            held until reviewed.
          </p>
          <label>
            What did you verify?
            <textarea name="resolution" required minLength={20} maxLength={2000} />
          </label>
          <label className="check-row">
            <input type="checkbox" name="ack" required /> I checked the external outcome and any
            continuing work.
          </label>
          <button>Record review</button>
        </form>
      ))}
    </>
  );
}
