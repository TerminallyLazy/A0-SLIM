"""Opt-in framework tests. Run in the disposable host after companion-host-fixture.py."""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from uuid import uuid4
from unittest.mock import patch

from usr.plugins.slim_tools_bridge.host import Host
from usr.plugins.slim_tools_bridge.journal import Journal

BINDING = Path('/slim-a0/usr/slim-tools-fixture.json')
assert Path.cwd() == Path('/slim-a0')


class JournalTests(unittest.TestCase):
    def test_receipt_reuse_changed_arguments_and_unknown_hold(self):
        with tempfile.TemporaryDirectory() as temp:
            j = Journal(Path(temp))
            with j.exclusive():
                self.assertIsNone(j.begin('one', 'digest'))
                j.complete('one', {'answer': 42})
                self.assertEqual(j.begin('one', 'digest'), {'answer': 42})
                with self.assertRaises(RuntimeError): j.begin('one', 'changed')
                j.begin('two', 'digest2')
            reopened = Journal(Path(temp))
            with reopened.exclusive():
                self.assertEqual(reopened.inspect('two')['status'], 'unknown')
                with self.assertRaises(RuntimeError): reopened.begin('three', 'digest3')
            reopened.resolve('two', 'Checked the synthetic operation outcome.')
            with reopened.exclusive():
                with self.assertRaises(RuntimeError): reopened.begin('two', 'digest2')
                self.assertIsNone(reopened.begin('three', 'digest3'))

    def test_second_process_cannot_clear_a_live_lock(self):
        with tempfile.TemporaryDirectory() as temp:
            j = Journal(Path(temp))
            with j.exclusive():
                j.begin('active', 'digest')
                script = 'from pathlib import Path; from usr.plugins.slim_tools_bridge.journal import Journal; j=Journal(Path(__import__("sys").argv[1]));\nwith j.exclusive(): pass'
                result = subprocess.run([sys.executable, '-c', script, temp], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(j.inspect('active')['status'], 'running')


class HostTests(unittest.TestCase):
    def setUp(self):
        self.host = Host(BINDING)

    def call(self, host=None, args=None, meta=None, name='a0_db_hub_db_schema'):
        h = host or self.host
        return asyncio.run(h.call(name, args or {'connection': 'fixture'}, meta or {'id': str(uuid4()), 'fingerprint': h.descriptor()['fingerprint']}))

    def test_real_tool_and_remote_deduplication(self):
        meta = {'id': str(uuid4()), 'fingerprint': self.host.descriptor()['fingerprint']}
        first = self.call(meta=meta)
        self.assertIn('synthetic_inventory', first['output'])
        second = self.call(host=Host(BINDING), meta=meta)
        self.assertEqual(first, second)
        with self.assertRaises(RuntimeError): self.call(args={'connection': 'fixture', 'target': 'synthetic_inventory'}, meta=meta)

    def test_arguments_and_revision_fail_before_dispatch(self):
        for args in ({'connection': 'other'}, {'connection': 'fixture', 'statement': 'DROP TABLE synthetic_inventory'}):
            with self.assertRaises(ValueError): self.call(args=args)
        with self.assertRaises(ValueError): self.call(name='a0_db_hub_db_query')
        operation = str(uuid4())
        with self.assertRaises(RuntimeError): self.call(meta={'id': operation, 'fingerprint': '0' * 64})
        self.assertIsNone(self.host.journal.inspect(operation))

    def test_scoped_policy_and_configuration_changes(self):
        policy = Path('/slim-a0/usr/projects/slim-proof/.a0proj/plugins/_tool_access/config.json')
        policy.parent.mkdir(parents=True, exist_ok=True)
        previous = policy.read_bytes() if policy.exists() else None
        try:
            policy.write_text(json.dumps({'mode': 'custom', 'default': 'block', 'allowed': [], 'blocked': []}))
            with self.assertRaises(RuntimeError): self.host.descriptor()
            denied = Host(BINDING)
            with self.assertRaises(Exception): self.call(host=denied)
        finally:
            policy.write_bytes(previous) if previous is not None else policy.unlink()

    def test_disable_preserves_inspection(self):
        before = BINDING.read_bytes()
        try:
            binding = json.loads(before); binding['enabled'] = False
            BINDING.write_text(json.dumps(binding))
            with self.assertRaises(ValueError): self.host.descriptor()
            inspector = Host(BINDING, inspect_only=True)
            self.assertEqual(inspector.scope, self.host.scope)
        finally: BINDING.write_bytes(before)

    def test_hook_argument_mutation_holds_before_tool_dispatch(self):
        operation = str(uuid4())
        self.host.agent.set_data('last_tool_call', {'last_tool_output': 'synthetic_inventory'})
        try:
            with self.assertRaises(RuntimeError):
                self.call(args={'connection': 'fixture', 'target': '{last_tool_output}'}, meta={'id': operation, 'fingerprint': self.host.descriptor()['fingerprint']})
            self.assertEqual(self.host.journal.inspect(operation)['status'], 'unknown')
        finally:
            self.host.journal.resolve(operation, 'Synthetic hook changed arguments; bridge refused before DB tool execution.')

    def test_shadowed_python_is_rejected(self):
        shadow = Path('/slim-a0/usr/projects/slim-proof/tools/db_schema.py')
        shadow.parent.mkdir(parents=True, exist_ok=True)
        try:
            shadow.write_text('raise RuntimeError("never execute")')
            with self.assertRaises(RuntimeError): self.host.descriptor()
        finally: shadow.unlink()

    def test_project_profile_isolation(self):
        original = self.host.scope
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json') as file:
            value = json.loads(BINDING.read_text()); value['project'] = 'missing-project'
            json.dump(value, file); file.flush()
            with self.assertRaises(ValueError): Host(file.name)
            self.assertNotEqual(Host(file.name, inspect_only=True).scope, original)
        self.host.agent.config.profile = 'developer'
        with self.assertRaises(RuntimeError): self.host.descriptor()

    def test_synthetic_secret_is_masked_in_result_and_receipt(self):
        from helpers.secrets import get_project_secrets_manager
        from usr.plugins.db_hub.helpers.drivers.sqlalchemy import SqlAlchemyDriver
        manager = get_project_secrets_manager('slim-proof')
        before = manager.read_secrets_raw()
        marker = 'SYNTHETIC_SECRET_43928'
        manager.save_secrets('PROOF_SECRET=' + marker)
        async def schema(driver, target=''): return {'tables': [marker]}
        try:
            with patch.object(SqlAlchemyDriver, 'list_schema', schema):
                result = self.call()
            self.assertNotIn(marker, json.dumps(result))
            self.assertNotIn(marker, self.host.journal.inspect(result['operationId'])['result'])
        finally: manager.save_secrets(before)

    def test_process_death_after_real_tool_before_receipt_completion(self):
        operation = str(uuid4())
        script = '''import asyncio,os,sys
from usr.plugins.slim_tools_bridge.host import Host
h=Host(sys.argv[1]); h.journal.complete=lambda *args: os._exit(77)
asyncio.run(h.call("a0_db_hub_db_schema", {"connection":"fixture"}, {"id":sys.argv[2],"fingerprint":h.descriptor()["fingerprint"]}))
'''
        result = subprocess.run([sys.executable, '-c', script, str(BINDING), operation], capture_output=True)
        self.assertEqual(result.returncode, 77)
        recovered = Host(BINDING)
        try:
            with self.assertRaises(RuntimeError): self.call(host=recovered)
            self.assertEqual(recovered.journal.inspect(operation)['status'], 'unknown')
        finally: recovered.journal.resolve(operation, 'Synthetic schema read completed; process exited before storing its result.')


if __name__ == '__main__':
    unittest.main()
