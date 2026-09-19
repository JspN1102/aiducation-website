"""Read-only Linux runtime snapshot and bounded loopback-only microbenchmark.

No environment, credentials, student records or provider API calls are read.
Run as root via the existing verified SSH connection for aggregate PG metrics.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import argparse
import collections
import http.client
import json
import os
import re
import socket
import ssl
import statistics
import subprocess
import threading
import time


HOST = 'mandarin.aiducation.asia'
ASSETS = ['/maanshan/app.js', '/maanshan/app.bundle.css', '/maanshan/vendor/poetry-three.mjs']


def command(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=12)
    return result.returncode, result.stdout, result.stderr


class LoopbackTLS(http.client.HTTPSConnection):
    def __init__(self):
        super().__init__(HOST, 443, timeout=3, context=ssl.create_default_context())

    def connect(self):
        self.sock = self._context.wrap_socket(socket.create_connection(('127.0.0.1', 443), self.timeout), server_hostname=HOST)


def cpu_ticks():
    values = list(map(int, Path('/proc/stat').read_text().splitlines()[0].split()[1:]))
    return {'total': sum(values[:8]), 'idle': values[3] + values[4]}


def process_metrics():
    rows = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            name = (entry / 'comm').read_text().strip()
            if name not in ('node', 'nginx', 'postgres'):
                continue
            stat = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            rows.append({'pid': int(entry.name), 'name': name,
                         'cpuTicks': int(stat[11]) + int(stat[12]),
                         'rssBytes': int(stat[21]) * os.sysconf('SC_PAGE_SIZE')})
        except (OSError, ValueError, IndexError):
            pass
    return rows


def snapshot():
    info = {'cpuCount': os.cpu_count(), 'loadAverage': list(os.getloadavg()),
            'uptimeSeconds': float(Path('/proc/uptime').read_text().split()[0])}
    mem = {line.split(':', 1)[0]: int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if len(line.split()) >= 3}
    info['memoryBytes'] = {key: mem.get(key) for key in ('MemTotal', 'MemAvailable', 'MemFree', 'Buffers', 'Cached', 'SwapTotal', 'SwapFree')}
    disk = os.statvfs('/srv/maanshan')
    info['diskBytes'] = {'total': disk.f_blocks * disk.f_frsize, 'available': disk.f_bavail * disk.f_frsize}
    info['processes'] = process_metrics()
    _, service, _ = command(['systemctl', 'show', 'maanshan', '--property=ActiveState,SubState,MainPID,MemoryCurrent,CPUUsageNSec,NRestarts,TasksCurrent,LimitNOFILE'])
    info['service'] = dict(line.split('=', 1) for line in service.splitlines() if '=' in line)
    info['nodeVersion'] = command(['node', '--version'])[1].strip()
    _, _, build = command(['nginx', '-V'])
    info['nginxBuild'] = {'version': re.search(r'nginx/[\d.]+', build).group(0),
                          'http2Module': '--with-http_v2_module' in build,
                          'gzipStaticModule': '--with-http_gzip_static_module' in build,
                          'stubStatusModule': '--with-http_stub_status_module' in build}
    code, config, _ = command(['nginx', '-T'])
    allowed = r'(?:worker_processes|worker_connections|worker_rlimit_nofile|sendfile|tcp_nopush|tcp_nodelay|keepalive_timeout|keepalive_requests|gzip|gzip_static|gzip_comp_level|gzip_vary|gzip_min_length|gzip_types|http2|open_file_cache|open_file_cache_valid|proxy_http_version|proxy_socket_keepalive|proxy_connect_timeout|proxy_read_timeout|proxy_send_timeout|keepalive|keepalive_time)'
    info['nginxDirectives'] = [line.strip() for line in config.splitlines() if re.match(r'^\s*' + allowed + r'\s', line) and not line.lstrip().startswith('#')]
    info['nginxConfigTest'] = code == 0
    info['tlsHTTP2ListenEnabled'] = bool(re.search(r'listen\s+[^;]*443[^;]*http2', config) or re.search(r'\bhttp2\s+on\s*;', config))
    info['upstreamKeepaliveConfigured'] = bool(re.search(r'\bupstream\s+[^{}]+\{[^}]*\bkeepalive\s+', config, re.DOTALL))
    info['proxyConnectionCleared'] = bool(re.search(r'proxy_set_header\s+Connection\s+(?:""|\'\')\s*;', config))
    queries = ["SELECT state, count(*) FROM pg_stat_activity GROUP BY state ORDER BY state NULLS LAST;",
               "SELECT name, setting, unit FROM pg_settings WHERE name IN ('max_connections','shared_buffers','work_mem','effective_cache_size','idle_in_transaction_session_timeout') ORDER BY name;"]
    info['postgres'] = []
    for query in queries:
        status, out, _ = command(['runuser', '-u', 'postgres', '--', 'psql', '-X', '-A', '-t', '-d', 'postgres', '-c', query])
        info['postgres'].append({'status': status, 'rows': out.strip().splitlines()})
    current = Path('/srv/maanshan/current').resolve()
    metadata = current / 'release-manifest.json'
    if metadata.is_file():
        info['releaseCommit'] = json.loads(metadata.read_text()).get('commit')
    alpn_context = ssl.create_default_context()
    alpn_context.set_alpn_protocols(['h2', 'http/1.1'])
    with socket.create_connection(('127.0.0.1', 443), 3) as connection:
        with alpn_context.wrap_socket(connection, server_hostname=HOST) as secure:
            info['selectedALPNOfferingHTTP2'] = secure.selected_alpn_protocol()
    client = LoopbackTLS()
    try:
        client.connect()
        info['staticAssets'] = []
        for asset in ASSETS:
            row = {'path': asset}
            for encoding in ('identity', 'gzip'):
                start = time.perf_counter()
                client.request('GET', asset, headers={'Host': HOST, 'Accept-Encoding': encoding})
                response = client.getresponse()
                content = response.read()
                row[encoding] = {'status': response.status, 'bytes': len(content),
                                 'encoding': response.getheader('Content-Encoding'),
                                 'cacheControl': response.getheader('Cache-Control'),
                                 'etag': response.getheader('ETag'), 'vary': response.getheader('Vary'),
                                 'ms': round((time.perf_counter() - start) * 1000, 2)}
            info['staticAssets'].append(row)
    finally:
        client.close()
    return info


def benchmark(route, encoding, concurrency, samples, max_seconds):
    """Only three fixed static asset paths or the cost-free Node health route."""
    if route not in ASSETS + ['/api/health'] or encoding not in ('identity', 'gzip'):
        raise ValueError('Only fixed loopback static/health paths can be benchmarked')
    if not 1 <= concurrency <= 16 or not 1 <= samples <= 256 or not 1 <= max_seconds <= 8:
        raise ValueError('Unsafe benchmark bounds')
    began = time.perf_counter()
    deadline = began + max_seconds
    before_cpu, before_process = cpu_ticks(), process_metrics()
    lock, next_item = threading.Lock(), 0

    def worker(_):
        nonlocal next_item
        client = http.client.HTTPConnection('127.0.0.1', 3100, timeout=3) if route == '/api/health' else LoopbackTLS()
        observations = []
        try:
            while time.perf_counter() < deadline:
                with lock:
                    if next_item >= samples:
                        break
                    next_item += 1
                start = time.perf_counter()
                try:
                    client.request('GET', route, headers={'Host': HOST, 'Accept-Encoding': encoding})
                    response = client.getresponse()
                    content = response.read()
                    observations.append({'ms': (time.perf_counter() - start) * 1000,
                                         'bytes': len(content), 'status': response.status})
                except (OSError, http.client.HTTPException) as error:
                    observations.append({'error': type(error).__name__})
                    client.close()
        finally:
            client.close()
        return observations

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        observations = [row for group in pool.map(worker, range(concurrency)) for row in group]
    seconds = time.perf_counter() - began
    after_cpu, after_process = cpu_ticks(), process_metrics()
    previous = {row['pid']: row for row in before_process}
    cpu = collections.defaultdict(int)
    for row in after_process:
        if row['pid'] in previous:
            cpu[row['name']] += row['cpuTicks'] - previous[row['pid']]['cpuTicks']
    success = [row for row in observations if row.get('status') == 200]
    latency = sorted(row['ms'] for row in success)
    total_cpu = after_cpu['total'] - before_cpu['total']
    return {'path': route, 'encoding': encoding, 'concurrency': concurrency, 'requestedSamples': samples,
            'maxRunSeconds': max_seconds, 'elapsedSeconds': round(seconds, 3),
            'successes': len(success), 'errors': [row for row in observations if row.get('status') != 200],
            'requestsPerSecond': round(len(success) / seconds, 1),
            'medianMs': round(statistics.median(latency), 2) if latency else None,
            'p95Ms': round(latency[min(len(latency)-1, int(len(latency)*.95))], 2) if latency else None,
            'totalBytes': sum(row['bytes'] for row in success),
            'processCPUSeconds': {name: round(ticks / os.sysconf('SC_CLK_TCK'), 3) for name, ticks in cpu.items()},
            'systemBusyPercent': round(100 * (1 - (after_cpu['idle'] - before_cpu['idle']) / total_cpu), 1) if total_cpu else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--benchmark', action='store_true')
    args = parser.parse_args()
    report = {'createdUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'snapshot': snapshot()}
    if args.benchmark:
        report['benchmarkConditions'] = 'Loopback client shares server CPU; comparative microbenchmark, not internet throughput or a capacity guarantee. At most 8 concurrent requests, 128 requests/phase, 5 seconds/phase, 3 phases; no provider or student endpoints.'
        report['benchmarks'] = [benchmark('/api/health', 'identity', 8, 128, 5),
                                benchmark(ASSETS[2], 'gzip', 8, 128, 5),
                                benchmark(ASSETS[2], 'identity', 8, 128, 5)]
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
