"""Public school URLs; internal source paths and existing COS keys stay stable."""
import re

TEXT_SUFFIXES = {'.js', '.mjs', '.html', '.json', '.css'}
LOCAL_PATH = re.compile(r'([\"\'`])(/maanshan/)')


def is_authoring_file(value):
    return value.startswith('maanshan/tools/') or (
        value.startswith('maanshan/media/') and value.rsplit('/', 1)[-1] in
        {'ASSET-SOURCES.md', 'README.md', 'glyphs-provenance.json'})


def public_path(value):
    if value.startswith('/maanshan/'):
        return '/school/' + value[len('/maanshan/'):]
    if value.startswith('maanshan/'):
        return 'school/' + value[len('maanshan/'):]
    return value


def public_source(source):
    # Do not change remote storage URLs, API names or saved browser keys.
    return LOCAL_PATH.sub(lambda match: match[1] + '/school/', source).replace(
        r'/^\/maanshan\/', r'/^\/school\/')


def public_routes(rows):
    return [{**row, 'source': public_path(row['source']),
             **({'destination': public_path(row['destination'])} if 'destination' in row else {})}
            for row in rows]
