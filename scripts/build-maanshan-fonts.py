"""Rebuild the web fonts from every current interface, game and content file.

Usage: python scripts/build-maanshan-fonts.py --source-directory PATH [--report FILE]
PATH contains
  NotoSansHK-full.ttf, NotoSerifHK-full.ttf  variable (wght) Hong Kong fonts: Google Fonts
      NotoSansHK[wght].ttf, or NotoSansHK-VF.ttf / NotoSerifHK-VF.ttf from the noto-cjk
      "Variable TTF" release (Variable/TTF/Subset), the same design
  NotoSansTC-full.ttf, NotoSerifTC-full.ttf  Google Fonts TC, for line metrics only
  NotoSansSC-full.ttf, NotoSerifSC-full.ttf  Google Fonts NotoSansSC[wght].ttf and
      NotoSerifSC[wght].ttf (the full fonts, about 17 and 25 MB): simplified characters
  Andika-Regular.ttf, Andika-Bold.ttf        SIL Andika 6.200 (software.sil.org/andika)
fontTools + Brotli and Node.js are required. Every family uses the SIL OFL.

The school teaches from the Hong Kong Lexical Lists for Chinese Learning in
Primary Schools, so Chinese uses the Hong Kong glyph standard (Noto HK), with
the line metrics of the Google Fonts builds so no layout moves.

What it writes, all in maanshan/vendor/fonts:
  noto-{sans,serif}-hk.woff2           every character of the platform's own files
                                       (scripts/font-text.cjs: interface, poems, games,
                                       teacher pages); the app installs them on every page
  noto-{sans,serif}-hk-variants.woff2  simplified handwriting variants of those files that
                                       the Hong Kong fonts lack, from the SC fonts of the
                                       same design (unicode-range faces in the stylesheets)
  noto-{sans,serif}-hk-ext-NN.woff2    the on-demand extension: the common characters of
                                       scripts/font-common-chars.txt and every server
                                       message character not above, about 200 per slice,
                                       most frequent first; a page downloads a slice only
                                       when its text uses one of the slice's characters
  school-pinyin-{400,700}.woff2        pinyin letters (below)
and maanshan/font-slices.mjs (the extension's slices and unicode ranges), the
variant unicode-range of styles.css and teacher-dashboard.css, and the ?v=
of every font URL in maanshan/ (the first 10 hex digits of the file's SHA-256),
so a changed font always has a new URL.

The build is deterministic and additive: it never drops a character an earlier
build shipped, an extension slice keeps its characters for good (later builds
only add slices; a character that moves into the main subset leaves the
slice's unicode-range, not the file), and a font whose content is unchanged is
not rewritten. Run it after any text change; server/font-coverage.test.cjs
fails until it has run.

Pinyin uses Andika, whose a and g are the single-storey forms of pinyin
teaching. Its subset holds Latin letters and tone marks only. Subsetting is a
modification under the OFL and "Andika" and "SIL" are Reserved Font Names, so
the subset is renamed School Pinyin; its line metrics are set to Noto Sans HK
so text with pinyin keeps the same line height.
"""
import argparse
import hashlib
import io
import json
import re
import subprocess
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

CHANGED_ON = '2026-09-29'
# Latin letters with every pinyin tone mark (ǎ ǐ ǒ ǔ ǖ ǘ ǚ ǜ ǹ ḿ), ɑ ɡ and the
# combining tone marks. Digits, spaces and punctuation stay with the Chinese font.
PINYIN_RANGES = [(0x41, 0x5A), (0x61, 0x7A), (0xC0, 0xD6), (0xD8, 0xF6), (0xF8, 0x17F), (0x1CD, 0x1DC),
                 (0x1F8, 0x1F9), (0x251, 0x251), (0x261, 0x261), (0x300, 0x30C), (0x1E3E, 0x1E3F)]
PINYIN_CODES = {code for low, high in PINYIN_RANGES for code in range(low, high + 1)}
FAMILIES = ('Sans', 'Serif')
SLICE_SIZE = 200
HASH_LENGTH = 10

parser = argparse.ArgumentParser()
parser.add_argument('--source-directory', type=Path, required=True)
parser.add_argument('--report', type=Path)
args = parser.parse_args()
source = args.source_directory
repo = Path(__file__).resolve().parents[1]
root = repo / 'maanshan'
fonts = root / 'vendor' / 'fonts'

text = json.loads(subprocess.run(['node', str(repo / 'scripts' / 'font-text.cjs'), '--json'],
                                 check=True, capture_output=True, encoding='utf-8').stdout)
