"""Hong Kong stroke order for the tracing data (maanshan/vendor/hanzi-data).

The tracing data comes from Hanzi Writer Data 2.0 (Make Me a Hanzi, Arphic
Public License), which follows mainland stroke order. Ten of the characters
used here are written differently in the EDB Lexical List of Chinese
Characters for Hong Kong primary schools: four only in order, six with one
stroke written as two (one of them, 遙, also in order). In four more a dot
goes another way in Hong Kong (雨 in 霑 has 點、提、撇點、點). This script
rewrites those files from the original data: reorders strokes, cuts one
stroke in two where Hong Kong writes two, giving each part a rounded end and
its own centre line, and mirrors or turns a dot about its own centre.
Everything else is left as it was. Each rewritten file carries a notice of
the change, as the Arphic Public License asks.

Eleven more followed on 2026-10-05: 花 萬 梅 船 舊 鄰 雪 含 罷 敢 籬. Besides
the edits above, 敢 and 籬 cut a stroke at its corner (橫折 as 橫、豎; 撇折
in 厶 as 撇、提), and 罷 turns the 撇 that starts each 匕 into a 提.

The source must be the unmodified files (hanzi-writer-data 2.0 on npm, or
git show 759a572:maanshan/vendor/hanzi-data/<hex>.json); a checksum stops the
script from converting a converted file a second time. Name characters after
the options to convert only those.

    python scripts/build-hk-stroke-order.py --source <original files> --destination maanshan/vendor/hanzi-data [characters]
"""
import argparse, hashlib, json, math, pathlib, re
from shapely.geometry import Polygon, LineString, Point, box
from shapely.affinity import rotate as shp_rotate, scale as shp_scale
from shapely.ops import split, unary_union

# order: new position -> original stroke index; 'a'/'b' name the two parts of a cut stroke.
EDITS = {
    '情': {'order': [0, 2, 1, 3, 4, 5, 6, 7, 8, 9, 10]},
    '惜': {'order': [0, 2, 1, 3, 4, 5, 6, 7, 8, 9, 10]},
    '舟': {'order': [0, 1, 2, 3, 5, 4]},
    '重': {'order': [0, 1, 2, 3, 4, 5, 7, 6, 8]},
    # 艹: the one horizontal becomes two with a small gap; 橫、豎、橫、豎.
    '荷': {'gap': 0, 'order': ['0a', 1, '0b', 2, 3, 4, 5, 6, 7, 8, 9]},
    # 辶: 橫折折撇 becomes 橫折撇 + 豎彎 at the turn; 阝: 橫撇彎鈎 becomes 橫撇 + 彎鈎.
    '送': {'turn': 7, 'order': [0, 1, 2, 3, 4, 5, 6, '7a', '7b', 8]},
    # 遙 also writes the top of 䍃 as 撇、橫撇, then the two dots, upper one first.
    '遙': {'turn': 11, 'order': [0, 3, 2, 1] + list(range(4, 11)) + ['11a', '11b', 12]},
    '遠': {'turn': 11, 'order': list(range(11)) + ['11a', '11b', 12]},
    '還': {'turn': 14, 'order': list(range(14)) + ['14a', '14b', 15]},
    '隔': {'turn': 0, 'order': ['0a', '0b'] + list(range(1, 12))},
    # dots: stroke index -> (mirror | rotate, Hong Kong direction in degrees, y up).
    '霑': {'dots': {5: ('mirror', 25), 6: ('mirror', -140)}},
    '洲': {'dots': {3: ('mirror', -30)}},
    '嶺': {'dots': {5: ('rotate', 10)}},
    '低': {'dots': {6: ('rotate', 5)}},
    '花': {'gap': 0, 'order': ['0a', 1, '0b', 2, 3, 4, 5, 6]},
    # 艹 already in four strokes, but 豎、橫 each time; Hong Kong 橫、豎. The top of 舊 is 橫、豎、豎、橫.
    '萬': {'order': [1, 0, 3, 2] + list(range(4, 13))},
    '舊': {'order': [1, 0] + list(range(2, 18))},
    # 母: both dots before the long horizontal; 舟 as in 舟.
    '梅': {'order': list(range(9)) + [10, 9]},
    '船': {'order': [0, 1, 2, 3, 5, 4] + list(range(6, 11))},
    '鄰': {'turn': 12, 'order': list(range(12)) + ['12a', '12b', 13]},
    # corner: cut at the sharpest bend of the centre line; 敢 starts 橫、豎, 厶 in 籬 is 撇、提、點.
    '敢': {'corner': 0, 'order': ['0a', '0b'] + list(range(1, 11))},
    '籬': {'corner': 14, 'order': list(range(14)) + ['14a', '14b'] + list(range(15, 24))},
    '雪': {'dots': {5: ('mirror', 25), 6: ('mirror', -140)}},
    '含': {'dots': {2: ('rotate', 10)}},
    # turned: like dots, for the 撇 that Hong Kong writes as 提 at the top of each 匕 in 能.
    '罷': {'turned': {11: ('rotate', 10), 13: ('rotate', 10)}},
}
# sha256 (first 16 hex) of the original files as compact JSON with sorted keys.
ORIGINAL = {'情': '307eb32919cdd1ef', '惜': '58ac55615318f3b7', '舟': 'f26cbefda2177d40', '重': '77aad250a1d567a1',
            '荷': '4ad1c5d77c5521ba', '送': 'b90e8660f5134ee8', '遙': '628fb3c48e934625', '遠': '1f01078f667dee7c',
            '還': '2498e61b038dd71e', '隔': 'ba8a5d3c08b5201a', '霑': '039200e73329a2ca', '洲': 'f0a9920e3863ada7',
            '嶺': 'f50a7d976c77752d', '低': '9347e6cbd4a30761',
            '花': '49c54257e567f152', '萬': '5e6e0dbef0264270', '舊': '5f7ac1674059785d', '梅': '67341b86539b9410',
            '船': 'd740b970e57ebabf', '鄰': '0a609080aad9de02', '敢': 'b07018977c89474a', '籬': '486abf2ebe675738',
            '雪': '31f36fd3e5407f3d', '含': '42f8db00abe2bf6a', '罷': '6cbf76dbe4813016'}
