#!/bin/sh
# Reviewable opt-in installer. Default checks prerequisites and writes nothing.
set -eu
umask 077
action=${1:---check}
standby=${2:-}
case "$action" in --check|--apply) ;; *) exit 2 ;; esac
case "$standby" in ''|--enable-standby) ;; *) exit 2 ;; esac
test "$(id -u)" = 0
source_dir=/srv/maanshan/current/deploy
for name in health-check.py health-restore.py health-check.service health-check.timer health-restore.service health-restore.timer standby-import.cjs standby-run.py standby-import.service standby-import.timer; do
    test -f "$source_dir/$name"
done
test -x /usr/lib/postgresql/14/bin/initdb
test -x /usr/lib/postgresql/14/bin/pg_restore
test -x /usr/bin/node
test -x /usr/sbin/runuser
test -d /var/backups/maanshan
test -d /home/ubuntu/maanshan-backups/blob
systemd-analyze calendar '*-*-* 04:45:00 Asia/Shanghai' >/dev/null
systemd-analyze calendar '*-*-* 04:00:00 Asia/Shanghai' >/dev/null
if [ "$action" = --check ]; then
    printf 'Prerequisites checked; nothing installed or imported.\n'
    exit 0
fi

# These new units do not alter/restart nginx, the API or production PostgreSQL.
install -d -m 700 -o root -g root /var/lib/maanshan-health
install -d -m 700 -o postgres -g postgres /var/lib/maanshan-restore
install -d -m 755 -o root -g root /usr/local/lib/maanshan-maintenance
for name in health-check.py health-restore.py standby-run.py; do
    install -m 644 -o root -g root "$source_dir/$name" "/usr/local/lib/maanshan-maintenance/$name"
done
for name in health-check.service health-check.timer health-restore.service health-restore.timer; do
    install -m 644 -o root -g root "$source_dir/$name" "/etc/systemd/system/maanshan-$name"
done
systemd-analyze verify /etc/systemd/system/maanshan-health-check.service /etc/systemd/system/maanshan-health-restore.service
systemctl daemon-reload
systemctl enable --now maanshan-health-restore.timer maanshan-health-check.timer
systemctl start maanshan-health-restore.service

if [ "$standby" = --enable-standby ]; then
    # This explicit flag authorizes the scheduled standby writes; the default
    # installation leaves this feature absent and never touches app.env.
    install -d -m 700 -o root -g root /var/lib/maanshan-standby /etc/maanshan
    for name in standby-import.service standby-import.timer; do
        install -m 644 -o root -g root "$source_dir/$name" "/etc/systemd/system/maanshan-$name"
    done
    systemd-analyze verify /etc/systemd/system/maanshan-standby-import.service
    install -m 600 -o root -g root /dev/null /etc/maanshan/standby.enabled
    systemctl daemon-reload
    systemctl enable --now maanshan-standby-import.timer
    # Run the first import deliberately after installer review, even though the
    # timer may also have caught up a missed run. systemd serializes this unit.
    systemctl start maanshan-standby-import.service
fi
systemctl start maanshan-health-check.service
printf 'Local checks installed. No external notifications are configured.\n'
