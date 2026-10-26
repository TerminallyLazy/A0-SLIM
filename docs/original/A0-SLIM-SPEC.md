Involving Agent Zero's prompt system, tool discovery, memory/vector store, and UI transport, we need a grounded build spec for "A0 Slim" as a standalone Node.js project built on `libfx`.

Key facts grounding the design: Agent Zero's tools are discovered by filename convention and documented per-tool in prompt files matched by `agent.system.tool.*.md` [1](#1-0) , tools are plain classes with `execute(**kwargs) -> Response` [2](#1-1) , delegation to subordinate agents is itself just a tool (`call_subordinate`) [3](#1-2) , and memory is a local FAISS vector store keyed by embeddings persisted to disk [4](#1-3) [5](#1-4)  — none of which require Docker. The system prompt is assembled from ordered sections (main role, tools, skills, project) read from Markdown template files [6](#1-5) [7](#1-6) .

Create a new, standalone Node.js repository named "A0 Slim" (do not modify `agent0ai/agent-zero`'s Python codebase). It reimplements a trusted-local, Docker-free subset of Agent Zero's agent-loop behavior on top of the `libfx` npm package, porting prompts and tool taxonomy conceptually rather than code.

## 1. Project scaffold

- `package.json` depending on `libfx` (Node 20+), `better-sqlite3` or plain JSON files for lightweight local persistence, and `fastify` or Node's built-in `http` for the API server.
- Directory layout mirroring Agent Zero's conceptual split:
  - `src/agent.ts` — creates the `libfx` agent via `createFxAgent()`.
  - `src/tools/*.ts` — one file per tool, each exporting an object matching `libfx`'s tool shape (`name`, `description`, `inputSchema`, `idempotent`, `writes`, `execute`).
  - `src/prompts/*.md` — ported Markdown prompt fragments (role, tools, communication contract, tips) adapted from Agent Zero's `prompts/agent.system.*.md` files, concatenated at startup into the `instructions` string passed to `createFxAgent()`.
  - `src/memory.ts` — simple local vector memory.
  - `src/server.ts` — HTTP routes for chat.
  - `data/sessions/` — local session durability directory.
  - `data/memory/` — local vector index files.

## 2. Agent and model configuration

- In `src/agent.ts`, call `createFxAgent({ name: "a0-slim", model, instructions, tools, durability })`.
- Use AI Gateway as the default provider (`AI_GATEWAY_API_KEY` env var), matching Agent Zero's existing multi-provider flexibility conceptually; optionally also support the `provider: "codex"`/`"grok"` paths or a custom OpenAI-compatible `provider` object for users who want to point at Ollama/LM Studio/any local inference server (mirrors Agent Zero's many-provider support via LiteLLM, but through libfx's custom provider interface) — document this as an alternative in a config file, not required for MVP.
- Use `durability: local({ dir: "data/sessions" })` from `libfx/durable-local` so sessions survive process restarts without Docker.
- Load `instructions` by concatenating ported prompt fragments in a fixed order (role → tools catalog generated from the registered tool list → communication/response-format contract → tips/best practices → safety/sandboxing caveats), analogous to Agent Zero's ordered `_10_main_prompt.py` → `_11_tools_prompt.py` → `_13_skills_prompt.py` assembly. Keep this as a single synchronous function `buildInstructions(tools)` run once at startup.

## 3. Tool set (port conceptually, not file-for-file)

Implement each as a `libfx` tool object with explicit `idempotent`/`writes` flags (required by `libfx` v3+):

- `response` — ends the turn, equivalent to Agent Zero's final-answer tool; `idempotent: true`.
- `code_execution` — runs Python/Node/shell **unsandboxed**, directly in a local subprocess (Node's `child_process`), replacing Agent Zero's Dockerized Kali execution. Mark `idempotent: false`, `writes: true`. Document prominently in the README that this tool has no container isolation and must only be used in trusted local environments — this is the central tradeoff of removing Docker.
- `read_file` / `write_file` / `list_dir` — scoped to a configurable workspace root directory (e.g. `./workspace`), with basic path traversal guards. `read_file`/`list_dir` are `idempotent: true`; `write_file` is `idempotent: false, writes: true`.
- `web_search` — either implement via a simple HTTP call to a search API (e.g. SearXNG instance, Brave Search API, or Tavily) the user configures with an API key, or use AI Gateway's built-in `{ name: "web_search", providerExecuted: true }` tool if using AI Gateway. `idempotent: true`.
- `memory_save` / `memory_load` / `memory_delete` — backed by `src/memory.ts`'s local vector store (see section 4). `memory_save`/`memory_delete` are `idempotent: false, writes: true` (keyed by a document id and `executionId` so repeats are safe); `memory_load` is `idempotent: true`.
- `call_subordinate` — spin up a second `libfx` session (or `createFxEngine()` instance) with a different `instructions` string (a "profile"), pass it a task string, await its final text, and return that as the tool result — directly analogous to Agent Zero's `call_subordinate` tool which creates a child `Agent` and awaits its result. `idempotent: false` (spawns new work), `writes: false`.
- Optionally: `wait`, `notify_user` (simple console/log passthrough) ported as thin equivalents of Agent Zero's utility tools.
  Do not port browser/desktop/office tools — explicitly out of scope for the "lite" tier since they depend on the Docker-provided Linux desktop/Playwright environment Agent Zero normally ships.

## 4. Local memory (no Docker, no external vector DB)

- Implement `src/memory.ts` using an in-process vector index: either `faiss-node` (if acceptable as a native dependency) or a pure-JS brute-force cosine-similarity search over embeddings for small corpora, avoiding Agent Zero's Python FAISS/LangChain dependency chain entirely.
- Use AI Gateway's embedding models (or OpenAI's embeddings endpoint) for embedding generation, called directly via `fetch`, not through `libfx` (libfx doesn't provide embeddings, only chat model loop).
- Persist the index as a JSON file (`{ id, text, embedding, metadata }[]`) under `data/memory/<area>.json`, loaded into memory at startup and rewritten after each save/delete, mirroring Agent Zero's save-to-disk-after-each-write pattern in `plugins/_memory/helpers/memory.py`'s `_save_db()`.
- Support the same three areas Agent Zero uses (`main`, `fragments`, `solutions`) as a `metadata.area` field, and a similarity-threshold search function equivalent to `search_similarity_threshold`.

## 5. Session durability and the HTTP/stream API

- Implement `src/server.ts` with two routes modeled directly on the libfx README's example:
  - `POST /api/chat?sessionId=...` — calls `agent.session(sessionId).prompt(body)` and returns `turn.readable` as the response body (NDJSON stream).
  - `GET /api/chat/stream?sessionId=...&cursor=...` — calls `agent.session(sessionId).stream(cursor)` for reconnect support.
- Add minimal auth (a single shared local token from an env var, checked against a header) before allowing a request to open a given `sessionId`, since libfx explicitly states the host app must authorize session access itself.
- No Socket.IO/polling layer is needed — NDJSON streaming replaces Agent Zero's current Socket.IO-based live log sync for this lite tier. Document this as a deliberate simplification versus Agent Zero's full WebUI transport.

## 6. Minimal web UI

- Build a small static single-page client (plain HTML/JS, no framework required) that:
  - POSTs a prompt to `/api/chat`, reads the NDJSON stream, and renders `text_delta`/`tool_start`/`tool_end`/`turn_end` events as a simple chat transcript with inline tool-call indicators.
  - Stores the current `sessionId` in `localStorage` and resumes with `GET /api/chat/stream?cursor=...` on reconnect.
- This is intentionally much simpler than Agent Zero's existing Alpine.js/Socket.IO webui (`webui/index.js`, `webui/js/websocket.js`) and should not attempt to reuse that codebase, since the transport and framework differ entirely.

## 7. Documentation

- Write a top-level `README.md` explaining: this is a separate, Docker-free, trusted-local-use-only project inspired by `agent0ai/agent-zero`'s tool taxonomy and prompts, built on Vercel's `libfx`; it is not a drop-in replacement and intentionally omits sandboxing, browser/desktop automation, and multi-user isolation.
- Clearly document the unsandboxed `code_execution` tool's security implications (arbitrary local code execution with the permissions of the Node process) as the primary risk introduced by removing Docker.
- Document configuration: `AI_GATEWAY_API_KEY` (or custom `provider` config for local/OpenAI-compatible model servers), `A0_SLIM_WORKSPACE_DIR`, `A0_SLIM_AUTH_TOKEN`, `A0_SLIM_PORT`.

## 8. Testing

- Add a small test suite exercising: tool registration/`idempotent` flag validation at startup (libfx throws if unset), the memory save/load round trip, and an end-to-end smoke test using `createFxEngine()` directly (no durability) with a mocked/local model to validate the tool-call loop without requiring a real API key.

### Citations

**File:** extensions/python/system_prompt/_11_tools_prompt.py (L29-56)

```python
@extensible
async def build_prompt(agent: Agent) -> str:
    # collect tool files from all prompt directories
    prompt_dirs = subagents.get_paths(agent, "prompts")
    tool_files = files.get_unique_filenames_in_dirs(
        prompt_dirs, "agent.system.tool.*.md"
    )

    # per-file kwargs registered by plugin config extensions (e.g. _09_text_editor_config)
    all_tool_kwargs: dict[str, dict[str, Any]] = agent.get_data(TOOL_KWARGS_KEY) or {}

    tool_prompts: list[tuple[str, str]] = []
    for tool_file in tool_files:
        try:
            basename = os.path.basename(tool_file)
            extra = all_tool_kwargs.get(basename, {})
            tool = agent.read_prompt(basename, **extra)
            tool_prompts.append((basename, tool))
        except Exception as e:
            PrintStyle().error(f"Error loading tool '{tool_file}': {e}")

    tools = [
        tool
        for tool in tool_policy.filter_tool_prompts(agent, tool_prompts)
        if tool
    ]
    tools_str = "\n\n".join(tools)
    prompt = agent.read_prompt("agent.system.tools.md", tools=tools_str)
```

**File:** helpers/tool.py (L11-30)

```python
@dataclass
class Response:
    message:str
    break_loop: bool
    additional: dict[str, Any] | None = None

class Tool:

    def __init__(self, agent: Agent, name: str, method: str | None, args: dict[str,str], message: str, loop_data: LoopData | None, **kwargs) -> None:
        self.agent = agent
        self.name = name
        self.method = method
        self.args = args
        self.loop_data = loop_data
        self.message = message
        self.progress: str = ""

    @abstractmethod
    async def execute(self,**kwargs) -> Response:
        pass
```

**File:** tools/call_subordinate.py (L218-241)

```python
def _short_label(text: str, limit: int = 80) -> str:
    return " ".join(str(text or "").split())[:limit].rstrip()


class Delegation(Tool):

    async def execute(self, message="", reset="", context_id="", **kwargs):
        attachments = kwargs.get("attachments")
        attachments = attachments if isinstance(attachments, list) else []
        subordinate = get_or_create_subordinate(
            self.agent,
            profile=kwargs.get("profile", kwargs.get("agent_profile", "")),
            reset=reset,
            context_id=context_id or kwargs.get("agent_id", ""),
            name=kwargs.get("name", ""),
            message=message,
        )
        if subordinate.context is self.agent.context:
            result = await run_subordinate(self.agent, subordinate, message, attachments)
        else:
            task = subordinate.context.run_task(
                run_subordinate, self.agent, subordinate, message, attachments
            )
            try:
```

**File:** plugins/_memory/helpers/memory.py (L63-94)

```python
    @staticmethod
    def _get_embedding_config(agent=None):
        from plugins._model_config.helpers.model_config import get_embedding_model_config_object
        return get_embedding_model_config_object(agent)

    @staticmethod
    async def get(agent: Agent):
        memory_subdir = get_agent_memory_subdir(agent)
        if Memory.index.get(memory_subdir) is None:
            log_item = agent.context.log.log(
                type="util",
                heading=f"Initializing VectorDB in '/{memory_subdir}'",
            )
            db, created = Memory.initialize(
                log_item,
                Memory._get_embedding_config(agent),
                memory_subdir,
                False,
            )
            Memory.index[memory_subdir] = db
            wrap = Memory(db, memory_subdir=memory_subdir)
            knowledge_subdirs = get_knowledge_subdirs_by_memory_subdir(
                memory_subdir, agent.config.knowledge_subdirs or []
            )
            if knowledge_subdirs:
                await wrap.preload_knowledge(log_item, knowledge_subdirs, memory_subdir)
            return wrap
        else:
            return Memory(
                db=Memory.index[memory_subdir],
                memory_subdir=memory_subdir,
            )
```

**File:** plugins/_memory/helpers/memory.py (L547-551)

```python
    @staticmethod
    def _save_db_file(db: MyFaiss, memory_subdir: str):
        abs_dir = abs_db_dir(memory_subdir)
        db.save_local(folder_path=abs_dir)
        Memory._write_index_hash(abs_dir)
```

**File:** extensions/python/system_prompt/_10_main_prompt.py (L23-25)

```python
@extensible
async def build_prompt(agent: Agent) -> str:
    return agent.read_prompt("agent.system.main.md")
```

**File:** extensions/python/system_prompt/_13_skills_prompt.py (L23-39)

```python
@extensible
async def build_prompt(agent: Agent) -> str:
    if not tool_policy.resolve_tool(agent, "skills_tool").allowed:
        return ""

    available = skills_helper.list_skills(agent=agent)
    result: list[str] = []
    for skill in available:
        name = skill.name.strip().replace("\n", " ")[:100]
        descr = skill.description.replace("\n", " ").strip()
        if len(descr) > 100:
            descr = descr[:100].rstrip() + "..."
        result.append(f"- {name}: {descr}" if descr else f"- {name}")

    if not result:
        return ""
```


