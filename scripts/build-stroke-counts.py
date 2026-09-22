"""Build maanshan/vendor/stroke-counts.json from the Unicode Unihan database.

The table lets the dictation grader tell a component reading (雨 for 霑) from a
different character of similar size (借 for 惜). It is one JSON string with a
printable ASCII character per code point from U+4E00 to U+9FFF, holding
33 + total strokes, or '!' when Unihan has no kTotalStrokes value. Where
Unihan lists a zh-Hans and a zh-Hant count, the zh-Hant count is used.

    python scripts/build-stroke-counts.py path/to/Unihan.zip
"""
import io
import json
import sys
import zipfile
from pathlib import Path

FIRST, LAST = 0x4E00, 0x9FFF
FIELD = '\tkTotalStrokes\t'
OUTPUT = Path(__file__).resolve().parent.parent / 'maanshan' / 'vendor' / 'stroke-counts.json'


def main(archive):
    counts = {}
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.namelist():
            if not member.endswith('.txt'):
                continue
            with bundle.open(member) as raw:
                for line in io.TextIOWrapper(raw, encoding='utf-8'):
                    if FIELD not in line:
                        continue
                    code, _field, value = line.rstrip('\n').split('\t')
                    point = int(code[2:], 16)
                    if FIRST <= point <= LAST:
                        counts[point] = int(value.split()[-1])
    table = ''.join(chr(33 + counts[p]) if p in counts and counts[p] <= 90 else '!' for p in range(FIRST, LAST + 1))
    OUTPUT.write_text(json.dumps(table) + '\n', encoding='ascii', newline='\n')
    print(f'{len(counts)} code points, {LAST - FIRST + 1} slots -> {OUTPUT}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
