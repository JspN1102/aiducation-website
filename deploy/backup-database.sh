#!/bin/sh
set -eu
umask 077
backup_root=/var/backups/maanshan
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
temporary=$(mktemp "$backup_root/.database.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM
pg_dump --format=custom maanshan_db > "$temporary"
pg_restore --list "$temporary" > /dev/null
mv "$temporary" "$backup_root/maanshan-$backup_stamp.dump"
printf 'Database backup saved: %s\n' "$backup_stamp"
