"""Create a deterministic source-only Agent Zero plugin ZIP. Executes no plugin code."""
import argparse
import hashlib
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = root / 'integrations/agent-zero-tools'
names = ['__init__.py', 'host.py', 'journal.py', 'server.py', 'runtime-pins.json', 'plugin.yaml', 'README.md', 'LICENSE']
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
    for name in sorted(names):
        info = ZipInfo(name, (2026, 10, 28, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (source / name).read_bytes())
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert sorted(archive.namelist()) == sorted(names)
print(f'{hashlib.sha256(output.read_bytes()).hexdigest()}  {output}')