base, client, server = set(text['base']), set(text['client']), set(text['server'])
required = base | client


def is_han(code):
    return 0x3400 <= code <= 0x9FFF or 0xF900 <= code <= 0xFAFF or 0x20000 <= code <= 0x3FFFF


def options(features=('*',)):
    result = subset.Options(); result.flavor = 'woff2'; result.layout_features = list(features)
    result.name_IDs = list(range(15)); result.name_languages = ['*']
    return result


def cmap(path):
    return set(TTFont(path, lazy=True).getBestCmap()) if path.exists() else set()


def copy_line_metrics(font, reference):
    """Vertical metrics of the reference, scaled to this font's em."""
    scale = font['head'].unitsPerEm / reference['head'].unitsPerEm
    for table, fields in (('hhea', ('ascent', 'descent', 'lineGap')),
                          ('OS/2', ('sTypoAscender', 'sTypoDescender', 'sTypoLineGap', 'usWinAscent', 'usWinDescent'))):
        for field in fields: setattr(font[table], field, round(getattr(reference[table], field) * scale))
    font['OS/2'].fsSelection = font['OS/2'].fsSelection & ~(1 << 7) | reference['OS/2'].fsSelection & (1 << 7)


def chinese_subset(path, codes, reference, keep_hinting=True):
    """The variable source font cut to codes, weights 400-700, reference line metrics."""
    font = TTFont(path) if isinstance(path, Path) else TTFont(io.BytesIO(path))
    sub = subset.Subsetter(options=options()); sub.populate(unicodes=codes); sub.subset(font)
    if 'fvar' in font:
        font = instantiateVariableFont(font, {'wght': (400, 700)}, inplace=True)
    copy_line_metrics(font, reference)
    if keep_hinting:
        for tag in ('gasp', 'prep'):
            if tag not in font and tag in reference: font[tag] = reference[tag]
    return font


def write_font(font, target):
    """Save as WOFF2 unless the file already holds the same font. The head
    table's modified date is the source font's (not the clock), and a font
    equal to the file but for that date keeps the file, so a rebuild with
    unchanged text rewrites nothing."""
    font.flavor = 'woff2'; font.recalcTimestamp = False

    def encode():
        buffer = io.BytesIO(); font.save(buffer); return buffer.getvalue()
    if target.exists():
        modified = font['head'].modified
        font['head'].modified = TTFont(target, lazy=True)['head'].modified
        if encode() == target.read_bytes(): return False
        font['head'].modified = modified
    target.write_bytes(encode())
    return True


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()[:HASH_LENGTH]


references = {family: TTFont(source / f'Noto{family}TC-full.ttf', lazy=True) for family in FAMILIES}
upstream = {}
for family in FAMILIES:
    hk = TTFont(source / f'Noto{family}HK-full.ttf', lazy=True)
    assert hk['name'].getDebugName(1).startswith(f'Noto {family} HK'), 'Not the Hong Kong source font'
    sc = TTFont(source / f'Noto{family}SC-full.ttf', lazy=True)
    assert sc['name'].getDebugName(1).startswith(f'Noto {family} SC'), 'Not the SC source font'
    upstream[family] = {'hk': set(hk.getBestCmap()), 'sc': set(sc.getBestCmap())}
    assert len(upstream[family]['sc']) > 20000, f'Noto{family}SC-full.ttf is not the full font'

reports, written, main_cover = [], [], {}
for family in FAMILIES:
    name = f'noto-{family.lower()}-hk'
    target, variants = fonts / f'{name}.woff2', fonts / f'{name}-variants.woff2'
    # Keep every glyph the last build had, whatever the old file name.
    previous = cmap(target) | cmap(fonts / f'{name.replace("-hk", "-tc")}.woff2')
    supported = upstream[family]['hk']
    expected = (required | previous) & supported
    font = chinese_subset(source / f'Noto{family}HK-full.ttf', expected, references[family])
    if write_font(font, target): written.append(target.name)
    actual = cmap(target)
    assert actual == expected, 'Main subset differs from the characters asked for'
    # Accepted simplified handwriting variants use the same Noto design, never
    # a per-character system fallback. The HK and TC sources omit these glyphs.
    supplement = ({code for code in required if is_han(code)} - actual) | cmap(variants)
    if supplement:
        missing = supplement - upstream[family]['sc']
        assert not missing, 'Chinese glyph absent in both upstream fonts: ' + ''.join(map(chr, sorted(missing)))
        font = chinese_subset(source / f'Noto{family}SC-full.ttf', supplement, references[family], keep_hinting=False)
        if write_font(font, variants): written.append(variants.name)
        assert cmap(variants) == supplement
    covered = actual | cmap(variants)
    assert not {code for code in required if is_han(code)} - covered
    main_cover[family] = covered
    reports.append({'font': target.name, 'bytes': target.stat().st_size, 'characters': len(actual),
                    'han': len({c for c in actual if is_han(c)}), 'variants': len(supplement),
                    'variantBytes': variants.stat().st_size if supplement else 0})

