# Student learning reset

An operator can start a fresh student learning cohort without deleting historical
progress, recordings, research events, queued import receipts, or teacher reports.
Student accounts and credentials are unchanged. Teachers retain their own practice
progress. The demo teacher dashboard is independent of the real cohort.

## Before applying

1. Take a full PostgreSQL custom-format dump and verify `pg_restore --list` and
   SHA-256. Keep a private off-server copy. The reset command requires a verified
   dump in `/var/backups/maanshan/` that is less than six hours old.
2. Deploy the cohort-aware Guangzhou runtime and both public school bundles.
   Confirm that both relays forward `X-Learning-Epoch`. Do not activate the cohort
   while either public bundle still uploads without that header.
3. Verify the roster count and current `learning/student-cohort` epoch. Use
   `initial` only if no cohort exists. Save one request UUID for idempotent retries.
4. Hold `/srv/maanshan/.deploy.lock` as ubuntu/root over the full maintenance
   operation. Always restart `maanshan.service` in a finally/trap, even if the
   reset fails. Explicitly stop the service before the command to drain older
   requests; this makes the research timestamp cutoff unambiguous.

## Apply

Run as postgres, with reviewed values substituted, while the application is stopped:

```text
node /srv/maanshan/current/deploy/reset-student-learning.cjs
  --apply yes
  --request-id REQUEST_UUID
  --expect-students VERIFIED_COUNT
  --expect-epoch initial
  --backup /var/backups/maanshan/VERIFIED_DUMP.dump
  --backup-sha256 VERIFIED_SHA256
```

The transaction locks the affected tables, checks the expected cohort/roster,
records row counts and content fingerprints, and changes only the cohort pointer.
It verifies that the historical tables are unchanged and the new scopes are empty
before committing. The private `student_learning_resets` audit table records the
prior pointer, epoch, UTC cutoff, account mapping, and backup checksum. Preserve the
returned summary beside the backup. If a response is lost, retry with the same UUID
and arguments; do not create another reset request.

## Verify and retain

Restart the application and verify health before releasing the deployment lock.
Check that every student's current progress/recording namespace is empty, the real
teacher statistics exclude events before the cutoff, and historical table contents
match the audit manifest. Validate main and fallback playback. Do not submit test
practice as a real student after the reset.

New clients select separate browser progress, research, answer, and recording
queues. Old queues remain on the device; their old-generation submissions receive
`409 LEARNING_RESET`. Old Word reports remain stored and are not reused as current
reports. Raw historical research data remains available to the owner in PostgreSQL;
the current teacher APIs intentionally show the new cohort only.

After activation, never roll back to a runtime that ignores the cohort pointer.
Keep a cohort-aware release running while diagnosing a problem. Restoring a full
database dump over live data is not a routine undo: preserve any new learning data
and review a recovery plan first. No DNS or filing change is part of this operation.
