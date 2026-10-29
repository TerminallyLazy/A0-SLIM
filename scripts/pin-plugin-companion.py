"""Regenerate source hashes from exact Git objects, ignoring working-tree edits."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--agent-zero', required=True)
parser.add_argument('--db-hub', required=True)
args = parser.parse_args()
host = 'ff2a5b9c9c4e490ba38dd7c313e779510bb2071a'
plugin = '9f3b9926cdd815034b0f9f635c60909107d1f2da'
roots = ['helpers', 'extensions', 'plugins', 'tools', 'agents', 'prompts', 'conf']
files = {}
for repository, revision, prefix in [(args.agent_zero, host, ''), (args.db_hub, plugin, 'usr/plugins/db_hub/')]:
    raw = subprocess.check_output(['git', '-C', repository, 'archive', '--format=tar', revision])
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        for entry in archive:
            path = Path(entry.name)
            if entry.isfile() and path.suffix in {'.py', '.yaml', '.md'} and (prefix or path.parts[0] in roots or len(path.parts) == 1):
                files[prefix + entry.name] = hashlib.sha256(archive.extractfile(entry).read()).hexdigest()
output = Path(__file__).resolve().parents[1] / 'integrations/agent-zero-tools/runtime-pins.json'
output.write_text(json.dumps({'agentZero': host, 'dbHub': plugin, 'scanRoots': roots + ['usr/plugins/db_hub'], 'files': dict(sorted(files.items()))}, indent=2) + '\n')
print(f'Pinned {len(files)} source files from immutable Git objects.')