# Every character covered in one family's main or variant subset is covered in
# the other's, so one unicode-range per slice serves both families.
assert main_cover['Sans'] == main_cover['Serif'], 'Sans and Serif main subsets differ'
covered = main_cover['Sans']

# --- the on-demand extension --------------------------------------------------
lines = [line for line in (repo / 'scripts' / 'font-common-chars.txt').read_text(encoding='utf-8').splitlines()
         if line and not line.startswith('#')]
symbols = [ord(ch) for ch in lines[0]]
common = [ord(ch) for ch in ''.join(lines[1:])]
listed = set(symbols) | set(common)
# Server messages and prompt text not in the common list go to the last slice(s).
extra = sorted(code for code in server if code > 0x7E and code not in listed)
both = lambda kind: upstream['Sans'][kind] & upstream['Serif'][kind]
slices = []  # existing slices keep their characters
for path in sorted(fonts.glob('noto-sans-hk-ext-*.woff2')):
    number = path.stem.rsplit('-', 1)[1]
    members = cmap(path)
    kind = 'hk' if members <= both('hk') else 'sc'
    slices.append({'name': f'ext-{number}', 'kind': kind, 'members': members})
held = set().union(*(item['members'] for item in slices)) if slices else set()
fresh = {'symbols': [], 'hk': [], 'sc': []}
for group, codes in (('symbols', symbols), ('han', common + extra)):
    for code in codes:
        if code in covered or code in held: continue
        if code in both('hk'): kind = 'symbols' if group == 'symbols' else 'hk'
        elif is_han(code) and code in both('sc'): kind = 'sc'
        else: continue  # no glyph in either design: left to the system font
        fresh[kind].append(code); held.add(code)
number = max((int(item['name'][4:]) for item in slices), default=0)
for kind in ('symbols', 'hk', 'sc'):
    codes = fresh[kind]
    for start in range(0, len(codes), SLICE_SIZE):
        number += 1
        slices.append({'name': f'ext-{number:02d}', 'kind': 'sc' if kind == 'sc' else 'hk', 'members': set(codes[start:start + SLICE_SIZE]), 'new': True})

# Cut each new slice from one instanced subset of all new characters per source.
for family in FAMILIES:
    for kind in ('hk', 'sc'):
        todo = [item for item in slices if item['kind'] == kind and
                (item.get('new') or cmap(fonts / f'noto-{family.lower()}-hk-{item["name"]}.woff2') != item['members'])]
        if not todo: continue
        union = set().union(*(item['members'] for item in todo))
        pool = chinese_subset(source / f'Noto{family}{kind.upper()}-full.ttf', union, references[family], keep_hinting=kind == 'hk')
        pool.flavor = None; buffer = io.BytesIO(); pool.save(buffer); pool = buffer.getvalue()
        for item in todo:
            font = TTFont(io.BytesIO(pool))
            sub = subset.Subsetter(options=options()); sub.populate(unicodes=item['members']); sub.subset(font)
            target = fonts / f'noto-{family.lower()}-hk-{item["name"]}.woff2'
            if write_font(font, target): written.append(target.name)
            assert cmap(target) == item['members']

