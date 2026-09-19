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