CHANGED_ON = {ch: '2026-09-29' for ch in '情惜舟重荷送遙遠還隔霑洲嶺低'}
CHANGED_ON.update({ch: '2026-10-05' for ch in '花萬舊梅船鄰敢籬雪含罷'})


def checksum(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()[:16]


def notice(ch):
    spec, done = EDITS[ch], []
    if 'gap' in spec or 'turn' in spec or 'corner' in spec:
        done.append(f"original stroke {int(str(next(k for k in spec['order'] if isinstance(k, str)))[:-1]) + 1} cut in two")
    if 'dots' in spec:
        many = 's' if len(spec['dots']) > 1 else ''
        done.append(f"dot{many} at stroke{many} " + ', '.join(str(i + 1) for i in spec['dots']) + ' turned')
    if 'turned' in spec:
        many = 's' if len(spec['turned']) > 1 else ''
        done.append(f"stroke{many} " + ', '.join(str(i + 1) for i in spec['turned']) + ' turned')
    if 'order' in spec and [int(str(k).rstrip('ab')) for k in spec['order']] != sorted(int(str(k).rstrip('ab')) for k in spec['order']):
        done.append('strokes reordered')
    return (f"Modified {CHANGED_ON[ch]} from Hanzi Writer Data 2.0 (Make Me a Hanzi, Arphic Public License) for Hong Kong "
            f"stroke order: {'; '.join(done)}. See scripts/build-hk-stroke-order.py.")


def flatten(d, steps=16):
    toks = re.findall(r'[MLQCZ]|-?\d+(?:\.\d+)?', d)
    pts, i, cmd, cur = [], 0, None, (0, 0)
    arity = {'M': 2, 'L': 2, 'Q': 4, 'C': 6}
    while i < len(toks):
        if toks[i].isalpha():
            cmd = toks[i]; i += 1
            if cmd == 'Z':
                continue
        n = arity[cmd]; v = [float(t) for t in toks[i:i + n]]; i += n
        if cmd in 'ML':
            cur = (v[0], v[1]); pts.append(cur)
        elif cmd == 'Q':
            p0, p1, p2 = cur, (v[0], v[1]), (v[2], v[3])
            for k in range(1, steps + 1):
                t = k / steps
                pts.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
                            (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]))
            cur = p2
        else:
            p0, p1, p2, p3 = cur, (v[0], v[1]), (v[2], v[3]), (v[4], v[5])
            for k in range(1, steps + 1):
                t = k / steps; a, b, c, e = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
                pts.append((a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]))
            cur = p3
    return Polygon(pts).buffer(0)


