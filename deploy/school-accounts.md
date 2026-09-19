# Private school accounts

The reviewed 2026-2027 workbook contains **787 student identities and 9 teacher
identities**, not 820 accounts. Student rows 2–788 are real records. Student row
704 has a blank password and receives a separately generated initial password
under the authorised preparation option. Nine teachers each receive their own
random initial password. The 763-student summary at the bottom omits the real
4F class (24 pupils); summary/header/blank rows are never imported as accounts.
The source workbook is not modified.

The prepared files belong in a dedicated private desktop folder, never git,
public assets, deployments, chat logs, or URLs. Preparation restricts the Windows
folder to the current user and SYSTEM. The JSON snapshot contains per-account
scrypt N=32768/r=8/p=1 hashes with 16-byte independent salts. Internal IDs and
separate research IDs are random, stable pseudonyms, not names or school logins.
The private generated-password delivery contains only the nine teachers and
one pupil whose source password was blank, labelled by source. Passwords are
never printed by the tools. Teacher CSVs are private plaintext delivery files.

```sh
python deploy/school-accounts-prepare.py --input /private/roster.xlsx
python deploy/school-accounts-prepare.py --input /private/roster.xlsx --output /private/NEW-FOLDER --generate-missing-passwords --accept-summary-mismatch --apply
```

Rebuilds require `--previous /private/current-server-snapshot.json` so IDs,
research IDs and platform-changed passwords remain stable. Omitted previous
accounts are retained but disabled. Never rebuild against an obsolete original
snapshot after users have changed passwords. Explicit resets use the audited
API rather than silently restoring workbook passwords.

## Disabled by default

Only `SCHOOL_AUTH_ENABLED=1` enables authentication. Leave the original company
website/demo environment unchanged. The enabled deployment also needs:

- `SCHOOL_AUTH_SECRET`: at least 32 characters, generated privately; keep the
  same value across replicas. It keys the pseudonymous durable rate counters.
- `SCHOOL_AUTH_ORIGIN=https://mandarin.aiducation.asia`: exact allowed browser
  origin; POST login/logout/change/reset require it.
- `SCHOOL_AUTH_STORE=blob` with the existing private Blob token, or `postgres`
  with the existing explicit PostgreSQL DB settings.
- Optional `SCHOOL_AUTH_TRUST_PROXY=1` only behind the reviewed localhost Nginx
  proxy that replaces X-Real-IP. Vercel uses its platform-provided forwarded IP.

The importer creates the PostgreSQL `school_auth_objects` table only on apply.
Blob objects are private under `maanshan-school-auth-v1/`. Directory, server
sessions, revocation records, durable rate limits and teacher security audits
never overlap student result or TTS namespaces.

```sh
node --env-file=/private/runtime.env deploy/school-accounts-import.cjs --store blob --input /private/school-accounts.snapshot.json --dry-run
node --env-file=/private/runtime.env deploy/school-accounts-import.cjs --store blob --input /private/school-accounts.snapshot.json --apply
node --env-file=/private/app.env deploy/school-accounts-import.cjs --store postgres --input /private/school-accounts.snapshot.json --apply
```

An existing differing directory requires `--replace`. The tool refuses reassigned
IDs/research IDs/roles or missing old accounts. It also reconciles live account
revocation state. Repeat an interrupted identical import to complete that step.
No student results are rewritten. Switching storage requires the latest account
snapshot; sessions intentionally do not migrate, so users log in again.

## API and helper contract

`GET /api/school-auth` returns `{enabled,authenticated}` plus `user` and
`csrfToken` when authenticated. Public user fields are
`id,researchId,role,login,displayName,grade,cls,classNo` only. Teacher grade/class
fields are null. No credential hash/version is exposed.

`POST {action:"login",login,password}` creates a new 12-hour absolute server
session. The cookie is `__Host-maanshan_session`, Path=/, Secure, HttpOnly,
SameSite=Lax. Sessions use 256-bit random tokens; only token hashes reach server
storage. A shared-device login attempt revokes the old cookie session before
checking the next password, including failed attempts.

