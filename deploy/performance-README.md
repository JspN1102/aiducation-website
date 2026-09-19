# Guangzhou static delivery improvements

The canonical `nginx-mandarin.conf` adds only `http2` to the existing TLS listeners and
`gzip_static on` to the existing site. It preserves private-path exclusions,
API routing, cache policies and the separate COS media mapping. It requires
normal deployment review/activation; these files never reload production.

## Release integration

After extracting a new release and before activation:

```sh
nice -n 10 python3 deploy/performance-precompress.py --public-root public --write --summary
python3 deploy/performance-precompress.py --public-root public --verify --summary
```

The public directory must contain `maanshan/`. Original files remain intact.
Sidecars are deterministic gzip level 9, atomically replaced, with source mtime.
Files under 1 KiB, poorly compressible content and non-text media are excluded.
A source that becomes ineligible loses its old sidecar to prevent stale bytes.
Generated `.gz` files are release artifacts, not source-controlled files.

Use `--verify --summary` in same-version deployment checks too. It derives the
complete expected set from current source bytes instead of trusting a stored
manifest, and rejects missing, corrupted, stale or mismatched-mtime sidecars.
Exit 0 means verified; exit 1 means deployment is not a valid no-op. Summary
output contains counts/bytes and at most ten failure paths; omit `--summary`
for complete file/hash details.

## Validation and measured scope

`python3 deploy/performance-test.py -v` passes six tests on Ubuntu, including
symlink rejection, unchanged source hashes/mtime, atomic rebuild, and missing
or stale sidecar rejection. The canonical Nginx configuration passed `nginx -t`
on the actual Ubuntu Nginx 1.18 installation. A separate loopback-only Nginx
instance negotiated ALPN `h2` with normal CA and hostname verification.

On that isolated instance, the same 764,197-byte Three.js file was requested
128 times with eight connections. Dynamic gzip delivered 236,253 bytes per
request; precompressed delivery used 195,393 bytes (17.3% less). Nginx CPU time
fell from 1.46 seconds to 0.01 seconds; p95 loopback latency fell from 55.665 ms
to 1.993 ms. These are comparative local measurements, not internet latency or
student-capacity guarantees. App JS, CSS and Three.js together fell from
353,737 compressed bytes to 282,491 bytes (20.1% less than current gzip).

All 130 eligible Mandarin text assets total 3,031,027 original bytes and
809,097 gzip bytes in the inspected snapshot. This result is version-specific.
Media files stay unchanged. Dynamic gzip remains a fallback where no sidecar
exists. Short revalidation policies remain in place so browser refresh can
still pick up current modules.

`performance-probe.py --benchmark` reads aggregate CPU/RAM/disk/process/PG
metrics and permits only fixed loopback health/static paths, with at most
eight simultaneous requests and three phases of at most five seconds each.
It does not inspect environment variables, student records or provider APIs.
`performance-lab.py` contains the bounded, temporary comparison harness; it
stops its private Nginx and removes its scratch directory after the comparison.
