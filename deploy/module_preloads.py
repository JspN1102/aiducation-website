"""Generate fetch-only module hints from the exact source import URLs."""
from pathlib import Path
from html import escape
import json
import re
from urllib.parse import urljoin, urlsplit, unquote

START = '<!-- school-module-preloads:start -->'
END = '<!-- school-module-preloads:end -->'
BLOCK = re.compile(re.escape(START) + r'.*?' + re.escape(END) + r'\s*', re.S)
# Preserve quoted strings while removing comments, including commented imports.
COMMENTS = re.compile(r'''("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|/\*[\s\S]*?\*/|//[^\n]*''')
STATIC = re.compile(r'''^\s*(?:import\s+(?:(?:[^;\n'"()]+|\{[^}]*\})\s+from\s+)?|export\s+(?:\*\s*(?:as\s+\w+\s+)?|\{[^}]*\})\s+from\s+)['"]([^'"]+)['"]''', re.M)
DYNAMIC = re.compile(r'''\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)''')


def uncomment(source):
    return COMMENTS.sub(lambda match: match.group(1) or '\n' * match.group(0).count('\n'), source)


class ModuleGraph:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        self.sources = {}

    def resolve(self, parent, specifier):
        if not specifier.startswith(('./', '../')):
            raise ValueError('Only local relative school imports are supported: ' + specifier)
        resolved = urlsplit(urljoin('https://school.invalid/maanshan/' + parent, specifier))
        if resolved.netloc != 'school.invalid' or not resolved.path.startswith('/maanshan/') or resolved.fragment:
            raise ValueError('Import leaves the school directory: ' + specifier)
        return resolved.path[len('/maanshan/'):] + ('?' + resolved.query if resolved.query else '')

    def source(self, url):
        if url not in self.sources:
            path = (self.directory / unquote(urlsplit(url).path)).resolve()
            if not path.is_relative_to(self.directory) or path.suffix not in {'.js', '.mjs'}:
                raise ValueError('Invalid school module: ' + url)
            self.sources[url] = uncomment(path.read_text(encoding='utf-8'))
        return self.sources[url]

    def closure(self, entries):
        result, visited = [], set()

        def visit(url):
            if url in visited:
                return
            visited.add(url)
            result.append(url)
            for specifier in STATIC.findall(self.source(url)):
                visit(self.resolve(url, specifier))

        for entry in entries:
            visit(entry)
        return result

    def dynamic(self, parent, filename):
        candidates = [self.resolve(parent, value) for value in DYNAMIC.findall(self.source(parent))
                      if urlsplit(value).path.rsplit('/', 1)[-1] == filename]
        if len(set(candidates)) != 1:
            raise ValueError('Expected one dynamic ' + filename + ' import in ' + parent)
        return candidates[0]


def preload_data(directory, index):
    clean = BLOCK.sub('', index)
    app = re.search(r'''<link\b[^>]*rel=["']modulepreload["'][^>]*href=["'](app\.js[^"']*)["']''', clean)
    bootstrap = re.search(r'''<script\b[^>]*src=["'](bootstrap\.mjs[^"']*)["']''', clean)
    if not app or not bootstrap:
        raise ValueError('School index is missing its app or bootstrap entry')
    graph = ModuleGraph(directory)
    startup = graph.closure([bootstrap.group(1), app.group(1)])
    challenge = graph.dynamic(app.group(1), 'challenge.mjs')
    exploration = graph.dynamic(app.group(1), 'exploration.mjs')
    dispatcher = graph.dynamic(challenge, 'index.mjs')
    games = {}
    for slug, specifier in re.findall(r'''['"]([^'"]+)['"]\s*:\s*\(\s*\)\s*=>\s*import\(\s*['"]([^'"]+)['"]\s*\)''', graph.source(dispatcher)):
        games[slug] = graph.closure([graph.resolve(dispatcher, specifier)])
    if not games:
        raise ValueError('No poem game imports found')
    activities = {'quiz': {'common': graph.closure([challenge, dispatcher]), 'games': games},
                  'explore': graph.closure([exploration])}
    return clean, [url for url in startup if url != app.group(1)], activities


def render_index(directory, index):
    clean, startup, activities = preload_data(directory, index)
    if clean.count('</head>') != 1:
        raise ValueError('School index must contain one head closing tag')
    metadata = json.dumps(activities, ensure_ascii=True, separators=(',', ':')).replace('<', '\\u003c')
    links = '\n'.join('<link rel="modulepreload" href="' + escape(url, quote=True) + '">' for url in startup)
    generated = START + '\n' + links + '\n<script id="school-module-preloads" type="application/json">' + metadata + '</script>\n' + END + '\n'
    return clean.replace('</head>', generated + '</head>')