Every authenticated unsafe request must send `X-CSRF-Token` from the current
state plus the normal browser Origin. Old-tab CSRF cannot act as a newly logged
in pupil. The data API must additionally reject a submitted studentId that does
not equal the cookie actor; it must not silently reassign queued results.

- `POST {action:"logout"}`: revoke the server session, clear cookie.
- `POST {action:"change_password",currentPassword,newPassword}`: current secret
  required, new password at least 8 characters/at most 128 UTF-8 bytes. Success
  returns `{enabled:true,authenticated:false,passwordChanged:true}` and logs out
  all that account's sessions through immediate server revocation state.
- `POST {action:"reset_student_password",studentId}`: teacher only, whole-school
  scope. Success returns `{enabled:true,reset:true,studentId,initialPassword}`.
  The generated secret is returned only in this private no-store response; never
  log/store it in the browser. The target's sessions are revoked immediately.
- `GET ?action=roster`: teacher only, `{enabled:true,students,teachers,updatedAt}`.
  It includes students with no results so the dashboard can show not started.
- `GET ?action=progress`: student only,
  `{enabled:true,userId,poems:{"1":{reading?,writing?,report?},...}}`, latest payloads
  for this authenticated pupil only. Blob reads 18 exact private keys with bounded
  concurrency, not classmates' files; PostgreSQL filters by identity/class.

`require('./_lib/school-auth.cjs').requireActor(req,{roles,csrf})` returns the
server actor, or null only when authentication is explicitly disabled. `csrf`
defaults true for unsafe methods. It throws AuthError with status/code (401 no
session, 403 wrong role/CSRF/origin, 429 throttled, 503 unavailable). Use
`sendError(res,error)` for safe messages; do not echo raw database/upstream errors.
`listAccounts(req,{grade,cls})` is teacher-only. `audit(action,actor,{targetResearchId})`
records pseudonymous teacher actions; callers must pass a server actor. Research
interactions are separately logged by the research API, not duplicated here.

Limits are durable CAS counters across instances: 12 login attempts per account
per 15 minutes, 1200 per shared source IP, 10 self password changes and 100 teacher
resets per 15 minutes. Failed requests never fall back to public/legacy access
when enabled. Secure cookies require HTTPS; use test doubles or HTTPS locally.

## Backup and limits

Password changes make the initial desktop snapshot stale. Back up the current
hashed directory daily alongside private student exports:

```sh
node --env-file=/private/runtime.env deploy/school-accounts-import.cjs --store blob --export-output /private/NEW-EXPORT/school-accounts.snapshot.json --apply
node --env-file=/private/runtime.env deploy/school-accounts-import.cjs --store blob --export-audit-day 2026-09-20 --export-output /private/NEW-EXPORT/security-audit-20260920.json --apply
```

The output parent must already be a private directory. Export is exclusive and
never deletes source objects. Audit days are UTC; back up yesterday plus today's
partial audit in the daily job to cover later writes. Audits store pseudonymous
teacher/target IDs and action/time, never names/logins/passwords/IPs. The bounded
audit export fails above 10000 entries or 16 MiB instead of returning partial
history. Source sessions/rate-limit objects expire logically; no automated Blob
deletion is installed. PostgreSQL's normal whole-database dump includes account
state and security audits. Account directory export intentionally excludes live
session tokens; cutover requires login again.

Session expiry and logout are verified against server storage, not browser clocks.
The per-account revocation record is read for each authenticated request, so a
completed reset invalidates sessions across instances without waiting for the
30-second directory cache. If an account update fails between the directory and
revocation writes, the API reports failure; repeat the reviewed same snapshot
import to reconcile account state, or retry the reset after inspecting it. No
claim of cross-object Blob transactions is made.

Tests: `node --test server/school-auth.test.cjs` and
`python deploy/school-accounts-prepare.test.py`. Synthetic accounts only.