def path_of(poly):
    if poly.geom_type != 'Polygon':
        poly = max(poly.geoms, key=lambda g: g.area)
    poly = poly.simplify(0.35, preserve_topology=True)
    ring = list(poly.exterior.coords)[:-1]
    f = lambda v: ('%.1f' % v).rstrip('0').rstrip('.')
    return 'M ' + ' L '.join(f'{f(x)} {f(y)}' for x, y in ring) + ' Z'


def ellipse(cx, cy, rx, ry):
    return shp_scale(Point(cx, cy).buffer(1, resolution=32), rx, ry)


def cut_median(median, line):
    """Split a median polyline where it first crosses the cut line: the points before the crossing,
    the crossing, and the points after it (a vertex lying on the cut belongs to neither side)."""
    for k in range(len(median) - 1):
        hit = LineString([median[k], median[k + 1]]).intersection(line)
        if not hit.is_empty:
            p = hit if hit.geom_type == 'Point' else Point(list(hit.geoms)[0].coords[0]) if hasattr(hit, 'geoms') else Point(hit.coords[0])
            p = (p.x, p.y); near = lambda q: math.dist(q, p) < 0.5
            head = [q for q in median[:k + 1] if not near(q)]; tail = [q for q in median[k + 1:] if not near(q)]
            return head, p, tail
    raise ValueError('median does not cross the cut')


def along(a, b, dist):
    """Point `dist` beyond b, continuing the direction a -> b."""
    dx, dy = b[0] - a[0], b[1] - a[1]; n = math.hypot(dx, dy) or 1
    return (b[0] + dx / n * dist, b[1] + dy / n * dist)


def rint(p):
    return [int(round(p[0])), int(round(p[1]))]


def polyline(points):
    """Whole-number points without repeats: HanziWriter compares directions segment by segment,
    and a zero-length segment makes every attempt at that stroke fail."""
    out = []
    for q in points:
        q = rint(q)
        if not out or q != out[-1]:
            out.append(q)
    assert len(out) >= 2, points
    return out


def split_at_turn(outline, median):
    """Cut a stroke across itself where its centre line is furthest left in the middle
    (the turn of 辶 and 阝). Both parts keep a shallow rounded end that overlaps the other."""
    xs = [p[0] for p in median]
    top = next(j for j in range(1, len(xs) - 1) if xs[j] >= xs[j - 1] and xs[j] > xs[j + 1])
    k = next(j for j in range(top + 1, len(xs) - 1) if xs[j] <= xs[j - 1] and xs[j] < xs[j + 1])
    y = median[k][1]
    poly = flatten(outline)
    probe = LineString([(median[k][0] - 120, y), (median[k][0] + 120, y)]).intersection(poly)
    segs = [probe] if probe.geom_type == 'LineString' else list(probe.geoms)
    seg = min(segs, key=lambda s: s.distance(Point(median[k])))
    x1, x2 = sorted(c[0] for c in seg.coords)
    line = LineString([(x1 - 1, y), (x2 + 1, y)])
    parts = list(split(poly, line).geoms)
    assert len(parts) == 2, ('cut did not give two parts', len(parts))
    start = Point(median[0])
    a = min(parts, key=lambda g: g.distance(start)); b = parts[1] if parts[0] is a else parts[0]
    w = x2 - x1; depth = min(12.0, w * 0.28); xm = (x1 + x2) / 2
    cap = ellipse(xm, y, w * 0.62, depth).intersection(poly)
    a2 = unary_union([a, cap.intersection(b)]); b2 = unary_union([b, cap.intersection(a)])
    head, p, tail = cut_median(median, LineString([(x1 - 5, y), (x2 + 5, y)]))
    ma = polyline(head + [p, along(head[-1], p, depth * 0.6)])
    mb = polyline([along(tail[0], p, depth * 0.6), p] + tail)
    return (path_of(a2), ma), (path_of(b2), mb), {'cutY': round(y), 'width': round(w)}


