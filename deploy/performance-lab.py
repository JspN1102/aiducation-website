"""Bounded scratch Nginx comparison: no production reload or public listener.

Call run_lab(precompress_function) over the verified SSH helper. The temporary
instance binds only loopback, shares verified public source files by copying,
and is shut down before TemporaryDirectory removes only its generated tree.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import gzip
import http.client
import json
import os
import shutil
import socket
import ssl
import statistics
import subprocess
import tempfile
import time


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def nginx_ticks(parent):
    ticks = 0
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            values = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            if int(entry.name) == parent or int(values[1]) == parent:
                ticks += int(values[11]) + int(values[12])
        except (OSError, ValueError, IndexError):
            pass
    return ticks


def run_lab(precompress):
    results = {}
    with tempfile.TemporaryDirectory(prefix='maanshan-performance-') as directory:
        root = Path(directory)
        os.chmod(root, 0o755)
        public = root / 'public'
        source = Path('/srv/maanshan/current/public')
        paths = ['maanshan/app.js', 'maanshan/app.bundle.css', 'maanshan/vendor/poetry-three.mjs']
        for relative in paths:
            target = public / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / relative, target)
        prepared = precompress(public, write=True)
        results['precompression'] = prepared
        port, tls_port = free_port(), free_port()
        while tls_port == port:
            tls_port = free_port()
        config = f'''daemon off;
master_process on;
user www-data;
worker_processes 2;
pid {root}/nginx.pid;
error_log stderr warn;
events {{ worker_connections 128; }}
http {{
  include /etc/nginx/mime.types;
  types {{ application/javascript mjs; }}
  default_type application/octet-stream;
  sendfile on;
  access_log off;
  gzip on;
  gzip_comp_level 1;
  gzip_min_length 1024;
  gzip_vary on;
  gzip_types application/javascript text/css application/json;
  server {{
    listen 127.0.0.1:{port};
    listen 127.0.0.1:{tls_port} ssl http2;
    server_name mandarin.aiducation.asia;
    ssl_certificate /etc/letsencrypt/live/mandarin.aiducation.asia/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mandarin.aiducation.asia/privkey.pem;
    location /dynamic/ {{ alias {public}/; gzip_static off; }}
    location /precompressed/ {{ alias {public}/; gzip_static on; }}
  }}
}}
'''
        conf = root / 'nginx.conf'
        conf.write_text(config)
        validated = subprocess.run(['nginx', '-t', '-p', str(root), '-c', str(conf)], capture_output=True, text=True, timeout=5)
        if validated.returncode:
            raise RuntimeError('Temporary Nginx configuration test failed')
        process = subprocess.Popen(['nginx', '-p', str(root), '-c', str(conf)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            for _ in range(30):
                if process.poll() is not None:
                    raise RuntimeError('Temporary Nginx exited during startup')
                try:
                    with socket.create_connection(('127.0.0.1', port), .1):
                        break
                except OSError:
                    time.sleep(.05)
            else:
                raise RuntimeError('Temporary Nginx did not open loopback listener')
            ctx = ssl.create_default_context()
            ctx.set_alpn_protocols(['h2', 'http/1.1'])
            with socket.create_connection(('127.0.0.1', tls_port), 3) as raw:
                with ctx.wrap_socket(raw, server_hostname='mandarin.aiducation.asia') as secure:
                    results['http2'] = {'alpn': secure.selected_alpn_protocol(), 'tlsVersion': secure.version(), 'caVerified': True, 'hostnameVerified': True, 'loopbackOnly': True}
                    assert secure.selected_alpn_protocol() == 'h2'
            results['assetComparison'] = []
            for relative in paths:
                asset = {'path': relative}
                expected = (public / relative).read_bytes()
                for mode in ('dynamic', 'precompressed'):
                    client = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
                    client.request('GET', '/' + mode + '/' + relative, headers={'Accept-Encoding': 'gzip'})
                    response = client.getresponse()
                    body = response.read()
                    asset[mode] = {'bytes': len(body), 'status': response.status,
                                   'contentEncoding': response.getheader('Content-Encoding'), 'vary': response.getheader('Vary')}
                    assert response.status == 200 and response.getheader('Content-Encoding') == 'gzip'
                    assert gzip.decompress(body) == expected
                    client.close()
                results['assetComparison'].append(asset)

            def benchmark(mode):
                start = time.perf_counter()
                before = nginx_ticks(process.pid)
                def worker(_):
                    timings = []
                    client = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
                    try:
                        for _ in range(16):
                            if time.perf_counter() - start > 5:
                                break
                            tick = time.perf_counter()
                            client.request('GET', '/' + mode + '/maanshan/vendor/poetry-three.mjs', headers={'Accept-Encoding': 'gzip'})
                            response = client.getresponse()
                            body = response.read()
                            assert response.status == 200 and response.getheader('Content-Encoding') == 'gzip'
                            timings.append({'ms': (time.perf_counter() - tick) * 1000, 'bytes': len(body)})
                    finally:
                        client.close()
                    return timings
                with ThreadPoolExecutor(max_workers=8) as pool:
                    observations = [row for batch in pool.map(worker, range(8)) for row in batch]
                duration = time.perf_counter() - start
                after = nginx_ticks(process.pid)
                times = sorted(row['ms'] for row in observations)
                return {'mode': mode, 'requests': len(observations), 'concurrency': 8, 'maximumSeconds': 5,
                        'elapsedSeconds': round(duration, 4), 'medianMs': round(statistics.median(times), 3),
                        'p95Ms': round(times[min(len(times)-1, int(len(times)*.95))], 3),
                        'bytes': sum(row['bytes'] for row in observations),
                        'nginxCPUSeconds': round((after - before) / os.sysconf('SC_CLK_TCK'), 3)}
            results['benchmarks'] = [benchmark('dynamic'), benchmark('precompressed')]
        finally:
            process.terminate()
            try:
                process.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.communicate(timeout=3)
    results['temporaryInstanceStoppedAndDirectoryRemoved'] = True
    results['productionReloaded'] = False
    results['providerAndStudentRequests'] = 0
    return results
