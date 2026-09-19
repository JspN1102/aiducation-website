# Temporary Mandarin student storage

For the temporary Mandarin Vercel deployment set `STUDENT_STORE=blob`, its existing
private `BLOB_READ_WRITE_TOKEN`, and a private `DATA_READ_TOKEN`. Use a separate
Vercel project/environment if the original company/demo deployment must remain
unchanged. Missing teacher protection disables saves and rejects teacher reads.
Do not copy the Guangzhou PostgreSQL localhost settings to Vercel or open 5432.

Student records use only `mandarin-bridge-v1/class/` in the private Blob store.
Speech objects remain in their existing namespace. The store retains the latest
record for each student, grade/class, poem and section, rather than every historical
attempt. The original PostgreSQL history is not deleted. Names do not appear in
object paths; the student ID is hashed. This is persistence for existing browser
profiles, not a new school account/login system.

Saves use conditional ETag writes. Old retries cannot replace a newer source time.
Only a successful private write (or an already newer record) returns
`stored: "blob"`; failed writes remain queued in the browser. Teacher queries use
the same store, filtered to the selected class and poem, without public object URLs.
The current bound is 600 records/16 MiB per class+poem, six concurrent reads, and
an 11.5 second read deadline. Exhausting a bound returns an error rather than a
partial class report. Blob has its existing service/storage/request limits; it is
not represented as an unlimited database or a new free subscription.

## Private export

Credentials stay in a private environment file. The dry-run reads and verifies
only this namespace, prints counts/checksum, and writes nothing:

```sh
node --env-file=/private/vercel-bridge.env deploy/student-store-transfer.cjs export --dry-run
```

To save the export, provide an absolute output filename in a **new dedicated
directory whose parent already exists**:

```sh
node --env-file=/private/vercel-bridge.env deploy/student-store-transfer.cjs export --apply --output /private/bridge-20260920/student-records.json
```

The script creates the dedicated directory with restricted permissions (current
Windows user and SYSTEM, or Unix 0700), and creates the data file exclusively.
An existing destination directory is refused rather than changing permissions
of somebody else's folder. The export includes record identities, source times,
payloads and a SHA-256 checksum. Keep it out of the public website/source ZIP.
Maximum export size is 20,000 records/256 MiB. No export deletes Blob objects.

## Reconcile into Guangzhou PostgreSQL

Before an eventual DNS switch, keep the same `mandarin.aiducation.asia` origin.
Take a private export, run the import preview against the existing PostgreSQL,
and keep both the export and a fresh PostgreSQL backup:

```sh
node --env-file=/home/ubuntu/maanshan-shared/app.env deploy/student-store-transfer.cjs import-postgres --input /private/bridge-20260920/student-records.json --dry-run
node --env-file=/home/ubuntu/maanshan-shared/app.env deploy/student-store-transfer.cjs import-postgres --input /private/bridge-20260920/student-records.json --apply
```

The preview is a PostgreSQL read-only transaction. The applied import validates
the complete export before writing, briefly locks the student table, and commits
all inserts together. Existing sync IDs and newer PostgreSQL results are skipped;
an ID associated with another student/section aborts the transaction. Re-running
the same export is safe. No table is truncated and no source object is removed.

An export is a bounded scan, not a transaction across all Blob objects. For the
final cutover, reconcile again after the last Vercel writes and verify counts and
teacher reports before ending the transition. DNS caches can send writes to both
origins temporarily: keep the bridge available and reconcile its final delta.
The import preserves newer PostgreSQL work. Initial Guangzhou records must also
be checked before entering bridge mode; existing nonempty records need a separate
baseline transfer rather than being silently ignored.

Do not enable `STUDENT_STORE=blob` on Guangzhou once PostgreSQL resumes as the
primary store. This tool does not change DNS, issue new accounts, turn off a site,
or migrate browser-local profiles across different domain names.