def split_at_corner(outline, median):
    """Cut a stroke at the sharpest bend of its centre line (the corner of 橫折 or 撇折), along the
    line that halves the corner. Both parts keep a shallow rounded end that overlaps the other."""
    first, last = median[0], median[-1]

    def bend(j):
        a = math.atan2(median[j][1] - first[1], median[j][0] - first[0])
        b = math.atan2(last[1] - median[j][1], last[0] - median[j][0])
        return abs((math.degrees(b - a) + 180) % 360 - 180)
    # leave out the small hooks within a stroke's width of either end
    inner = [j for j in range(1, len(median) - 1) if math.dist(median[j], first) > 50 and math.dist(median[j], last) > 50]
    c = median[max(inner, key=bend)]
    unit = lambda x, y: (x / math.hypot(x, y), y / math.hypot(x, y))
    u = unit(first[0] - c[0], first[1] - c[1]); v = unit(last[0] - c[0], last[1] - c[1])
    d = unit(u[0] + v[0], u[1] + v[1])
    at = lambda t: (c[0] + d[0] * t, c[1] + d[1] * t)
    poly = flatten(outline)
    probe = LineString([at(-150), at(150)]).intersection(poly)
    segs = [probe] if probe.geom_type == 'LineString' else list(probe.geoms)
    seg = min(segs, key=lambda s: s.distance(Point(c)))
    t1, t2 = sorted((q[0] - c[0]) * d[0] + (q[1] - c[1]) * d[1] for q in seg.coords)
    parts = list(split(poly, LineString([at(t1 - 1), at(t2 + 1)])).geoms)
    assert len(parts) == 2, ('cut did not give two parts', len(parts))
    start = Point(first)
    a = min(parts, key=lambda g: g.distance(start)); b = parts[1] if parts[0] is a else parts[0]
    w = t2 - t1; depth = min(12.0, w * 0.28); m = at((t1 + t2) / 2)
    cap = shp_rotate(ellipse(m[0], m[1], w * 0.62, depth), math.degrees(math.atan2(d[1], d[0])), origin=m).intersection(poly)
    a2 = unary_union([a, cap.intersection(b)]); b2 = unary_union([b, cap.intersection(a)])
    head, p, tail = cut_median(median, LineString([at(t1 - 5), at(t2 + 5)]))
    ma = polyline(head + [p, along(head[-1], p, depth * 0.6)])
    mb = polyline([along(tail[0], p, depth * 0.6), p] + tail)
    return (path_of(a2), ma), (path_of(b2), mb), {'corner': rint(c), 'width': round(w)}


def split_with_gap(outline, median, left_x, right_x, gap=30):
    """Break a horizontal in two between the two verticals (艹 as 十十), rounding both new ends."""
    poly = flatten(outline)
    xc = (left_x + right_x) / 2; xl, xr = xc - gap / 2, xc + gap / 2
    minx, miny, maxx, maxy = poly.bounds

    def column(x):
        s = LineString([(x, miny - 5), (x, maxy + 5)]).intersection(poly)
        ys = [c[1] for c in s.coords] if s.geom_type == 'LineString' else [c[1] for g in s.geoms for c in g.coords]
        return min(ys), max(ys)
    lo_l, hi_l = column(xl); lo_r, hi_r = column(xr)
    rl = (hi_l - lo_l) / 2; rr = (hi_r - lo_r) / 2
    left = unary_union([poly.intersection(box(minx - 5, miny - 5, xl - rl, maxy + 5)),
                        poly.intersection(ellipse(xl - rl, (lo_l + hi_l) / 2, rl, rl))])
    right = unary_union([poly.intersection(box(xr + rr, miny - 5, maxx + 5, maxy + 5)),
                         poly.intersection(ellipse(xr + rr, (lo_r + hi_r) / 2, rr, rr))])
    h1, p1, _ = cut_median(median, LineString([(xl - rl * 0.4, miny - 50), (xl - rl * 0.4, maxy + 50)]))
    _, p2, t2 = cut_median(median, LineString([(xr + rr * 0.4, miny - 50), (xr + rr * 0.4, maxy + 50)]))
    ml = polyline(h1 + [p1])
    mr = polyline([p2] + t2)
    return (path_of(left), ml), (path_of(right), mr), {'gapFrom': round(xl), 'gapTo': round(xr), 'thickness': round(rl * 2)}


