import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Folder,
  Terminal,
  Moon,
  Sun,
} from 'lucide-react';
import type { FirstRunState } from '../src/server/first-run.js';
import type { Connection, Project } from '../src/domain.js';
import type { MicrosandboxState } from '../src/execution/microsandbox.js';
import { api } from './api.js';
import { Logo } from './workspace.js';

export function FirstRun({
  setup,
  projects,
  connections,
  microsandbox,
  refresh,
  finish,
  notice,
  clearNotice,
  theme,
  setTheme,
}: {
  notice: string;
  clearNotice: () => void;
  theme: string;
  setTheme: (theme: string) => void;
  setup: FirstRunState;
  projects: Project[];
  connections: Connection[];
  microsandbox: MicrosandboxState | null;
  refresh: () => Promise<void>;
  finish: (projectId: string, connectionId: string) => void;
}) {
  const [step, setStep] = useState(setup.projectId ? 2 : setup.connectionId ? 1 : 0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [progress, setProgress] = useState('');
  const [apiForm, setApiForm] = useState(false),
    [kind, setKind] = useState('compatible');
  const [selected, setSelected] = useState(setup.connectionId ?? connections[0]?.id ?? '');
  const [models, setModels] = useState<Record<string, { id: string; name: string }[]>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const modelChoice = choices[selected] ?? '';
  const catalogLoading = loading[selected] ?? false;
  const [existing, setExisting] = useState(false),
    [download, setDownload] = useState(false);
  const abort = useRef(new AbortController());
  const attempted = useRef(new Set<string>());
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) titleRef.current?.focus();
    previousStep.current = step;
  }, [step]);
  const connection = connections.find((c) => c.id === selected);
  const project = projects.find((p) => p.id === setup.projectId);
  useEffect(() => {
    void api('/setup/preferences', {}).catch((e) => setError(e.message));
    return () => abort.current.abort();
  }, []);
  useEffect(() => {
    if (!selected && connections.length) setSelected(connections[0]!.id);
  }, [connections, selected]);
  async function loadModels(c: Connection) {
    setLoading((m) => ({ ...m, [c.id]: true }));
    setError('');
    try {
      const list = await api<{ id: string; name: string }[]>(
        `/connections/${c.id}/models`,
        undefined,
        abort.current.signal,
      );
      setModels((m) => ({ ...m, [c.id]: list }));
      setChoices((m) => ({ ...m, [c.id]: c.model || list[0]?.id || '' }));
      if (!list.length)
        setError(
          'This account did not return any available models. Try again or connect another model.',
        );
    } catch (e) {
      if (!abort.current.signal.aborted) setError((e as Error).message);
    } finally {
      setLoading((m) => ({ ...m, [c.id]: false }));
    }
  }
  useEffect(() => {
    if (
      connection?.kind === 'chatgpt' &&
      connection.hasCredential &&
      !connection.model &&
      !attempted.current.has(connection.id)
    ) {
      attempted.current.add(connection.id);
      void loadModels(connection);
    }
  }, [connection?.id, connection?.hasCredential, connection?.model]);
  async function perform(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    clearNotice();
    try {
      await work();
    } catch (e) {
      if (!abort.current.signal.aborted) setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  }
  async function useConnection() {
    if (!connection) return;
    await perform(async () => {
      if (connection.kind === 'chatgpt' && !connection.model)
        await api(`/connections/${connection.id}/model`, { model: modelChoice });
      await api('/setup/preferences', { connectionId: connection.id });
      await refresh();
      setStep(1);
    });
  }
  async function useProject(id: string) {
    await api('/setup/preferences', { projectId: id });
    await refresh();
    setStep(2);
  }
  async function complete() {
    const result = await api<FirstRunState>('/setup/complete', {});
    await refresh();
    finish(result.projectId!, result.connectionId!);
  }
  async function localBash() {
    await perform(async () => {
      if (!project) return;
      let state = await api<MicrosandboxState>('/sandbox/microsandbox');
      if (!state.available) {
        if (!download) throw Error('Confirm the runtime download and local sandbox check.');
        if (state.runtime.status !== 'installed') {
          if (state.runtime.status !== 'installing')
            await api('/sandbox/microsandbox/install', { acknowledgeDownload: true });
          setProgress(
            'Installing the local runtime and image… You can cancel or return to this step later.',
          );
          const deadline = Date.now() + 610000;
          do {
            await new Promise<void>((resolve, reject) => {
              const signal = abort.current.signal;
              const stop = () => {
                clearTimeout(t);
                reject(Error('Setup closed'));
              };
              const t = setTimeout(() => {
                signal.removeEventListener('abort', stop);
                resolve();
              }, 1000);
              signal.addEventListener('abort', stop, { once: true });
              if (signal.aborted) stop();
            });
            state = await api<MicrosandboxState>(
              '/sandbox/microsandbox',
              undefined,
              abort.current.signal,
            );
          } while (state.runtime.status === 'installing' && Date.now() < deadline);
          if (state.runtime.status !== 'installed')
            throw Error(
              state.runtime.error ??
                'Setup did not finish. Retry, or start without code execution.',
            );
        }
        setProgress('Checking one temporary local sandbox and verifying cleanup…');
        const receipt = await api('/sandbox/microsandbox/proof', {}, abort.current.signal);
        await refresh();
        if (receipt.status !== 'passed' || receipt.cleanup !== 'deleted')
          throw Error(
            'The sandbox check needs attention. Open Environments after setup to review its recovery receipt.',
          );
      }
      await api(`/projects/${project.id}/execution`, { execution: 'microsandbox' });
      await complete();
    });
  }
  const titles = ['Connect a model', 'Choose a workspace', 'Start working'];
  return (
    <main className="first-run">
      <header className="first-run-brand">
        <Logo />
        <strong>A0 SLIM</strong>
        <button
          className="icon setup-theme"
          aria-label={theme === 'paper' ? 'Use dark appearance' : 'Use light appearance'}
          onClick={() => setTheme(theme === 'paper' ? 'graphite' : 'paper')}
        >
          {theme === 'paper' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </header>
      <nav aria-label="Setup progress">
        <ol>
          {titles.map((title, index) => (
            <li key={title} aria-current={step === index ? 'step' : undefined}>
              <button disabled={busy || index > step} onClick={() => setStep(index)}>
                <span
                  className={`setup-step-mark ${index < step ? 'complete' : ''}`}
                  aria-hidden="true"
                >
                  {index < step ? <Check size={15} /> : index + 1}
                </span>
                <span>{title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <section className="first-run-panel" aria-labelledby="setup-title">
        <h1 ref={titleRef} tabIndex={-1} id="setup-title">
          {titles[step]}
        </h1>
        {step === 0 && (
          <>
            <p>SLIM includes its own agent. Connect the model you want it to use.</p>
            <button
              className="primary setup-signin"
              disabled={busy || catalogLoading}
              onClick={() =>
                void perform(async () => {
                  const result = await api('/chatgpt/start', {});
                  location.assign(result.url);
                })
              }
            >
              Sign in with ChatGPT <ArrowRight size={17} />
            </button>
            <p className="fine">
              Uses your ChatGPT account’s available models and allowance. Support is experimental.
              Passwords stay on the sign-in page.
            </p>
            {connections.length > 0 && (
              <div className="setup-saved">
                <label>
                  Model connection
                  <select
                    value={selected}
                    onChange={(e) => {
                      setSelected(e.target.value);
                    }}
                  >
                    {connections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.model ? ` · ${c.model}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {connection?.kind === 'chatgpt' && !connection.hasCredential && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const r = await api('/chatgpt/start', { connectionId: connection.id });
                        location.assign(r.url);
                      })
                    }
                  >
                    Reconnect ChatGPT
                  </button>
                )}
                {connection?.kind === 'chatgpt' &&
                  !connection.model &&
                  connection.hasCredential && (
                    <>
                      {catalogLoading ? (
                        <p role="status">Loading your account’s models…</p>
                      ) : models[connection.id]?.length ? (
                        <label>
                          Account model
                          <select
                            value={modelChoice}
                            onChange={(e) =>
                              setChoices((m) => ({ ...m, [selected]: e.target.value }))
                            }
                          >
                            {models[connection.id]!.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <button onClick={() => void loadModels(connection)}>
                          Retry model discovery
                        </button>
                      )}
                    </>
                  )}
                <button
                  className="primary"
                  disabled={
                    busy ||
                    catalogLoading ||
                    !connection ||
                    (connection.kind !== 'compatible' && !connection.hasCredential) ||
                    !(connection.model || modelChoice)
                  }
                  onClick={() => void useConnection()}
                >
                  Use this model <ArrowRight size={16} />
                </button>
              </div>
            )}
            <button
              className="text-link"
              aria-expanded={apiForm}
              disabled={busy}
              onClick={() => setApiForm(!apiForm)}
            >
              Use an API key or local model
            </button>
            {apiForm && (
              <form
                className="setup-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  void perform(async () => {
                    const c = await api<Connection>('/connections', {
                      name: data.get('name'),
                      kind,
                      model: data.get('model'),
                      ...(kind === 'compatible' ? { baseUrl: data.get('baseUrl') } : {}),
                      apiKey: data.get('apiKey') || undefined,
                    });
                    await api('/setup/preferences', { connectionId: c.id });
                    setSelected(c.id);
                    await refresh();
                    setStep(1);
                  });
                }}
              >
                <label>
                  Connection type
                  <select value={kind} onChange={(e) => setKind(e.target.value)}>
                    <option value="compatible">Compatible API, Ollama or LM Studio</option>
                    <option value="gateway">Vercel AI Gateway</option>
                  </select>
                </label>
                <label>
                  Name
                  <input name="name" required maxLength={80} placeholder="My model" />
                </label>
                {kind === 'compatible' && (
                  <label>
                    API base URL
                    <input
                      name="baseUrl"
                      type="url"
                      required
                      placeholder="http://127.0.0.1:11434/v1"
                    />
                    <small>For LM Studio, usually http://127.0.0.1:1234/v1.</small>
                  </label>
                )}
                <label>
                  Model identifier
                  <input
                    name="model"
                    required
                    maxLength={200}
                    placeholder={
                      kind === 'gateway' ? 'provider/model' : 'The model loaded in your server'
                    }
                  />
                </label>
                <label>
                  API key{kind === 'compatible' ? ' (optional for local models)' : ''}
                  <input
                    name="apiKey"
                    type="password"
                    autoComplete="off"
                    required={kind === 'gateway'}
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Save and continue <ArrowRight size={16} />
                </button>
              </form>
            )}
          </>
        )}
        {step === 1 && (
          <>
            <p>A project gives SLIM a folder to read and a place for files you approve.</p>
            <div className="setup-workspace">
              <div className="setup-folder-heading">
                <Folder size={24} aria-hidden="true" />
                <h2>My workspace</h2>
              </div>
              <p className="setup-path">{setup.workspacePath}</p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const p = await api<Project>('/setup/workspace', {});
                    await useProject(p.id);
                  })
                }
              >
                Create my workspace <ArrowRight size={16} />
              </button>
            </div>
            <button
              className="text-link"
              aria-expanded={existing}
              disabled={busy}
              onClick={() => setExisting(!existing)}
            >
              Use an existing folder
            </button>
            {existing && (
              <div className="setup-form">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    disabled={busy}
                    onClick={() => void perform(() => useProject(p.id))}
                  >
                    {p.name} · {p.root}
                  </button>
                ))}
                <form
                  className="setup-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    void perform(async () => {
                      const p = await api<Project>('/projects', {
                        name: data.get('name'),
                        root: data.get('root'),
                      });
                      await useProject(p.id);
                    });
                  }}
                >
                  <label>
                    Project name
                    <input name="name" required maxLength={80} defaultValue="My project" />
                  </label>
                  <label>
                    Absolute folder path
                    <input name="root" required placeholder="/Users/you/Projects/my-project" />
                  </label>
                  <button disabled={busy}>Use this folder</button>
                </form>
              </div>
            )}
          </>
        )}
        {step === 2 && (
          <>
            <div className="setup-ready">
              <span className="setup-ready-mark" aria-hidden="true">
                <Check size={24} />
              </span>
              <div>
                <strong>{project?.name}</strong>
                <p>{connections.find((c) => c.id === setup.connectionId)?.name}</p>
              </div>
            </div>
            <p>You can chat, read project files, and review proposed text files now.</p>
            <p className="fine">
              Your first message makes the first model request. Account sign-in and setup do not
              verify inference or send project contents.
            </p>
            <button className="primary" disabled={busy} onClick={() => void perform(complete)}>
              Start working <ArrowRight size={17} />
            </button>
            <details className="setup-execution">
              <summary>
                <Terminal size={17} /> Add local Bash{' '}
                <ChevronDown className="setup-chevron" size={18} aria-hidden="true" />
              </summary>
              <p>
                Run scripts in isolated, disposable microVMs on this computer. No Docker or separate
                Agent Zero installation is required. Sandbox files last for one call.
              </p>
              {microsandbox?.available ? (
                <p>Microsandbox is ready.</p>
              ) : (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={download}
                    disabled={busy}
                    onChange={(e) => setDownload(e.target.checked)}
                  />
                  Download the optional runtime and image, then create one temporary local sandbox
                  to check it and verify cleanup.
                </label>
              )}
              <button
                disabled={
                  busy ||
                  !microsandbox?.runtime.supported ||
                  (!microsandbox?.available && !download)
                }
                onClick={() => void localBash()}
              >
                {microsandbox?.available ? 'Use local Bash and start' : 'Install, check and start'}
              </button>
              {!microsandbox?.runtime.supported && (
                <p className="fine">
                  Local microVMs need Apple Silicon macOS or Linux with KVM. Docker, Vercel and
                  explicit host Bash are available in Environments.
                </p>
              )}
              {busy && microsandbox?.runtime.status === 'installing' && (
                <button
                  onClick={() =>
                    void api('/sandbox/microsandbox/cancel', {}).catch((e) => setError(e.message))
                  }
                >
                  Cancel download
                </button>
              )}
            </details>
            <p className="fine">
              You can configure Docker, cloud sandboxes or optional host Bash later in Environments.
              Skills, MCP and memory are built in; external ACP agents are optional.
            </p>
          </>
        )}
        {progress && <p role="status">{progress}</p>}
        {(error || notice) && (
          <p className="error" role="alert">
            {error || notice}
          </p>
        )}
        {step > 0 && (
          <button
            className="text-link setup-back"
            disabled={busy}
            onClick={() => setStep(step - 1)}
          >
            <ArrowLeft size={14} /> Back
          </button>
        )}
      </section>
    </main>
  );
}
