"""Version-pinned Agent Zero dispatch. Only two audited operations are exported."""
import asyncio
import hashlib
import hmac
import inspect
import json
import os
import re
import secrets
from pathlib import Path
from uuid import UUID

from .journal import Journal

VERSION = "0.1.0"
PROTOCOL = "a0-slim-tools/1"
OPERATIONS = {"a0_db_hub_db_status": "db_status", "a0_db_hub_db_schema": "db_schema"}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


class Host:
    def __init__(self, binding_path, inspect_only=False):
        self.root = Path(__file__).resolve().parents[3]
        self.binding_path = Path(binding_path).resolve(strict=True)
        self.binding = self.read_binding(require_enabled=not inspect_only)
        identity_dir = self.root / "usr/slim-tools-bridge"
        identity_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        identity_path = identity_dir / "installation.id"
        try:
            fd = os.open(identity_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as out:
                out.write(secrets.token_hex(32))
        except FileExistsError:
            pass
        identity = identity_path.read_text()
        if not re.fullmatch(r"[a-f0-9]{64}", identity):
            raise RuntimeError("Companion installation identity is incomplete; retry startup")
        self.scope = sha(identity + ":" + self.binding["project"] + ":" + self.binding["profile"])
        self.journal = Journal(self.root / "usr" / "slim-tools-bridge" / self.scope)
        if inspect_only:
            return
        key_path = self.journal.directory / "fingerprint.key"
        try:
            fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as out:
                out.write(secrets.token_bytes(32))
        except FileExistsError:
            pass
        self.key = key_path.read_bytes()
        if len(self.key) != 32:
            raise RuntimeError("Companion identity is incomplete; retry startup")
        self.pins = json.loads(Path(__file__).with_name("runtime-pins.json").read_text())
        self.verify_sources()
        os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "True"
        from agent import AgentConfig, AgentContext, AgentContextType, LoopData
        from helpers import projects
        if not Path(projects.get_project_meta(self.binding['project'], 'project.json')).is_file():
            raise ValueError('The bound Agent Zero project does not exist')
        projects.load_basic_project_data(self.binding["project"])
        self.context = AgentContext(config=AgentConfig(mcp_servers="{}", profile=self.binding["profile"]),
                                    type=AgentContextType.BACKGROUND,
                                    data={projects.CONTEXT_DATA_KEY_PROJECT: self.binding["project"]})
        self.agent = self.context.agent0
        self.agent.loop_data = LoopData()
        self.initial_revision = self.revision()

    def read_binding(self, require_enabled=True):
        value = json.loads(self.binding_path.read_text())
        if set(value) != {"project", "profile", "connections", "enabled"}:
            raise ValueError("Binding requires project, profile, connections and enabled only")
        if not all(isinstance(value[k], str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value[k]) for k in ("project", "profile")):
            raise ValueError("Invalid project/profile binding")
        if not isinstance(value["enabled"], bool) or (require_enabled and not value["enabled"]):
            raise ValueError("Companion binding is disabled")
        if not isinstance(value["connections"], list) or not 1 <= len(value["connections"]) <= 10 or not all(isinstance(x, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", x) for x in value["connections"]):
            raise ValueError("Bind between one and ten explicit connection IDs")
        return value

    def verify_sources(self):
        for relative, expected in self.pins["files"].items():
            path = self.root / relative
            if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise RuntimeError("Agent Zero or DB Hub source differs from the supported pin")
        # Additional executable overrides would invalidate the audited dispatch path.
        directories = [self.root / p for p in self.pins["scanRoots"]]
        directories += [self.root / "usr" / p for p in ("agents", "extensions", "tools")]
        directories += [self.root / "usr/projects" / self.binding["project"]]
        for directory in directories:
            for path in directory.rglob("*.py"):
                if path.relative_to(self.root).as_posix() not in self.pins["files"]:
                    raise RuntimeError("Unreviewed Python override in the companion host")
        custom = self.root / "usr/plugins"
        for directory in custom.iterdir():
            if directory.is_dir() and directory.name not in {"db_hub", "slim_tools_bridge", "__pycache__"} and any(directory.rglob("*.py")):
                raise RuntimeError("This companion preview requires a dedicated host without other custom Python plugins")

    def revision(self):
        if self.read_binding() != self.binding:
            raise RuntimeError("Binding changed; reconnect and discover again")
        self.verify_sources()
        from helpers import cache, plugins, tool_policy, projects
        if self.agent.config.profile != self.binding['profile'] or projects.get_context_project_name(self.context) != self.binding['project']:
            raise RuntimeError('Agent context changed its project/profile binding')
        cache.clear_all()
        if not {"db_hub", "slim_tools_bridge"}.issubset(plugins.get_enabled_plugins(self.agent)):
            raise RuntimeError("DB Hub or the companion is disabled in this scope")
        # Any active executable hook can affect calls; include active plugin config and policy.
        enabled = plugins.get_enabled_plugins(self.agent)
        configs = {name: plugins.get_plugin_config(name, agent=self.agent) for name in enabled}
        from sqlalchemy.engine import make_url
        db_config = configs['db_hub'] or {}
        if (db_config.get('memory_backend') or {}).get('enabled'):
            raise RuntimeError('Memory replacement is outside the companion preview')
        entries = {entry.get('id'): entry for entry in db_config.get('connections', [])}
        for connection in self.binding['connections']:
            entry = entries.get(connection, {})
            if entry.get('driver') != 'sqlalchemy' or not entry.get('enabled', True) or not entry.get('readonly', db_config.get('readonly_default', True)):
                raise RuntimeError('The preview requires enabled read-only SQLAlchemy connections')
            url = make_url(entry.get('dsn', ''))
            if url.drivername != 'sqlite' or url.query or not url.database or not Path(url.database).is_absolute() or not Path(url.database).is_file():
                raise RuntimeError('The preview supports existing local SQLite databases only')
        for name in ("_infection_check", "_telegram_integration", "_whatsapp_integration", "_email_integration"):
            if name in enabled:
                raise RuntimeError("Disable agent/network lifecycle plugins in the dedicated companion host")
        source = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(__file__).parent.glob("*.py")}
        material = {"version": VERSION, "pins": self.pins, "source": source, "binding": self.binding, "configs": configs, "policy": tool_policy.get_policy(self.agent)}
        return hmac.new(self.key, canonical(material).encode(), hashlib.sha256).hexdigest()

    def descriptor(self):
        revision = self.revision()
        if revision != self.initial_revision:
            raise RuntimeError("Configuration changed; restart the companion before discovery")
        return {"protocol": PROTOCOL, "fingerprint": revision, "scopeId": self.scope}

    async def call(self, name, arguments, metadata):
        if name not in OPERATIONS:
            raise ValueError("Operation is not exported")
        operation_id = str(UUID(metadata["id"]))
        if set(arguments) - ({"connection", "target"} if name.endswith("db_schema") else {"connection"}):
            raise ValueError("Unexpected operation argument")
        if arguments.get("connection") not in self.binding["connections"]:
            raise ValueError("Connection is outside the binding")
        if "target" in arguments and (not isinstance(arguments["target"], str) or len(arguments["target"]) > 200):
            raise ValueError("Invalid schema target")
        with self.journal.exclusive():
            fingerprint = self.descriptor()["fingerprint"]
            if metadata.get("fingerprint") != fingerprint:
                raise RuntimeError("Compatibility revision changed; discover and approve again")
            from helpers import tool_policy, extension
            tool_name = OPERATIONS[name]
            decision = tool_policy.ensure_tool_allowed(self.agent, tool_name)
            if decision.tool_id != f"plugin:db_hub:{tool_name}":
                raise RuntimeError("Tool resolved outside the pinned plugin")
            args = dict(arguments)
            tool = self.agent.get_tool(tool_name, None, args, "SLIM approved tool call", self.agent.loop_data)
            if Path(inspect.getfile(tool.execute)).resolve() != self.root / "usr/plugins/db_hub/tools" / f"{tool_name}.py":
                raise RuntimeError("Shadowed plugin tool")
            signature = sha(canonical({"name": name, "args": args, "revision": fingerprint}))
            old = self.journal.begin(operation_id, signature)
            if old is not None:
                return old
            self.agent.loop_data.current_tool = tool
            try:
                await self.agent.handle_intervention()
                await tool.before_execution(**args)
                await self.agent.handle_intervention()
                await extension.call_extensions_async("tool_execute_before", self.agent, tool_args=args, tool_name=tool_name)
                if canonical(args) != canonical(arguments) or self.revision() != fingerprint:
                    raise RuntimeError("Hooks changed the approved arguments or configuration")
                response = await asyncio.wait_for(tool.execute(**args), timeout=12)
                from helpers.secrets import get_secrets_manager
                response.message = get_secrets_manager(self.context).mask_values(response.message)
                await self.agent.handle_intervention()
                await extension.call_extensions_async("tool_execute_after", self.agent, response=response, tool_name=tool_name)
                await tool.after_execution(response)
                await self.agent.handle_intervention()
                if len(response.message) > 48000:
                    raise RuntimeError("Plugin output exceeds the companion limit")
                result = {"operationId": operation_id, "status": "completed", "fingerprint": fingerprint, "plugin": "db_hub", "operation": tool_name, "output": response.message}
                self.journal.complete(operation_id, result)
                return result
            except BaseException:
                self.journal.unknown(operation_id)
                raise RuntimeError("Operation outcome is unknown; inspect the receipt on the host") from None
            finally:
                self.agent.loop_data.current_tool = None
