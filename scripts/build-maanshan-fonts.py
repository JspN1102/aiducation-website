"""Rebuild the web fonts from every current interface, game and content file.

Usage: python scripts/build-maanshan-fonts.py --source-directory PATH
PATH contains
  NotoSansHK-full.ttf, NotoSerifHK-full.ttf  variable (wght) Hong Kong fonts: Google Fonts
      NotoSansHK[wght].ttf, or NotoSansHK-VF.ttf / NotoSerifHK-VF.ttf from the noto-cjk
      "Variable TTF" release (Variable/TTF/Subset), the same design
  NotoSansTC-full.ttf, NotoSerifTC-full.ttf  Google Fonts TC, for line metrics only
  NotoSansSC-full.ttf, NotoSerifSC-full.ttf  accepted simplified handwriting variants
  Andika-Regular.ttf, Andika-Bold.ttf        SIL Andika 6.200 (software.sil.org/andika)
fontTools + Brotli are required. Every family uses the SIL OFL.

The school teaches from the Hong Kong Lexical Lists for Chinese Learning in
Primary Schools, so Chinese uses the Hong Kong glyph standard (Noto HK), with
the line metrics of the Google Fonts builds so no layout moves.

Pinyin uses Andika, whose a and g are the single-storey forms of pinyin
teaching. Its subset holds Latin letters and tone marks only. Subsetting is a
modification under the OFL and "Andika" and "SIL" are Reserved Font Names, so
the subset is renamed School Pinyin; its line metrics are set to Noto Sans HK
so text with pinyin keeps the same line height.
"""
import argparse
import json
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

parser=argparse.ArgumentParser()
parser.add_argument('--source-directory',type=Path,required=True)
parser.add_argument('--report',type=Path)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]/'maanshan'
fonts=root/'vendor'/'fonts'
files=[p for p in root.rglob('*') if p.suffix in {'.mjs','.js','.json','.html','.css'} and not {'vendor','media'}&set(p.relative_to(root).parts) and p.name!='app.bundle.css']
required=set(range(32,127))|set(range(0xA0,0x250))|set(range(0x1E00,0x1F00))
for p in files: required.update(map(ord,p.read_text(encoding='utf-8')))
han={code for code in required if 0x3400<=code<=0x9fff}


def options(features=('*',)):
 result=subset.Options();result.flavor='woff2';result.layout_features=list(features)
 result.name_IDs=list(range(15));result.name_languages=['*']
 return result


def copy_line_metrics(font,reference):
 """Vertical metrics of the reference, scaled to this font's em."""
 scale=font['head'].unitsPerEm/reference['head'].unitsPerEm
 for table,fields in (('hhea',('ascent','descent','lineGap')),
                      ('OS/2',('sTypoAscender','sTypoDescender','sTypoLineGap','usWinAscent','usWinDescent'))):
  for field in fields: setattr(font[table],field,round(getattr(reference[table],field)*scale))
 font['OS/2'].fsSelection=font['OS/2'].fsSelection&~(1<<7)|reference['OS/2'].fsSelection&(1<<7)


reports=[]
for family,filename in [('Sans','noto-sans-hk.woff2'),('Serif','noto-serif-hk.woff2')]:
 target=fonts/filename
 # Keep every glyph the last build had, whatever the old file name.
 previous=set()
 for old in (target,fonts/filename.replace('-hk','-tc')):
  if old.exists(): previous|=set(TTFont(old).getBestCmap())
 source=args.source_directory
 font=TTFont(source/f'Noto{family}HK-full.ttf')
 assert font['name'].getDebugName(1).startswith(f'Noto {family} HK'), 'Not the Hong Kong source font'
 supported=set(font.getBestCmap())
 expected=(required|previous)&supported
 sub=subset.Subsetter(options=options());sub.populate(unicodes=expected);sub.subset(font)
 font=instantiateVariableFont(font,{'wght':(400,700)},inplace=True)
 reference=TTFont(source/f'Noto{family}TC-full.ttf',lazy=True)
 copy_line_metrics(font,reference)
 for tag in ('gasp','prep'):
  if tag not in font and tag in reference: font[tag]=reference[tag]
 font.flavor='woff2';font.save(target)
 actual=set(TTFont(target).getBestCmap())
 assert not expected-actual
 # Accepted simplified handwriting variants use the same Noto design, never
 # a per-character system fallback. The HK and TC sources omit these glyphs.
 supplement=han-actual
 if supplement:
  sc=TTFont(source/f'Noto{family}SC-full.ttf')
  assert not supplement-set(sc.getBestCmap()), 'Source Chinese glyph absent in both upstream fonts'
  sub=subset.Subsetter(options=options());sub.populate(unicodes=supplement);sub.subset(sc)
  sc=instantiateVariableFont(sc,{'wght':(400,700)},inplace=True)
  copy_line_metrics(sc,reference);sc.flavor='woff2'
  extra=target.with_name(filename.replace('.woff2','-variants.woff2'));sc.save(extra)
  actual.update(TTFont(extra).getBestCmap())
 assert not han-actual
 reports.append({'font':filename,'bytes':target.stat().st_size,'glyphs':len(actual),'sourceHan':len(han),'missingHanAfter':0,'weights':[400,700],'variantUnicodeRange':','.join('U+'+format(c,'X') for c in sorted(supplement))})

for style,weight in (('Regular',400),('Bold',700)):
 font=TTFont(args.source_directory/f'Andika-{style}.ttf')
 assert font['name'].getDebugName(1)=='Andika' and font['name'].getDebugName(5)=='Version 6.200', 'Not Andika 6.200'
 codes=PINYIN_CODES&set(font.getBestCmap())
 # Default shaping features only: the stylistic sets would bring back the
 # two-storey a and g.
 sub=subset.Subsetter(options=options(subset.Options().layout_features));sub.populate(unicodes=codes);sub.subset(font)
 copy_line_metrics(font,TTFont(args.source_directory/'NotoSansTC-full.ttf',lazy=True))
 name=font['name']
 for record in list(name.names):
  if record.nameID in (1,2,3,4,6,16,17): name.removeNames(nameID=record.nameID)
 postscript=f'SchoolPinyin-{style}'
 for nameID,value in ((1,'School Pinyin'),(2,style),(3,f'{postscript}-{CHANGED_ON}'),(4,f'School Pinyin {style}'),(6,postscript),
                      (10,f'Modified {CHANGED_ON} from Andika 6.200 by SIL International: subset to Latin letters and tone '
                          'marks for pinyin, renamed (Reserved Font Names), line metrics set to Noto Sans HK. '
                          'See scripts/build-maanshan-fonts.py.')):
  name.setName(value,nameID,3,1,0x409)
 font.flavor='woff2'
 target=fonts/f'school-pinyin-{weight}.woff2';font.save(target)
 assert not {0x61,0x67,0x101,0x1CE,0xFC,0x1DA}-set(TTFont(target).getBestCmap())
 reports.append({'font':target.name,'bytes':target.stat().st_size,'glyphs':len(TTFont(target).getGlyphOrder()),'weights':[weight]})

report={'sourceFiles':len(files),'fonts':reports,
        'pinyinUnicodeRange':','.join(f'U+{low:X}-{high:X}' for low,high in PINYIN_RANGES)}
if args.report:args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report))
