# Private administrative research export

`research-export.cjs` exports historical anonymous research records from the
existing **local** PostgreSQL database. It does not use the teacher HTTP API,
so there is no thirty-one-day or 100,000-event limit. The teacher page keeps
its existing request boundaries. This command does not enable collection,
change schema, join the account directory, or delete any source record.

Run on the Linux server as the existing administrator/application user:

```sh
install -d -m 700 /home/ubuntu/private-research-exports
node --env-file=/home/ubuntu/maanshan-shared/app.env \
  /srv/maanshan/current/deploy/research-export.cjs \
  --output /home/ubuntu/private-research-exports/2026-2027-grade2-A \
  --from 2026-09-01 --to 2027-08-31 --grade 2 --cls A
```

`--output` must name a new absolute directory whose parent already exists.
Every run needs a different destination. All four filters are optional;
omitting both dates exports the available history. Dates use UTC server
receipt time, with `--to` inclusive. Grade is `1`–`6`, class is one uppercase
letter. PostgreSQL host must be an allowed local host/socket in the existing
`DB_DRIVER`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASS` (or
`DB_PASSWORD`) configuration. No credentials are printed or included in the
export. No Blob token is needed.

The output directory is mode `0700`; every file is `0600`. Existing outputs,
symbolic-link ancestors, writable parents, project directories and common
public/web directories such as `public`, `www`, and `html` are rejected.
Do not copy an export into a public site directory. The three completed files
are:

- `events.jsonl`: one validated anonymous stored record per line, including
  `researchId`, cohort, client/server source, event versions, quality flags and
  the original event checksum. No roster name, login, IP, chat text, audio or
  handwriting coordinates are selected or written.
- `dictionary.json`: the versioned structured research dictionary shipped
  with this release.
- `manifest.json`: success marker, filters, consistent snapshot time/ID,
  row count, observed receipt-date range and SHA-256/byte count for each file.

A single `REPEATABLE READ READ ONLY` transaction pages by the increasing
PostgreSQL bigint ID, 500 rows at a time. IDs remain exact decimal strings,
including values above JavaScript's safe integer range. It streams each row
to disk and computes its hash incrementally. Concurrent imports do not enter
the export after the snapshot begins. Empty results are valid complete
exports with zero rows and a null observed date range.

Each row must match the strict stored schema, `research_id`, its embedded
event checksum and the database checksum column. Unexpected identity fields
or corrupted events stop the export. The original outbox **batch** envelope
is not stored in `research_events`; its checksum was validated on import and
cannot be independently reverified by this PostgreSQL-only export. The
manifest records that limit explicitly. Retain private outbox/database
backups when original-batch provenance is needed. SHA-256 detects changes; it
is not proof that a student answer or browser score was correct.

Writes begin as `.partial` files; the success manifest is published last
after data/dictionary flush. Failed or interrupted runs retain their partial
output for diagnosis, never delete source rows, and must not be treated as
complete without `manifest.json` and matching file hashes. Run again with a
new directory. A long database query has a sixty-second statement timeout;
SIGINT/SIGTERM is checked at query/page/row boundaries before publishing
success. Unexpected process termination may leave partial files.

Synthetic tests (no database connection or production records):

```sh
node --test server/research-export.test.cjs
```

Linux runs all filesystem, mode, keyset, corruption and interruption checks.
Other platforms run only argument and stored-record validation tests and
skip the Linux-private-filesystem cases. The export command itself refuses
non-Linux execution rather than assuming POSIX mode bits protect Windows
files.
