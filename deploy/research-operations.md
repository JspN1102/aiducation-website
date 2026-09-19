# Structured research collection and teacher snapshots

This addition is independent of the existing latest-value `student_data`
standby importer. Do not repurpose that importer for research history. All new
raw structured events remain in `research_events`; the old daily PostgreSQL
database backup includes these tables automatically after the migration.

No production action is performed merely by deploying these files. The root
task must review the data scope, school login deployment and configuration,
apply `research-schema.sql` to the existing local database, grant the existing
application role SELECT/INSERT on the event table and usage on its sequence,
and SELECT/INSERT/UPDATE/DELETE on the two maintenance metadata tables. Do not
grant event UPDATE/DELETE; an append-only trigger also blocks them.

Use `RESEARCH_ENABLED=1` only for the approved structured scope. Public Vercel
ingestion requires its current private Blob token plus school-cookie auth.
Guangzhou uses explicit localhost PostgreSQL configuration. No HTTP endpoint
runs DDL. No new public database port, reverse tunnel or inbound connection
bypasses the site's current hosting/filing arrangement.

The provided service/timer are templates, not an installer. Root must ensure
all three environment files exist with mode 0600 before installing them:

- Existing `app.env`: localhost PostgreSQL settings.
- Existing `bridge-backup.env`: outbound private Blob access.
- New private `research.env`: `RESEARCH_ENABLED=1`,
  `RESEARCH_SYNC_ENABLE=1`, `RESEARCH_START_DATE=YYYY-MM-DD`.

`RESEARCH_START_DATE` is the UTC date collection first became enabled. Preserve
it across releases. The importer reads only the new namespace's hourly pages;
it does not perform a whole-bucket listing. Recent three hours are revisited,
and sealed historical hours advance through a persisted watermark, at most
six older hours per run. Each page contains at most 100 objects; each scan is
bounded and each run targets ninety seconds. The timer supplies a hard
150-second process limit and resource limits. A later run resumes incomplete
pages. Raw object deletion is never automatic.

Each batch validates schema, path and checksum. PostgreSQL inserts the entire
batch and marks publication days in the same transaction. Receipts are written
after commit; a crash before the receipt replays idempotently. A checksum or
identity conflict fails that page without advancing its cursor. No unknown
record is discarded to make the status look successful.

Publication shards by UTC date, grade and class, with immutable content-hashed
chunks. Cohort queries select only matching manifest entries before reading.
When an existing chunk has the same locally recomputed content hash, count and
byte size as the validated published manifest, the synchronizer reuses that
immutable object without another upload/read. Stable 250-row pages therefore
require no repeat network request; only a changed tail or new page is uploaded.
Each day remains dirty until its complete snapshot is referenced by the
durable private manifest. The default whole-school view has a precomputed
aggregate snapshot. Client and verified-provider scores remain separate, and
review/free modes never enter independent assessment averages.
The first run also publishes a valid empty manifest and empty overview when
there are no events; teacher access does not depend on a first student event.

The manifest contains `status=current|catching_up`, `watermark`, publication
time and chunk counts/checksums. A newly published timestamp alone does not
mean historical backlog is finished. An offline student's unsent queue is not
observable server-side. The teacher UI must display missing/stale data rather
than inventing zero scores. The current HTTP query boundary is thirty-one
days and 100,000 events / 64 MiB; selecting a smaller grade/class/date reduces
reading. All raw history remains in PostgreSQL and durable outbox objects.
If the default overview exceeds its bounds, publication still completes for
the manifest and available class/date chunks. `overview.status=filter_required`
and API error `NARROW_DATE_OR_CLASS_FILTER` tell the teacher to choose a class or
shorter interval; an oversized overview is never presented as an empty class.

Recovery does not delete history. After inspecting the specific failed
partition, a local administrator may reset `research_sync_state`'s
`watermark.nextHour` and relevant `cursor/YYYY-MM-DDTHH` values to the approved
start date, then run the same bounded importer. Preserve receipts and raw
events. Do not reset the start date forwards to skip unknown data. A missing
published manifest can be rebuilt by marking dates in `research_sync_state`
as `dirty/YYYY-MM-DD`; this rebuilds chunks from authoritative PostgreSQL.
Private database backups and outbox checksums are the recovery evidence.

The schema dictionary is versioned in `docs/research-data-dictionary.json`
and embedded in the API so existing deployment packaging need not expose the
docs directory. The export response includes it beside a SHA-256 manifest.
Future content releases must archive the exact item bank with contentVersion;
the current random selection is not enough to decode old option orders.

Tests: `node --test server/research-store.test.cjs`. They use temporary/fake
providers and do not call paid APIs or write production student data. A root
operator should additionally apply the DDL to an isolated PostgreSQL cluster
and verify concurrent idempotency/rollback before enabling research writes.
