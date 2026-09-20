"""Rebuild both TC families from every current interface, game and content file.

Usage: python scripts/build-maanshan-fonts.py --source-directory PATH
PATH contains NotoSansTC/SC-full.ttf and NotoSerifTC/SC-full.ttf from Google Fonts.
fontTools + Brotli are required. The font families use the existing SIL OFL.
"""
import argparse
import json
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

parser=argparse.ArgumentParser()
parser.add_argument('--source-directory',type=Path,required=True)
parser.add_argument('--report',type=Path)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1]/'maanshan'
files=[p for p in root.rglob('*') if p.suffix in {'.mjs','.js','.json','.html','.css'} and not {'vendor','media'}&set(p.relative_to(root).parts) and p.name!='app.bundle.css']
required=set(range(32,127))|set(range(0xA0,0x250))|set(range(0x1E00,0x1F00))
for p in files: required.update(map(ord,p.read_text(encoding='utf-8')))
reports=[]
for name,filename in [('NotoSansTC','noto-sans-tc.woff2'),('NotoSerifTC','noto-serif-tc.woff2')]:
 target=root/'vendor'/'fonts'/filename
 previous=set(TTFont(target).getBestCmap())
 font=TTFont(args.source_directory/(name+'-full.ttf'))
 supported=set(font.getBestCmap())
 expected=(required|previous)&supported
 han={code for code in required if 0x3400<=code<=0x9fff}
 missing_before=han-previous
 options=subset.Options();options.flavor='woff2';options.layout_features=['*']
 sub=subset.Subsetter(options=options);sub.populate(unicodes=expected);sub.subset(font)
 font=instantiateVariableFont(font,{'wght':(400,700)},inplace=True)
 font.flavor='woff2';font.save(target)
 actual=set(TTFont(target).getBestCmap())
 assert not expected-actual
 # Accepted simplified handwriting variants use the same Noto design, never
 # a per-character system fallback. Google TC sources omit these glyphs.
 supplement=han-actual
 if supplement:
  sc=TTFont(args.source_directory/(name.replace('TC','SC')+'-full.ttf'))
  assert not supplement-set(sc.getBestCmap()), 'Source Chinese glyph absent in both upstream fonts'
  sub=subset.Subsetter(options=options);sub.populate(unicodes=supplement);sub.subset(sc)
  sc=instantiateVariableFont(sc,{'wght':(400,700)},inplace=True);sc.flavor='woff2'
  extra=target.with_name(filename.replace('.woff2','-variants.woff2'));sc.save(extra)
  actual.update(TTFont(extra).getBestCmap())
 assert not han-actual
 reports.append({'font':filename,'bytes':target.stat().st_size,'glyphs':len(actual),'sourceHan':len(han),'missingHanBefore':len(missing_before),'missingHanAfter':0,'weights':[400,700],'variantUnicodeRange':','.join('U+'+format(c,'X') for c in sorted(supplement))})
report={'sourceFiles':len(files),'fonts':reports}
if args.report:args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report))
