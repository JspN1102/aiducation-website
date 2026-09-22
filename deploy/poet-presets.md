# Prepared poet answers

The shared catalogue is `maanshan/poet-presets.mjs`: six poems, three visible
buttons each. Every answer is generated from the canonical poem, teaching
notes, poet prompt, school grade and that exact question. No pupil message,
name, history or account is used in preparation.

Current upstream availability was checked by the deployment operator. Use
the exact supported names, not an invented alias:

- `POET_CHAT_MODEL=deepseek-flash`: live conversations.
- `POET_PRESET_MODEL=deepseek-v4-pro`: prepared answers.
- `TEACHER_AI_MODEL=deepseek-v4-pro`: existing report worker.
- `POET_PRESET_CACHE_DIR=/home/ubuntu/maanshan-shared/poet-presets`: private,
  persistent directory outside releases/public files; owned by application user.

The upstream currently rejects the requested v4.1 names. If availability
changes, first test the actual returned model, then set the supported name and
warm the new entries. `GPT_API_KEY` and `GPT_API_BASE` remain private runtime
configuration; no credential is written into a prepared answer. Report model
configuration remains independent (`TEACHER_AI_*`, with existing GPT fallbacks).

Run on the Guangzhou application server after copying the reviewed source:

```sh
node --env-file=/home/ubuntu/maanshan-shared/app.env \
  /srv/maanshan/current/deploy/poet-presets-warm.cjs --apply
node --env-file=/home/ubuntu/maanshan-shared/app.env \
  /srv/maanshan/current/deploy/poet-presets-warm.cjs
```

`--poem 1` through `--poem 6` narrows either command. Without `--apply` the
command only checks all current descriptors and returns nonzero if any is
missing. With `--apply`, existing valid entries are reused; only missing entries
call Pro. Generation is sequential and each provider request is bounded at
180 seconds. The command prints only preset IDs, model IDs, safe statuses and
counts. Review the generated JSON privately before release for historical
accuracy, suitable language and newly written verse attribution. HTTP success
and schema validation cannot replace this content review.

A `.warming` directory locks administrative generation. If a process is killed,
verify that no warmer is running before removing that one stale lock. Do not
remove an active lock or start parallel paid warmers. Individual successfully
generated answers survive interruption and are reused on the next run.

Each SHA-256 filename incorporates question/poem/grade, catalogue version,
canonical prompt/teaching-content digest, provider and model. The record keeps
the exact identity, answer checksum, returned model and creation time. Writes
use private temporary files and atomic rename. Corrupt/truncated/mismatched
records count as misses. Old model/content entries are preserved, never silently
reused. Include this directory in private backups alongside other shared state.

Front-end button contract: resolve `matchPoetPreset(poemId, text)`, then include
`presetId` and `presetVersion` with the ordinary messages request. The server
verifies current poem, grade, exact final user question, ID and version. An
arbitrary flag cannot select a different stored answer. Keep these fields on a
retry of that same button message; clear them for a newly typed message.

Explicit buttons start a self-contained response, including creative/other-poem
starters. Ordinary typed follow-ups always use conversation history. A first
single-message exact factual preset can also use its cache; creative/reading
starters require the explicit click identity. An outdated/mismatched marker
bypasses the cache. A cache miss uses the fast live model; it never makes a
student wait for an administrative Pro generation.

`X-Poet-Cache` reports HIT/MISS/BYPASS. Cached replies retain the normal SSE
delta/done format and the authenticated research receipt. Their research
provider is `aiducation-cache`, their model is the actual stored Pro model,
and providerVersion ends `preset-hit`. This is a cached process response, not
a new paid inference or a student assessment. Live metadata comes from the
configured/returned provider model. No transcript persistence is added here.

```sh
node --test server/poet-presets.test.cjs server/chat-stream.test.cjs server/school-learning.test.cjs
npm run build:server
```

These tests use synthetic providers and temporary directories, not production
accounts, research writes or paid APIs.
