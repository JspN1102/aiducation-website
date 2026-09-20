#!/bin/sh
set -eu
umask 077

backup_root=/home/ubuntu/maanshan-backups/blob
backup_stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
mkdir -p "$backup_root"
chmod 700 "$backup_root"

# The export creates its own new restricted timestamp directory. Keep failed
# snapshots for inspection; never delete or overwrite the private Blob source.
/usr/bin/node --env-file=/home/ubuntu/maanshan-shared/bridge-backup.env \
  /srv/maanshan/current/deploy/student-store-transfer.cjs export --apply \
  --output "$backup_root/$backup_stamp/records.json"

# Password changes make the original desktop roster snapshot stale. Export the
# current hashed account directory and the complete prior UTC day plus today's
# partial teacher security audit, using the existing private Blob credential.
# Install this extended job only after the reviewed school directory is imported.
audit_today=$(date -u +%F)
audit_yesterday=$(date -u -d yesterday +%F)
/usr/bin/node --env-file=/home/ubuntu/maanshan-shared/bridge-backup.env \
  /srv/maanshan/current/deploy/school-accounts-import.cjs --store blob --apply \
  --export-output "$backup_root/$backup_stamp/school-accounts.snapshot.json"
for audit_day in "$audit_yesterday" "$audit_today"; do
  /usr/bin/node --env-file=/home/ubuntu/maanshan-shared/bridge-backup.env \
    /srv/maanshan/current/deploy/school-accounts-import.cjs --store blob --apply \
    --export-audit-day "$audit_day" \
    --export-output "$backup_root/$backup_stamp/security-audit-$audit_day.json"
done

# Keep the exact private dataset used for each completed teacher AI report.
/usr/bin/node --env-file=/home/ubuntu/maanshan-shared/bridge-backup.env \
  /srv/maanshan/current/deploy/teacher-reports-backup.cjs \
  --export-output "$backup_root/$backup_stamp/teacher-reports.index.json"

# Publish completion only after every export succeeded. Existing records.json
# stays byte-for-byte in its original schema; partial directories are retained
# for inspection and are never reported as completed account backups.
/usr/bin/node - "$backup_root/$backup_stamp" "$audit_yesterday" "$audit_today" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const [directory, yesterday, today] = process.argv.slice(2);
const filenames = ['records.json', 'school-accounts.snapshot.json',
  `security-audit-${yesterday}.json`, `security-audit-${today}.json`, 'teacher-reports.index.json'];
const files = filenames.map(name => {
  const filename = path.join(directory, name), info = fs.lstatSync(filename);
  if (!info.isFile() || (info.mode & 0o077)) throw new Error('Private backup validation failed');
  return { name, bytes: info.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex') };
});
fs.writeFileSync(path.join(directory, 'complete.json'), JSON.stringify({
  format: 'maanshan-private-daily-backup-v3', completedAt: new Date().toISOString(), files
}), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ok: true, operation: 'complete-private-daily-backup', files: files.length }));
NODE