def turn_dot(outline, median, kind, target):
    """Mirror or rotate a dot about its own centre so its centre line points at `target` degrees.
    Outline control points are moved with the same map, so the curves stay as drawn."""
    c = flatten(outline).centroid; cx, cy = c.x, c.y
    a = math.degrees(math.atan2(median[-1][1] - median[0][1], median[-1][0] - median[0][0]))
    if kind == 'mirror':
        phi = math.radians((a + target) / 2); m = (math.cos(2 * phi), math.sin(2 * phi), math.sin(2 * phi), -math.cos(2 * phi))
    else:
        t = math.radians(target - a); m = (math.cos(t), -math.sin(t), math.sin(t), math.cos(t))
    move = lambda x, y: (cx + m[0] * (x - cx) + m[1] * (y - cy), cy + m[2] * (x - cx) + m[3] * (y - cy))
    toks = re.findall(r'[MLQCZ]|-?\d+(?:\.\d+)?', outline); out, nums = [], []
    for t in toks + ['Z']:
        if t.isalpha():
            for i in range(0, len(nums), 2):
                x, y = move(nums[i], nums[i + 1]); out += [('%.1f' % x).rstrip('0').rstrip('.'), ('%.1f' % y).rstrip('0').rstrip('.')]
            nums = []; out.append(t)
        else:
            nums.append(float(t))
    return ' '.join(out[:-1]), polyline([move(*q) for q in median])


def vertical_x_at(median, y):
    for k in range(len(median) - 1):
        (xa, ya), (xb, yb) = median[k], median[k + 1]
        if min(ya, yb) <= y <= max(ya, yb) and ya != yb:
            return xa + (xb - xa) * (y - ya) / (yb - ya)
    raise ValueError('vertical does not reach y')


def convert(ch, data):
    spec = EDITS[ch]; strokes, medians = data['strokes'], data['medians']
    parts, info = {}, {}
    if 'turn' in spec:
        i = spec['turn']; a, b, info = split_at_turn(strokes[i], medians[i]); parts[f'{i}a'], parts[f'{i}b'] = a, b
    if 'gap' in spec:
        i = spec['gap']; hy = sum(p[1] for p in medians[i]) / len(medians[i])
        lx, rx = vertical_x_at(medians[1], hy), vertical_x_at(medians[2], hy)
        a, b, info = split_with_gap(strokes[i], medians[i], lx, rx); parts[f'{i}a'], parts[f'{i}b'] = a, b
    if 'corner' in spec:
        i = spec['corner']; a, b, info = split_at_corner(strokes[i], medians[i]); parts[f'{i}a'], parts[f'{i}b'] = a, b
    strokes, medians = list(strokes), list(medians)
    for i, (kind, target) in {**spec.get('dots', {}), **spec.get('turned', {})}.items():
        strokes[i], medians[i] = turn_dot(strokes[i], medians[i], kind, target)
    new_s, new_m, origin = [], [], []
    for key in spec.get('order', range(len(strokes))):
        if isinstance(key, int):
            new_s.append(strokes[key]); new_m.append(medians[key]); origin.append(key)
        else:
            new_s.append(parts[key][0]); new_m.append(parts[key][1]); origin.append(int(key[:-1]))
    assert sorted(set(origin)) == list(range(len(strokes))), (ch, origin)
    for m in new_m:
        assert len(m) >= 2 and all(a != b for a, b in zip(m, m[1:])), (ch, 'repeated point in a centre line', m)
    out = {'notice': notice(ch), 'strokes': new_s, 'medians': new_m}
    if data.get('radStrokes') is not None:
        rad = set(data['radStrokes']); out['radStrokes'] = [n for n, o in enumerate(origin) if o in rad]
    return out, info


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', type=pathlib.Path, required=True, help='directory with the original Make Me a Hanzi files')
    ap.add_argument('--destination', type=pathlib.Path, required=True)
    ap.add_argument('characters', nargs='?', default=''.join(EDITS), help='convert only these (default: all)')
    args = ap.parse_args()
    assert set(args.characters) <= set(EDITS), ('no edit for', set(args.characters) - set(EDITS))
    report = {}
    for ch in args.characters:
        name = format(ord(ch), 'x') + '.json'
        data = json.loads((args.source / name).read_text(encoding='utf-8'))
        assert checksum(data) == ORIGINAL[ch], (ch, 'expected the unmodified original file')
        out, info = convert(ch, data)
        (args.destination / name).write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        report[ch] = {'strokes': len(out['strokes']), **info}
    print(json.dumps(report, ensure_ascii=False))
