"""Bounded MCP stdio worker for original, pinned Hub tool implementations."""
import argparse
import asyncio
import contextlib
import hashlib
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import sys
from urllib.parse import quote
from uuid import UUID

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from compat import install
from journal import Journal

VERSION = "0.1.0"
OPERATIONS = {"db_hub_status": "db_status", "db_hub_schema": "db_schema"}


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def checked_file(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Missing or changed package file")
    return path.read_bytes()


class Worker:
    def __init__(self, root, binding_path, inspect_only=False):
        self.root = root.resolve(strict=True)
        self.binding_path = binding_path.resolve(strict=True)
        self.binding = json.loads(checked_file(self.binding_path))
        if set(self.binding) != {"projectId", "installationId", "projectRoot", "database", "enabled"}:
            raise ValueError("Invalid plugin binding")
        UUID(self.binding["projectId"])
        UUID(self.binding["installationId"])
        self.scope = digest({k: self.binding[k] for k in ("installationId", "projectId")})
        self.journal = Journal(self.binding_path.parent / "receipts" / self.scope)
        if inspect_only:
            return
        if self.binding["enabled"] is not True:
            raise ValueError("Plugin is disabled")
        self.recipe = json.loads(checked_file(HERE / "db-hub.json"))
        self.verify_sources()
        sys.path.insert(0, str(self.root / "deps"))
        for name, version in json.loads(checked_file(HERE / "dependency-versions.json")).items():
            if importlib.metadata.version(name) != version:
                raise ValueError("Plugin dependency version changed")
        sys.path.insert(0, str(self.root / "source"))
        self.database = self.check_database()
        config = {"connections": [{"id": "database", "driver": "sqlalchemy", "enabled": True,
                    "readonly": True, "dsn": "sqlite:///file:" + quote(str(self.database), safe="/") + "?mode=ro&uri=true"}],
                  "readonly_default": True, "query_timeout_s": 10, "memory_backend": {"enabled": False}}
        self.agent = install(self.root / "source/usr/plugins/db_hub", self.binding, config)
        # Guard against an accidental lazy installer or network dependency in
        # this audited SQLite adapter. This is defense in depth, not a sandbox.
        def audit(event, _args):
            if event in {"subprocess.Popen", "os.system", "os.posix_spawn", "socket.connect", "socket.bind"}:
                raise RuntimeError("This plugin recipe does not permit subprocesses or network access")
        sys.addaudithook(audit)
        self.fingerprint = self.revision()

    def check_database(self):
        project = Path(self.binding["projectRoot"])
        if project.resolve(strict=True) != project:
            raise ValueError("Project root changed")
        relative = Path(self.binding["database"])
        if relative.is_absolute() or not relative.parts or ".." in relative.parts:
            raise ValueError("Use a relative database path")
        current = project
        for part in relative.parts:
            if part in {".git", ".env", ".ssh", ".aws", ".a0-slim", "node_modules"} or part.startswith((".env.", ".a0-slim-")):
                raise ValueError("Database path is protected")
            current /= part
            if current.is_symlink():
                raise ValueError("Database symlinks are unsupported")
        if not current.is_file() or current.resolve() != current:
            raise ValueError("Choose an existing regular SQLite database")
        with current.open("rb") as stream:
            if stream.read(16) != b"SQLite format 3\x00":
                raise ValueError("Choose an SQLite database")
        return current

    def verify_sources(self):
        source = self.root / "source/usr/plugins/db_hub"
        for name, expected in self.recipe["files"].items():
            if hashlib.sha256(checked_file(source / name)).hexdigest() != expected:
                raise ValueError("Plugin source differs from its supported revision")
        actual = {p.relative_to(source).as_posix() for p in source.rglob("*") if p.is_file()}
        if actual != set(self.recipe["files"]):
            raise ValueError("Unexpected plugin files")
        for p in source.parents:
            if p == self.root:
                break
            if p.is_symlink():
                raise ValueError("Package path changed")

    def revision(self):
        if json.loads(checked_file(self.binding_path)) != self.binding:
            raise ValueError("Binding changed; reconnect")
        self.verify_sources()
        self.check_database()
        implementation = {p.name: hashlib.sha256(checked_file(p)).hexdigest()
                          for p in HERE.iterdir() if p.suffix in {".py", ".json", ".txt"}}
        return digest({"binding": self.binding, "recipe": self.recipe, "implementation": implementation})

    def descriptor(self):
        if self.revision() != self.fingerprint:
            raise ValueError("Compatibility changed; reconnect")
        return {"protocol": "a0-slim-tools/1", "scopeId": self.scope, "fingerprint": self.fingerprint}

    def tools(self):
        return [{"name": name, "description": "DB Hub " + operation + ". Read-only SQLite; no database writes, memory hooks or Agent Zero installation.",
                 "inputSchema": {"type": "object", "properties": ({"target": {"type": "string", "maxLength": 200}} if name.endswith("schema") else {}),
                                 "additionalProperties": False, "x-a0-slim-companion": self.descriptor()}}
                for name, operation in OPERATIONS.items()]

    async def call(self, name, arguments, meta):
        if name not in OPERATIONS or not isinstance(arguments, dict):
            raise ValueError("Unsupported operation")
        if set(arguments) - ({"target"} if name.endswith("schema") else set()):
            raise ValueError("Unexpected arguments")
        if "target" in arguments and (not isinstance(arguments["target"], str) or len(arguments["target"]) > 200):
            raise ValueError("Invalid target")
        operation = meta.get("io.a0-slim/operation", {})
        operation_id = str(UUID(operation["id"]))
        if operation.get("fingerprint") != self.descriptor()["fingerprint"]:
            raise ValueError("Stale compatibility fingerprint")
        with self.journal.exclusive():
            old = self.journal.begin(operation_id, digest({"name": name, "args": arguments, "revision": self.fingerprint}))
            if old is not None:
                return old
            try:
                from importlib import import_module
                module = import_module("usr.plugins.db_hub.tools." + OPERATIONS[name])
                tool_class = getattr(module, "DbSchema" if name.endswith("schema") else "DbStatus")
                tool = tool_class(self.agent, OPERATIONS[name], args=arguments)
                response = await asyncio.wait_for(tool.execute(connection="database", **arguments), timeout=12)
                if not isinstance(response.message, str) or len(response.message) > 48000:
                    raise ValueError("Plugin response exceeds the supported limit")
                result = {"operationId": operation_id, "status": "completed", "plugin": "db_hub", "commit": self.recipe["commit"],
                          "adapterVersion": VERSION, "operation": OPERATIONS[name], "output": response.message}
                self.journal.complete(operation_id, result)
                return result
            except BaseException:
                self.journal.unknown(operation_id)
                raise


async def serve(worker, output):
    # One operation at a time. EOF/process interruption never claims cancellation;
    # the persisted running record recovers as unknown on the next exclusive call.
    while True:
        raw = await asyncio.to_thread(sys.stdin.buffer.readline, 131073)
        if not raw:
            return
        if len(raw) > 131072 or not raw.endswith(b"\n"):
            return
        request = json.loads(raw)
        if "id" not in request:
            continue
        response = {"jsonrpc": "2.0", "id": request["id"]}
        try:
            method, params = request.get("method"), request.get("params", {})
            if method == "initialize":
                result = {"protocolVersion": "2025-11-25", "capabilities": {"tools": {}},
                          "serverInfo": {"name": "slim-plugin-worker", "version": VERSION}}
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {"tools": worker.tools()}
            elif method == "tools/call":
                result = {"content": [{"type": "text", "text": json.dumps(await worker.call(params["name"], params.get("arguments", {}), params.get("_meta", {})))}]}
            else:
                raise ValueError("Unsupported method")
            response["result"] = result
        except Exception:
            # Provider/library exception text is never sent to chat or stdout.
            response["error"] = {"code": -32000, "message": "Plugin rejected the request or its outcome is unknown. Review the plugin operation and reconnect."}
        output.write(json.dumps(response) + "\n")
        output.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--binding", required=True, type=Path)
    parser.add_argument("--inspect")
    parser.add_argument("--resolve")
    parser.add_argument("--reason")
    args = parser.parse_args()
    os.umask(0o077)
    output = sys.stdout
    with contextlib.redirect_stdout(sys.stderr):
        worker = Worker(args.root, args.binding, bool(args.inspect or args.resolve))
        if args.resolve:
            worker.journal.resolve(str(UUID(args.resolve)), args.reason or "")
        if args.inspect or args.resolve:
            output.write(json.dumps(worker.journal.inspect(str(UUID(args.inspect or args.resolve)))) + "\n")
        else:
            asyncio.run(serve(worker, output))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stderr.write("Plugin runtime could not start. Check its installation and project binding.\n")
        sys.exit(1)
