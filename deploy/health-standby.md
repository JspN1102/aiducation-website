# Local health checks and optional PostgreSQL standby

These files are an opt-in operations addition. Shipping them in a release does
not install a timer, enable standby imports, change app.env, or restart a site.
There is no email, webhook, external alert, new paid service, or Blob polling.

## Existing chain and exact guarantees

The existing PostgreSQL dump runs at 02:15 plus up to 15 minutes. The existing
private Blob export runs at 03:15 Asia/Shanghai plus up to 15 minutes. The Blob
export contains the latest reading/writing/report value for every stored
student/class/poem/section; it does not contain every historical attempt, school
accounts, browser-local profiles, or TTS files. It is a bounded multi-object scan,
not a global transactional snapshot. The original source is never deleted.

`health-check.py` runs every 15 minutes: CPU sample/load, available memory, free
disk, localhost API process health, API/nginx/PostgreSQL services, original
backup service results/timers, recent private backup files, and the most recent
isolated restore result. The `/api/health` probe proves only that the local
process responds; it does not claim SOE/TTS/DeepSeek or public DNS health and
incurs no provider calls. New dumps get SHA-256 and archive-directory checks.
New Blob files get full schema/identity/checksum validation. Unchanged files use
the prior integrity result keyed by filename/size/mtime. Neither is described
as a full database restore.

`health-restore.py` performs that stronger check daily at 04:45 plus up to 10
minutes: the latest PostgreSQL dump is fully restored into a disposable cluster
owned by postgres. A 0700 private Unix socket is its only listener; TCP is
disabled. It does not connect to the production database or use app.env. It
checks the student table and unique sync index, stops the isolated cluster, and
only then removes its own temporary work directory. Uncertain shutdown leaves
the directory and fails; a subsequent run refuses to accumulate another one.
The normal service is limited to 25% of one CPU, 384 MiB and six minutes.
Dumps over 512 MiB or insufficient free disk need a separately planned drill.

Health failures are stored locally. There is **no automatic notification**.
Reports contain counts/status/checksums, never names, payloads, tokens or SQL
errors. Root health reports are in `/var/lib/maanshan-health`, 96 history files
plus latest; postgres restore reports in `/var/lib/maanshan-restore`, 14 plus
latest. Optional standby reports are root-only in `/var/lib/maanshan-standby`,
14 plus latest. Directories are 0700 and files 0600. Script stdout/stderr are
discarded by their units; systemd lifecycle messages retain the host's existing
journal policy. No global journal settings are changed. Business backups are
not pruned; the monitor reports low disk rather than deleting data.

## Direct PostgreSQL production mode

After the school API has been verified to write directly to Guangzhou
PostgreSQL, operations can create the explicit root-owned marker
`/etc/maanshan/direct-postgres.enabled`. The health report then records
`storageMode: direct-postgres` and checks local resources/API/services, the
PostgreSQL backup timer/service and dump, and the isolated restore timer/result.
It does not read old Blob exports or require their timer/service, and ignores
the legacy standby marker. Without the new marker, the previous checks remain
in effect, including Blob backup failures and optional standby freshness.

The marker changes monitoring only: it does **not** disable any writer. Stop
the former Blob export/sync/import chain as a separate cutover step. Disabling
a timer alone does not stop a service it already started. Preserve the old
configuration and backups; do not import an older Blob snapshot into the new
production database.

The following is a minimal reviewed installation sequence, run as root only
after the new application release and direct database writes are verified. It
uses the existing health service path and keeps local monitoring/recovery
timers active. Stopping a running import may cancel its transaction; inspect
its result and retain any before/after dumps. No old backups are deleted.

```sh
set -eu
umask 077
test "$(id -u)" = 0
source_file=/srv/maanshan/current/deploy/health-check.py
installed_file=/usr/local/lib/maanshan-maintenance/health-check.py
test -f "$source_file"
test -f "$installed_file"
cutover_backup="/root/maanshan-direct-postgres-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 "$cutover_backup"
cp -a "$installed_file" "$cutover_backup/health-check.py"
for unit in research-sync maanshan-bridge-backup maanshan-standby-import; do
    cp -a "/etc/systemd/system/$unit.service" "$cutover_backup/"
    cp -a "/etc/systemd/system/$unit.timer" "$cutover_backup/"
    systemctl show "$unit.service" "$unit.timer" > "$cutover_backup/$unit-state.txt"
done
if test -f /etc/maanshan/standby.enabled; then
    cp -a /etc/maanshan/standby.enabled "$cutover_backup/standby.enabled"
fi
systemctl disable --now research-sync.timer maanshan-bridge-backup.timer maanshan-standby-import.timer
systemctl stop research-sync.service maanshan-bridge-backup.service maanshan-standby-import.service
for unit in research-sync maanshan-bridge-backup maanshan-standby-import; do
    state=$(systemctl show "$unit.service" --property=ActiveState --value)
    case "$state" in inactive|failed) ;; *) exit 1 ;; esac
done
if test -f /etc/maanshan/standby.enabled; then
    mv /etc/maanshan/standby.enabled "$cutover_backup/standby.enabled.removed"
fi
install -m 644 -o root -g root "$source_file" "$installed_file.next"
mv "$installed_file.next" "$installed_file"
install -d -m 700 -o root -g root /etc/maanshan
install -m 600 -o root -g root /dev/null /etc/maanshan/direct-postgres.enabled
systemctl enable --now maanshan-backup.timer maanshan-health-restore.timer maanshan-health-check.timer
systemctl start maanshan-backup.service
systemctl start maanshan-health-restore.service
systemctl start maanshan-health-check.service
cat /var/lib/maanshan-health/health-latest.json
```

