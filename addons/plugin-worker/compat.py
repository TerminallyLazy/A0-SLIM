"""Small, explicit API contract for reviewed tool adapters; not an Agent Zero runtime."""
import asyncio
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType, SimpleNamespace


@dataclass
class Response:
    message: str
    break_loop: bool = False
    additional: dict | None = None


class Tool:
    def __init__(self, agent, name, method=None, args=None, message="", loop_data=None, **kwargs):
        self.agent, self.name, self.args = agent, name, args or {}
        self.method, self.message, self.loop_data = method, message, loop_data


class NoSecrets:
    def replace_placeholders(self, text):
        if "§§secret(" in text:
            raise ValueError("This SQLite adapter does not accept secret references")
        return text

    def mask_values(self, text):
        return text


def install(plugin_root: Path, binding: dict, config: dict):
    """Expose only APIs used by the pinned DB Hub read-only tool recipe.

    No agent module, provider/model access, hook dispatcher, memory override,
    scheduler, default/global settings, or runtime package installer is exposed.
    """
    context = SimpleNamespace(project=binding["projectId"])

    async def intervention(*_args):
        # Cooperative cancellation is propagated by asyncio, never a second agent loop.
        await asyncio.sleep(0)

    agent = SimpleNamespace(context=context, config=SimpleNamespace(profile="slim"),
                            handle_intervention=intervention)

    def require_plugin(name):
        if name != "db_hub":
            raise ValueError("Plugin is outside the binding")
        return str(plugin_root)

    def get_config(name, agent=None, project_name="", agent_profile=""):
        require_plugin(name)
        if agent is not None and agent.context is not context:
            raise ValueError("Project is outside the binding")
        if project_name and project_name != binding["projectId"]:
            raise ValueError("Project is outside the binding")
        return config

    def path(*parts):
        value = Path(*parts)
        value = value if value.is_absolute() else plugin_root / value
        resolved = value.resolve()
        if not resolved.is_relative_to(plugin_root):
            raise ValueError("Compatibility file API is confined to the plugin package")
        return str(resolved)

    def project(ctx):
        if ctx is not context:
            raise ValueError("Project is outside the binding")
        return binding["projectId"]

    def module(name, **members):
        value = ModuleType(name)
        value.__dict__.update(members)
        sys.modules[name] = value
        return value

    helpers = module("helpers")
    helpers.__path__ = []
    helpers.tool = module("helpers.tool", Tool=Tool, Response=Response)
    helpers.plugins = module("helpers.plugins", get_plugin_config=get_config,
                             find_plugin_dir=require_plugin)
    helpers.projects = module("helpers.projects", get_context_project_name=project)
    helpers.files = module("helpers.files", get_abs_path=path,
                           exists=lambda p: Path(path(p)).exists(),
                           read_file=lambda p: Path(path(p)).read_text())
    # SQLite has no credentials. Reject any placeholder instead of falling back
    # to a user's Agent Zero secrets or environment.
    secret = NoSecrets()
    helpers.secrets = module("helpers.secrets", get_secrets_manager=lambda ctx: secret,
                             get_default_secrets_manager=lambda: secret,
                             get_project_secrets_manager=lambda *a, **k: secret)
    return agent
