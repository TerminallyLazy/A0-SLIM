"""Opt-in offline acceptance against the installed actual plugin runtime.

Pass the runtime directory produced by native-plugin-live-check.ts --keep.
Each case has independent bindings, source copies, database and receipts.
"""
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from uuid import uuid4

RUNTIME = Path(sys.argv.pop(1)).resolve(strict=True)
PYTHON = RUNTIME / "python/bin/python3"


class PluginTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="slim-plugin-security-")
        self.root = Path(self.temp.name).resolve()
        shutil.copytree(RUNTIME / "bundle", self.root / "bundle")
        shutil.copytree(RUNTIME / "source", self.root / "source")
        (self.root / "deps").symlink_to(RUNTIME / "deps", target_is_directory=True)
        self.project = self.root / "project"
        self.project.mkdir()
        self.database = self.project / "fixture.sqlite"
        db = sqlite3.connect(self.database)
        db.execute("create table test_items (id integer primary key, label text)")
        db.commit()
        db.close()
        self.before = hashlib.sha256(self.database.read_bytes()).hexdigest()
        self.binding = self.root / "binding.json"
        self.config = {"projectId": str(uuid4()), "installationId": str(uuid4()),
                       "projectRoot": str(self.project), "database": "fixture.sqlite", "enabled": True}
        self.save()

    def tearDown(self):
        self.assertEqual(hashlib.sha256(self.database.read_bytes()).hexdigest(), self.before)
        self.temp.cleanup()

    def save(self):
        self.binding.write_text(json.dumps(self.config))

    def command(self):
        return [str(PYTHON), "-I", "-B", str(self.root / "bundle/worker.py"), "--root", str(self.root), "--binding", str(self.binding)]

    def rpc(self, method, params=None):
        result = subprocess.run(self.command(), input=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}) + "\n", capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def descriptor(self):
        return self.rpc("tools/list")["result"]["tools"][0]["inputSchema"]["x-a0-slim-companion"]

    def call(self, operation=None, arguments=None, fingerprint=None):
        return self.rpc("tools/call", {"name": "db_hub_schema", "arguments": arguments or {}, "_meta": {"io.a0-slim/operation": {"id": operation or str(uuid4()), "fingerprint": fingerprint or self.descriptor()["fingerprint"]}}})

    def test_real_tool_reuses_remote_receipt_and_rejects_changed_arguments(self):
        operation = str(uuid4())
        first = self.call(operation)
        self.assertIn("test_items", json.dumps(first))
        self.assertEqual(self.call(operation), first)
        self.assertIn("error", self.call(operation, {"target": "test_items"}))

    def test_no_agent_zero_and_missing_client_identity_fails(self):
        result = subprocess.run([str(PYTHON), "-I", "-B", "-c", 'import importlib.util; assert importlib.util.find_spec("agent") is None'], capture_output=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn("error", self.rpc("tools/call", {"name": "db_hub_status", "arguments": {}}))
        self.assertIn("error", self.call(arguments={"database": "/etc/passwd"}))

    def test_revision_changes_are_not_approved_by_an_old_fingerprint(self):
        fingerprint = self.descriptor()["fingerprint"]
        self.config["projectId"] = str(uuid4())
        self.save()
        self.assertIn("error", self.call(fingerprint=fingerprint))

    def test_modified_source_fails_before_discovery(self):
        tool = self.root / "source/usr/plugins/db_hub/tools/db_schema.py"
        tool.write_text(tool.read_text() + "\n# drift\n")
        result = subprocess.run(self.command(), input='', text=True, capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')

    def test_unreviewed_files_and_database_symlinks_are_rejected(self):
        extra = self.root / "source/usr/plugins/db_hub/tools/override.py"
        extra.write_text('raise RuntimeError("unexpected")')
        result = subprocess.run(self.command(), input='', text=True, capture_output=True)
        self.assertEqual(result.returncode, 1)
        extra.unlink()
        (self.project / "alias.sqlite").symlink_to(self.database)
        self.config["database"] = "alias.sqlite"
        self.save()
        result = subprocess.run(self.command(), input='', text=True, capture_output=True)
        self.assertEqual(result.returncode, 1)

    def test_disabled_binding_retains_receipt_inspection(self):
        operation = str(uuid4())
        self.call(operation)
        self.config["enabled"] = False
        self.save()
        result = subprocess.run(self.command(), input='', text=True, capture_output=True)
        self.assertEqual(result.returncode, 1)
        receipt = subprocess.run(self.command() + ["--inspect", operation], capture_output=True, text=True)
        self.assertEqual(json.loads(receipt.stdout)["status"], "completed")

    def test_crash_after_real_tool_cannot_replay_and_reconciliation_does_not_execute(self):
        operation = str(uuid4())
        script = '''import sys,os,asyncio
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from worker import Worker
w=Worker(Path(sys.argv[2]),Path(sys.argv[3]))
w.journal.complete=lambda *args: os._exit(77)
asyncio.run(w.call("db_hub_schema", {}, {"io.a0-slim/operation":{"id":sys.argv[4],"fingerprint":w.descriptor()["fingerprint"]}}))
'''
        crashed = subprocess.run([str(PYTHON), '-I', '-B', '-c', script, str(self.root / 'bundle'), str(self.root), str(self.binding), operation], capture_output=True)
        self.assertEqual(crashed.returncode, 77, crashed.stderr)
        self.assertIn("error", self.call(operation))
        self.assertIn("error", self.call())
        receipt = subprocess.run(self.command() + ["--inspect", operation], capture_output=True, text=True)
        self.assertEqual(json.loads(receipt.stdout)["status"], "unknown")
        resolved = subprocess.run(self.command() + ["--resolve", operation, "--reason", "Verified fixture database bytes stayed unchanged."], capture_output=True, text=True)
        self.assertEqual(json.loads(resolved.stdout)["status"], "resolved")
        self.assertIn("error", self.call(operation))
        self.assertIn("test_items", json.dumps(self.call()))


unittest.main()
