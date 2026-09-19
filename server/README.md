# Standalone API service

The existing `api/` handlers continue to work on Vercel. This adapter runs the
same handlers on Node 20.20 or later, with PostgreSQL available through
`DB_DRIVER=postgres`. It does not serve frontend files.

```sh
npm ci
npm run build:server
npm run test:server
# Place a private, mode-600 .env file in the project root first.
npm start
```

`npm start` uses Node's `--env-file=.env`; it never embeds credentials in the
build. PM2 can run `server/index.cjs` with `node_args: '--env-file=.env'` and
`cwd` set to the deployment directory. The default listener is
`127.0.0.1:3000`. `PORT` and `API_HOST` override this only when explicitly set.
With systemd, use `ExecStart=/usr/bin/node --env-file=/etc/maanshan.env /home/ubuntu/maanshan-app/server/index.cjs`
to keep configuration outside the deployment tree; set `User=ubuntu` and
`WorkingDirectory=/home/ubuntu/maanshan-app`.

Nginx should proxy `/api/` to this listener without rewriting the URI, with
`client_max_body_size 4m` and `proxy_read_timeout 75s`. The only local health
URL is `/api/health`; it reports process readiness, not external API or database
availability. Serve static files from a separate public directory or an explicit
allowlist. Never publish `.env`, `api/`, `server/`, `node_modules/`, backups,
repository files or logs.

Supported paths accept both trailing-slash forms and exactly match
`server/routes.cjs`. Request bodies must be JSON. Speech assessment permits up
to 4 MiB including base64 audio; other endpoints have smaller limits. The server
applies 15-second header and 30-second body deadlines. Each API has a total
deadline in `routes.cjs`: 65 seconds for reports, 35 for chat/TTS, 30 for scoring,
and 15–20 for handwriting/database calls.
Production API secrets, upstream base URL and voice configuration must be copied
from the verified existing deployment, not substituted with incompatible model
or voice names.

Run `npm run build:server` after any API or shared teaching-data change. Linux
deployments must run `npm ci` locally rather than copying Windows dependencies,
because esbuild installs a platform-specific executable. The generated
`server/.build/handlers.cjs` is private deployment output.

If Google handwriting recognition is unreachable from the server, set
`HANDWRITING_RELAY_URL=https://aiducation.asia/api/handwriting/` in its private
environment. That request goes directly to the existing Vercel recognizer, with
only strokes and optional writing context; it does not forward credentials or
try Google first. The Vercel deployment must keep this setting unset so it
continues to call Google directly. A hop marker and same-host check reject
recursive configurations. The relay remains an external dependency; its deadline
is nine seconds and failures return a bounded 502/504 response.
