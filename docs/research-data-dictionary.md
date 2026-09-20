# Structured learning research data v1

The machine-readable source is `research-data-dictionary.json`. This release
collects structured observations only, behind school login and
`RESEARCH_ENABLED=1`. Its event/export schema does not contain raw recordings,
handwriting coordinates, chat text, names, IPs or fingerprints. The separate
private `school_recordings` table now keeps the latest assessed recording per
account, poem and line for the learner's own playback. This table is covered by
database backups but is not included in research-event or teacher exports.

`POST /api/research-events` accepts `{schemaVersion:1,batchId,actorId,events}`.
Cookie identity plus CSRF is required. `actorId` must match the current cookie;
old tabs belonging to another student receive 409 `ACTOR_CHANGED`. Stored rows
use the independent random research ID. Successful responses identify whether
the durable write reached PostgreSQL or the private Blob outbox. They do not
claim an outbox batch is already imported.

Client and verified backend outcomes are distinct sources. A browser reporting
100 is never turned into a verified 100. Backend verification establishes
provenance of a provider result, not objective educational truth. Provider
failure remains missing/error. A failed event write does not fabricate success.

All endpoints reject unknown event fields. Timestamps, counts, numeric metrics,
IDs, enumerations, option orders and typed placements have size/range limits.
Raw responses and provider error messages must never be forwarded into events.
Poem word scores contain only known textbook characters and numeric scores.

## Teacher contract

`GET /api/teacher-analytics` requires a teacher session. Query fields are
`grade`, `cls`, `from`, `to`, `activity`, `student`, and `attempt=first|latest`.
Dates use UTC receipt time, default to thirty days, and allow at most thirty-one
inclusive days. `student` means a research pseudonym, not a name or school login.
The same response shape serves a cohort and an individual.

The response has `schemaVersion`, `dictionaryVersion`, `generatedAt`, `source`,
`filters`, `sync`, `coverage`, `summary`, `students`, `byGrade`, `byClass`,
`trend`, and `missingness`. A summary contains `nEvents`, `nStudents`,
`nAttempts`, `completedN`, `activeMs`, `nInvalidEvents`, `qualityFlags`,
`clientReported`, `serverVerified`, `practiceOutcomeN`, and `byConstruct`.
Only the top-level `summary` additionally contains `byMode`; a student detail
request uses that filtered top-level summary rather than repeating all modes
in every student list row.
Each score summary has `measuredN`, `unmeasuredN`, `meanScore`, `correctN`,
`incorrectN`, and `mixedConstructs`. Each student additionally has `first`, `latest`, and
`lastSeenAt`. School-roster count comes from the authorised roster; it is never
inferred from event participants or a historical verbal estimate.

Zero is a measured score. Null means unmeasured. First/latest selects attempts
per item, content version and mode within the chosen dates, while `nAttempts`
counts all distinct attempts in those dates. Review/free results are counted
as practice and excluded from independent score means. `completedN` counts
completion events, not students. Session active time is monotonic; only adjacent
sequence deltas in one activity contribute, avoiding invented time across gaps.

Pronunciation scores and binary task accuracy are different constructs. Every
summary, including `first`, `latest`, cohort/trend rows and `byMode`, contains a
sparse `byConstruct` object with known keys: `reading.pronunciation`, `writing.dictation`,
`sound.recognition`, `match.accuracy`, `sequence.accuracy`, and
`scene_builder.accuracy`. Each value has distinct `clientReported` and
`serverVerified` score summaries. An absent construct has no eligible outcome;
it does not mean a measured zero. `mixedConstructs` is present on overall source
scores only, since a per-construct score cannot mix constructs. Overall score
counts may describe the number of measurements; an overall mean is null with
`mixedConstructs=true` whenever several measured constructs are present. Show
means only with their explicit construct and source. Do not present a pooled
accuracy or infer support needs from pooled scores. A reading attempt is one
recording while a challenge attempt is a round; their counts also have different
units and should be labelled by activity.