# --- pinyin -------------------------------------------------------------------
for style, weight in (('Regular', 400), ('Bold', 700)):
    font = TTFont(source / f'Andika-{style}.ttf')
    assert font['name'].getDebugName(1) == 'Andika' and font['name'].getDebugName(5) == 'Version 6.200', 'Not Andika 6.200'
    codes = PINYIN_CODES & set(font.getBestCmap())
    # Default shaping features only: the stylistic sets would bring back the
    # two-storey a and g.
    sub = subset.Subsetter(options=options(subset.Options().layout_features)); sub.populate(unicodes=codes); sub.subset(font)
    copy_line_metrics(font, references['Sans'])
    table = font['name']
    for record in list(table.names):
        if record.nameID in (1, 2, 3, 4, 6, 16, 17): table.removeNames(nameID=record.nameID)
    postscript = f'SchoolPinyin-{style}'
    for nameID, value in ((1, 'School Pinyin'), (2, style), (3, f'{postscript}-{CHANGED_ON}'), (4, f'School Pinyin {style}'), (6, postscript),
                          (10, f'Modified {CHANGED_ON} from Andika 6.200 by SIL International: subset to Latin letters and tone '
                               'marks for pinyin, renamed (Reserved Font Names), line metrics set to Noto Sans HK. '
                               'See scripts/build-maanshan-fonts.py.')):
        table.setName(value, nameID, 3, 1, 0x409)
    target = fonts / f'school-pinyin-{weight}.woff2'
    if write_font(font, target): written.append(target.name)
    assert not {0x61, 0x67, 0x101, 0x1CE, 0xFC, 0x1DA} - cmap(target)
    reports.append({'font': target.name, 'bytes': target.stat().st_size, 'glyphs': len(TTFont(target).getGlyphOrder()), 'weights': [weight]})

# --- references -----------------------------------------------------------------
versions = {path.name: digest(path) for path in fonts.glob('*.woff2')}
variant_range = ','.join(f'U+{code:X}' for code in sorted(cmap(fonts / 'noto-sans-hk-variants.woff2')))
assert variant_range == ','.join(f'U+{code:X}' for code in sorted(cmap(fonts / 'noto-serif-hk-variants.woff2')))
module = repo / 'maanshan' / 'font-slices.mjs'
entries = []
for item in sorted(slices, key=lambda item: item['name']):
    shown = ''.join(chr(code) for code in sorted(item['members'] - covered))
    entries.append('  {name: %s, versions: {sans: %s, serif: %s}, text: %s}' % (
        json.dumps(item['name']), json.dumps(versions[f'noto-sans-hk-{item["name"]}.woff2']),
        json.dumps(versions[f'noto-serif-hk-{item["name"]}.woff2']), json.dumps(shown, ensure_ascii=False)))
module_text = ('// Generated by scripts/build-maanshan-fonts.py; do not edit. The on-demand\n'
               '// extension of the Chinese fonts: per slice, the characters its unicode-range\n'
               '// covers (those of the slice file that the main and variant subsets lack) and\n'
               '// the ?v= of maanshan/vendor/fonts/noto-{sans,serif}-hk-<name>.woff2.\n'
               'export const FONT_SLICES = Object.freeze([\n' + ',\n'.join(entries) + '\n]);\n')
if not module.exists() or module.read_text(encoding='utf-8') != module_text:
    module.write_text(module_text, encoding='utf-8', newline='\n'); written.append(module.name)

url = re.compile(r'(vendor/fonts/([a-z0-9-]+\.woff2)\?v=)[A-Za-z0-9_-]+')
variant_face = re.compile(r"(@font-face\{[^}]*vendor/fonts/noto-(?:sans|serif)-hk-variants\.woff2[^}]*unicode-range:)[^;}]*")
source_entry = re.compile(r"(path: '/maanshan/vendor/fonts/([a-z0-9-]+\.woff2)', version: ')[^']*(')")
for path in sorted(root.rglob('*')):
    parts = set(path.relative_to(root).parts)
    if path.suffix not in {'.mjs', '.js', '.css', '.html'} or parts & {'vendor', 'media'} or path.name == 'app.bundle.css':
        continue
    before = path.read_bytes().decode('utf-8')  # line endings as they are
    after = url.sub(lambda m: m.group(1) + versions[m.group(2)], before)
    after = source_entry.sub(lambda m: m.group(1) + versions[m.group(2)] + m.group(3), after)
    after = variant_face.sub(lambda m: m.group(1) + variant_range, after)
    if after != before:
        path.write_bytes(after.encode('utf-8'))
        written.append(str(path.relative_to(repo)).replace('\\', '/'))

ext_files = [path for path in fonts.glob('noto-*-hk-ext-*.woff2')]
report = {'sourceFiles': text['clientFiles'], 'serverFiles': text['serverFiles'], 'fonts': reports,
          'extension': {'slices': len(slices), 'characters': len(held),
                        'sansBytes': sum(p.stat().st_size for p in ext_files if '-sans-' in p.name),
                        'serifBytes': sum(p.stat().st_size for p in ext_files if '-serif-' in p.name),
                        'largestSlice': max((p.stat().st_size for p in ext_files), default=0)},
          'variantUnicodeRange': variant_range, 'written': written,
          'pinyinUnicodeRange': ','.join(f'U+{low:X}-{high:X}' for low, high in PINYIN_RANGES)}
if args.report: args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
