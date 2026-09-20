# Private reading playback

`/api/school-recordings` runs only on the Guangzhou API. The isolated Vercel
gateway forwards this fixed route; it has no audio store or provider key.

The first authenticated recording request initializes `school_recordings` with
the `CREATE TABLE IF NOT EXISTS` schema in `api/_lib/school-recordings.cjs`.
No extra environment variable, public bucket, service or migration job is
required. The existing application database role must retain table-creation
permission. The normal whole-database `pg_dump` backup includes this table and
its private compressed audio automatically.

Each account / teacher practice generation / poem / line keeps one latest
assessed recording: exact 16 kHz mono PCM WAV, 0.25–32 seconds, at most
1,024,044 decoded bytes. Audio is gzip-compressed in PostgreSQL `bytea`.
The current six poems have four reading units each, so a normal pupil has four
slots and an all-grade teacher/test account has 24 slots in one generation.
Newer capture time wins atomically; older delayed uploads cannot replace it.
Retrying the same recording ID is idempotent. Historical teacher generations
remain in backups/storage and are inaccessible after a practice reset.

The browser returns the score without awaiting audio upload. A bounded
IndexedDB outbox holds only the latest pending audio in each account/epoch/line
slot, retries transient failures, survives refresh, and removes acknowledged
uploads. It never submits a previous account's audio using a new identity.
The home page makes no extra recording-metadata request. Reading/results pages
load metadata for their current poem; audio is fetched only on playback.

API contract (same-origin HttpOnly school cookie required):

- `GET ?action=list&actorId=...&poemId=1` returns metadata only. Teacher requests
  additionally send the current `learningEpoch` (`initial` before first reset).
- `POST` sends JSON `{actorId, poemId, lineIndex, recordingId, recordedAt, audio}`
  with the current CSRF header; teachers also send `learningEpoch`. `audio` is
  base64 of the canonical WAV, optionally gzip with `audioCompression:"gzip"`.
  `recordingId` is a UUID v4 and `recordedAt` is capture time in milliseconds.
- `GET ?action=audio&actorId=...&poemId=1&lineIndex=0&recordingId=...` returns
  private `audio/wav`, `Cache-Control: private, no-store`. The browser's Audio
  element automatically sends the same-origin cookie; GET does not require
  CSRF because it performs no write. URL actor ID, poem grade, recording ID and
  teacher epoch are checked against the signed-in account for every read.

There is no anonymous/public URL, other-student selector or public COS copy.
Existing historical scores whose audio was previously held only in memory
cannot have that lost audio reconstructed; a new reading creates a saved clip.
Research-event exports and teacher Excel/Word downloads do not include audio.

Validation without real pupil writes:

```sh
node --test server/recording-persistence.test.cjs
node server/recording-persistence.browser.test.cjs
node --env-file=/home/ubuntu/maanshan-shared/app.env deploy/recordings-isolated-test.cjs
```

The last command uses one PostgreSQL transaction and a temporary table shadowing
`school_recordings`, then rolls back; it never writes the real recording table.
The browser fixture uses synthetic identities, real IndexedDB and a local WAV;
it verifies offline upload, refresh, playback, retry and account/reset isolation
without calling SOE, TTS or any paid provider.