Only actual assessment outcomes enter first/latest selection, whose keys
include construct and provider operation. Browser `answer_submitted` outcomes
and reading-line `feedback_shown` are eligible; ordinary feedback is process
data. Verified readings and handwriting come from their provider operations;
choice/matching/sequence/scene outcomes come from the answer key. A generic
challenge completion cannot replace a handwriting measurement. Microgame
completion and report/chat generation never count as an assessment, even if
the submitted event carries a numeric score. These original process events
remain available in append-only exports.
Within the same attempt, a later failed or unmeasured provider retry does not
erase an earlier actual measurement. A different later attempt can remain
unmeasured. The failed event is still present in the complete history.

Top-level `readingWords` shows at most fifty character observations from the
selected verified reading attempts. Groups retain poem, line/item, content
version, character position and character identity. Each has a sample count,
mean and count below 60. `readingWordSummary` declares the cutoff, total and
returned groups and whether the display is limited. Zero is a real score;
missing word scores are not observations. These are character practice signals,
not consonant/tone diagnoses. No original event is dropped by this display limit.
Verified provider `metrics` also retain separate accuracy, fluency, completion
and suggested scores where supplied; finite decimals and zeros are valid.
Missing dimensions are omitted, and none adds another assessment to the mean.

Exports use the same endpoint with `format=jsonl|csv`, `cursor`, `limit<=5000`,
and subsequent `snapshot=<snapshotId>`. The JSON response contains `content`,
`manifest`, and `dictionary`. The manifest hashes the exact UTF-8 content.
Save these together. CSV has a header on every page; JSONL preserves all typed
details. Dataset changes between pages return 409. Narrow a date/class query
when more than 100,000 events or the snapshot byte bound would be read; the
system never silently truncates a research export.

## Storage and operation

Guangzhou PostgreSQL `research_events` is authoritative and append-only. A
transaction inserts a full batch and marks affected days for publication;
duplicate event IDs with identical payloads are no-ops, and changed payloads
conflict. Updates/deletes are blocked by a table trigger. Backups preserve the
whole history, unlike the older latest-value student-data exports.

While the public site remains on Vercel, immutable private Blob batches use a
separate namespace and UTC receipt-hour partitions. Guangzhou alone makes
outbound HTTPS calls to list bounded partition pages and import events. It
persists cursors, scans recent hours again, and advances a historical watermark
only after a page has been imported durably. No public PostgreSQL listener,
inbound workaround or public data route is created.

Content-addressed private day chunks preserve every imported event for teacher
queries/exports; the default teacher overview also has a precomputed aggregate
snapshot. A small manifest changes only after complete chunks are durable.
An interrupted publisher leaves the day dirty for retry. No outbox or source
object is deleted. Invalid outbox objects have durable private retry references;
healthy records may continue to import. `sync.status=attention` exposes pending
integrity issues, while `catching_up` also covers transient retry backlog.
Only aggregate counts and safe error codes are exposed, not private paths.
Publication time and backlog status must be displayed as
data freshness rather than described as realtime completeness.

Stable challenge retries preserve the original event identity, contents and
`clientAt`. Their immutable request intent is not an acknowledgement. A retry
writes its transport batch to the current UTC hour, including when the old
hour is already behind the sync watermark. Same-hour retries reuse the first
durable transport receipt; different-hour retries may add transport objects.
PostgreSQL deduplicates those objects and retains the first imported event row
and its receipt date. The transport `serverReceivedAt` is therefore not an
invariant timestamp for all retries of one event. Invalid incoming event
contexts return a permanent 400 rejection; storage failures remain retryable.

An operator can recover historical partitions by safely resetting the private
watermark/cursor to the research start date while retaining events and receipts;
idempotency avoids duplicate rows. This is a manual recovery action, never an
unbounded automatic full-bucket scan. Any conflict/checksum failure stops the
affected object for investigation and bounded retry instead of discarding it.

See `deploy/research-operations.md` for explicit installation and bounded timer
configuration. Files alone do not enable collection, run migrations, publish
snapshots or change production data.
