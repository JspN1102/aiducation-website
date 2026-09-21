"""Refresh exact static-module fetch hints; use --check in validation."""
from pathlib import Path
import argparse
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'deploy'))
from module_preloads import render_index

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
path = ROOT / 'maanshan/index.html'
current = path.read_text(encoding='utf-8')
generated = render_index(path.parent, current)
if args.check:
    if current != generated:
        raise SystemExit('Module hints are stale; run python scripts/build-maanshan-preloads.py')
    print('Module hints match current source imports.')
elif current != generated:
    path.write_text(generated, encoding='utf-8', newline='')
    print('Updated maanshan/index.html module hints.')
else:
    print('Module hints already match current source imports.')
