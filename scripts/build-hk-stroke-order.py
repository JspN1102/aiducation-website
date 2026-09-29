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

The source must be the unmodified files (hanzi-writer-data 2.0 on npm, or
git show 759a572:maanshan/vendor/hanzi-data/<hex>.json); a checksum stops the
script from converting a converted file a second time.

    python scripts/build-hk-stroke-order.py --source <original files> --destination maanshan/vendor/hanzi-data
"""
import argparse, hashlib, json, math, pathlib, re
from shapely.geometry import Polygon, LineString, Point, box
from shapely.affinity import scale as shp_scale
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
}
# sha256 (first 16 hex) of the original files as compact JSON with sorted keys.
ORIGINAL = {'情': '307eb32919cdd1ef', '惜': '58ac55615318f3b7', '舟': 'f26cbefda2177d40', '重': '77aad250a1d567a1',
            '荷': '4ad1c5d77c5521ba', '送': 'b90e8660f5134ee8', '遙': '628fb3c48e934625', '遠': '1f01078f667dee7c',
            '還': '2498e61b038dd71e', '隔': 'ba8a5d3c08b5201a', '霑': '039200e73329a2ca', '洲': 'f0a9920e3863ada7',
            '嶺': 'f50a7d976c77752d', '低': '9347e6cbd4a30761'}
CHANGED_ON = '2026-09-29'


def checksum(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()[:16]


def notice(ch):
    spec, done = EDITS[ch], []
    if 'gap' in spec or 'turn' in spec:
        done.append(f"original stroke {int(str(next(k for k in spec['order'] if isinstance(k, str)))[:-1]) + 1} cut in two")
    if 'dots' in spec:
        many = 's' if len(spec['dots']) > 1 else ''
        done.append(f"dot{many} at stroke{many} " + ', '.join(str(i + 1) for i in spec['dots']) + ' turned')
    if 'order' in spec and [int(str(k).rstrip('ab')) for k in spec['order']] != sorted(int(str(k).rstrip('ab')) for k in spec['order']):
        done.append('strokes reordered')
    return (f"Modified {CHANGED_ON} from Hanzi Writer Data 2.0 (Make Me a Hanzi, Arphic Public License) for Hong Kong "
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
    strokes, medians = list(strokes), list(medians)
    for i, (kind, target) in spec.get('dots', {}).items():
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
    args = ap.parse_args()
    report = {}
    for ch in EDITS:
        name = format(ord(ch), 'x') + '.json'
        data = json.loads((args.source / name).read_text(encoding='utf-8'))
        assert checksum(data) == ORIGINAL[ch], (ch, 'expected the unmodified original file')
        out, info = convert(ch, data)
        (args.destination / name).write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        report[ch] = {'strokes': len(out['strokes']), **info}
    print(json.dumps(report, ensure_ascii=False))
