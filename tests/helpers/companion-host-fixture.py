"""Run only in a disposable, network-disabled Agent Zero host at /slim-a0."""
import json
import sqlite3
from pathlib import Path

ROOT = Path('/slim-a0')
assert Path.cwd() == ROOT, 'This fixture must run in the disposable proof host'
assert not (ROOT / 'usr/slim-tools-fixture.json').exists(), 'Never reset an existing fixture'
for directory in (ROOT / 'plugins').iterdir():
    if directory.is_dir() and directory.name != '_tool_access':
        override = ROOT / 'usr/plugins' / directory.name
        override.mkdir(parents=True, exist_ok=True)
        (override / '.toggle-0').touch()
from helpers import projects
projects.create_project('slim-proof', {'title': 'SLIM synthetic fixture', 'description': '', 'instructions': '', 'color': '', 'git_url': '', 'file_structure': {'enabled': False}})
db_path = ROOT / 'usr/slim-proof.db'
with sqlite3.connect(db_path) as db:
    db.execute('CREATE TABLE synthetic_inventory(id INTEGER PRIMARY KEY, label TEXT NOT NULL)')
    db.execute("INSERT INTO synthetic_inventory(label) VALUES('synthetic example')")
config = {'connections': [{'id': 'fixture', 'name': 'Synthetic database', 'driver': 'sqlalchemy', 'dsn': f'sqlite:///{db_path}', 'enabled': True, 'readonly': True}], 'max_rows': 20, 'query_timeout_s': 5, 'readonly_default': True, 'memory_backend': {'enabled': False, 'connections': [], 'prefix': 'mem'}}
directory = ROOT / 'usr/projects/slim-proof/.a0proj/plugins/db_hub'
directory.mkdir(parents=True, exist_ok=True)
(directory / 'config.json').write_text(json.dumps(config))
(ROOT / 'usr/slim-tools-fixture.json').write_text(json.dumps({'project': 'slim-proof', 'profile': 'default', 'connections': ['fixture'], 'enabled': True}))
print('Synthetic fixture configured; no provider credentials or model call.')