No daemon reload is needed for this sequence because unit definitions and the
health service command remain unchanged. Include the new mode marker in private
recovery configuration snapshots. A rollback needs an explicit source-of-truth
and data reconciliation review; removing the marker or re-enabling an old
import timer alone is not a safe data rollback.

## Optional standby reconciliation

`standby-run.py` is disabled until explicitly enabled. Its 04:00 daily timer
reads the latest **existing local Blob export**. It makes a fresh private
PostgreSQL dump before importing and another after success. The new backup
names include `-standby-before` / `-standby-after`; the recovery checker selects
the newest completed dump, including these copies. Snapshot files remain
postgres-owned 0600 in `/var/backups/maanshan` and are never overwritten.

The importer requires explicit localhost PostgreSQL configuration and explicit
write enable. It validates the whole export and its SHA before connecting,
refuses exports older than four hours, takes a bounded table lock, and commits
new rows in one transaction. It never updates/deletes an existing row. A newer
PostgreSQL value is retained. Repeating an export inserts nothing. The same
sync ID with another identity/payload, or distinct sync IDs with exactly the
same source timestamp, aborts the whole import for review. Database JSONB key
ordering is ignored in payload comparison. Invalid exports, an unfinished
newest export, or a failed scheduled export do not silently become a partial
class/import. Every current export record is accounted for as inserted,
already present, or superseded by newer PostgreSQL work.

This is a daily standby copy with roughly one-day recovery point, not realtime
replication. Changes after a scan wait for the next daily export. An insert
commit followed by failed post-import dump is reported as failure; the valid
pre-import dump and Blob export remain. Rerunning is idempotent. Historical PG
records not represented in Blob remain in PG. Final Vercel cutover still needs
a last export/reconciliation and count/report checks after the last writes.

## Review, installation and operations

After reviewing the code and deploying it as part of the current release:

```sh
sudo sh /srv/maanshan/current/deploy/health-install.sh --check
sudo sh /srv/maanshan/current/deploy/health-install.sh --apply
```

The second command only enables local health and isolated restore checks. To
also authorize daily standby writes (and the first reconciliation immediately):

```sh
sudo sh /srv/maanshan/current/deploy/health-install.sh --apply --enable-standby
```

This creates a root-owned `/etc/maanshan/standby.enabled` marker, never an extra
secret file. The importer reads the existing app.env only in the ubuntu child
process. The root wrapper uses peer-authenticated local pg_dump as postgres.

Inspect locally without reading student contents:

```sh
sudo cat /var/lib/maanshan-health/health-latest.json
sudo cat /var/lib/maanshan-restore/restore-latest.json
sudo cat /var/lib/maanshan-standby/standby-latest.json
systemctl list-timers 'maanshan-*'
```

Disable optional standby writes with `sudo systemctl disable --now
maanshan-standby-import.timer` and remove only the explicit enable marker after
checking any running unit has finished. Do not delete data or old backups.
Health/restore timers can independently be disabled without affecting serving.

The local backup collector should include the three private report directories,
new installed units, and the enable marker when present, as well as its existing
full PG/Blob backup archives. Credentials are unchanged. The ordinary deployment
updater does not automatically install these units.

The installer copies the three privileged Python scripts into root-owned
`/usr/local/lib/maanshan-maintenance` (directory 0755, scripts 0644). These units
never execute Python from the ubuntu-writable application release. Both the
export verifier and actual importer execute application JavaScript as ubuntu.
After updating this operations code, separately review and rerun the installer;
ordinary application deployment deliberately does not replace privileged code.

## Verification commands

```sh
node --test deploy/standby-import.test.cjs
python3 deploy/health-check.test.py
python3 deploy/health-restore.test.py
python3 deploy/standby-run.test.py
```

The POSIX permission tests run on Linux (explicitly skipped on Windows).
Real restore and SQL tests should use an isolated temporary cluster, never
create/drop a test database inside the production cluster.
`standby-isolated-test.cjs` is the integration fixture for that private socket;
it refuses a production database name/socket and verifies real SQL, repeated
imports, conflicts, timestamps, and transaction rollback in the disposable DB.
