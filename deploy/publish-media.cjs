'use strict';
// Publish teaching media from this checkout to the school's public COS bucket
// and print the entries for deploy/media-manifest.json. Run it on the
// Guangzhou origin, whose service environment holds the COS key; the key is
// read from the environment and never printed:
//
//   node --env-file=/home/ubuntu/maanshan-shared/app.env deploy/publish-media.cjs \
//     maanshan/media/exploration/zao-chun/model.glb [more repository paths]
//   node --env-file=... deploy/publish-media.cjs --group maanshan/media/words --list words.txt
//
// Models, images and fonts become content-addressed objects
// (/published/<sha256[:20]>/<source>, immutable). Recorded audio is published
// as a group: every file of one folder shares a prefix derived from the
// digests of all listed files (/published/g-<group id>/<source>, immutable),
// so the browser needs one prefix per folder instead of a map of every clip.
// Animations keep their source path with a 30-day cache, exactly as
// deploy/media_config.py validates. An object that already exists with the
// same MD5 is left alone. Every object is then checked with an anonymous HEAD
// so a private or broken upload can never reach the manifest. Nothing is
// deleted or overwritten with different bytes.
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const ORIGIN = 'https://aiducation-mandarin-media-1427410149.cos.ap-guangzhou.myqcloud.com';
const SOURCE = /^maanshan\/(?:media\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:mp4|glb|webp|mp3|m4a)|vendor\/fonts\/[a-z0-9_-]+\.woff2)$/;
const AUDIO = /^maanshan\/media\/((?:[a-z0-9_-]+\/)*[a-z0-9_-]+)\/[a-z0-9_-]+\.(?:mp3|m4a)$/;
const TYPES = {'.mp4': 'video/mp4', '.glb': 'model/gltf-binary', '.webp': 'image/webp',
               '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.woff2': 'font/woff2'};
const IMMUTABLE = 'public, max-age=31536000, immutable', MONTH = 'public, max-age=2592000';
const ROOT = path.resolve(__dirname, '..');
const agent = new https.Agent({keepAlive: true, maxSockets: 4});

function setting(name) {
  const value = String(process.env[name] || '').trim();
  return value && value !== '""' ? value : '';
}

function config() {
  const bucket = setting('TTS_COS_BUCKET'), region = setting('TTS_COS_REGION');
  const secretId = setting('TTS_COS_SECRET_ID') || setting('TENCENT_SECRET_ID');
  const secretKey = setting('TTS_COS_SECRET_KEY') || setting('TENCENT_SECRET_KEY');
  if (!bucket || !region || !secretId || !secretKey) throw new Error('COS bucket, region and key must be set in the environment.');
  const host = `${bucket}.cos.${region}.myqcloud.com`;
  if (`https://${host}` !== ORIGIN) throw new Error('The configured bucket is not the school media bucket.');
  return {host, secretId, secretKey};
}

function sign(cfg, method, pathname) {
  const now = Math.floor(Date.now() / 1000), keyTime = `${now - 60};${now + 600}`;
  const signKey = crypto.createHmac('sha1', cfg.secretKey).update(keyTime).digest('hex');
  const httpString = `${method.toLowerCase()}\n${pathname}\n\nhost=${encodeURIComponent(cfg.host)}\n`;
  const stringToSign = `sha1\n${keyTime}\n${crypto.createHash('sha1').update(httpString).digest('hex')}\n`;
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  return `q-sign-algorithm=sha1&q-ak=${cfg.secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
}

function request(cfg, method, pathname, {body = null, headers = {}, signed = true} = {}) {
  return new Promise((resolve, reject) => {
    const requestHeaders = {Host: cfg.host, ...headers};
    if (signed) requestHeaders.Authorization = sign(cfg, method, pathname);
    if (body) requestHeaders['Content-Length'] = String(body.length);
    const client = https.request({host: cfg.host, path: pathname, method, headers: requestHeaders, timeout: 120000, agent}, response => {
      const chunks = [];
      response.on('data', chunk => { if (chunks.length < 16) chunks.push(chunk); });
      response.on('end', () => resolve({status: response.statusCode, headers: response.headers,
        code: /<Code>([^<]*)<\/Code>/.exec(Buffer.concat(chunks).toString())?.[1] || null}));
      response.on('error', reject);
    });
    client.on('timeout', () => client.destroy(new Error('COS request timed out')));
    client.on('error', reject);
    client.end(body || undefined);
  });
}

function digest(relative) {
  if (!SOURCE.test(relative)) throw new Error('Not a supported public media path: ' + relative);
  const file = path.join(ROOT, relative);
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Symlinks are not published: ' + relative);
  const bytes = fs.readFileSync(file);
  return {bytes, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
          md5: crypto.createHash('md5').update(bytes).digest('hex')};
}

function groupId(files) {
  const lines = files.map(file => '/' + file.relative + ' ' + file.sha256).sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 20);
}

function describe(relative, {bytes, sha256, md5}, group = null) {
  const extension = path.extname(relative), source = '/' + relative;
  if (AUDIO.test(relative) !== Boolean(group)) throw new Error('Recorded audio is published in groups only: ' + relative);
  const versioned = extension !== '.mp4';
  const objectPath = (group ? '/published/g-' + group.id : versioned ? '/published/' + sha256.slice(0, 20) : '') + source;
  return {
    bytes, objectPath,
    entry: {source, destination: ORIGIN + objectPath, bytes: bytes.length, sha256, md5, contentType: TYPES[extension],
            objectCacheControl: versioned ? IMMUTABLE : MONTH, ...(group ? {group: group.name} : {})}
  };
}

async function publish(cfg, relative, {acl, group = null}) {
  const {bytes, objectPath, entry} = describe(relative, digest(relative), group);
  const existing = await request(cfg, 'HEAD', objectPath, {signed: false});
  let action;
  if (existing.status === 200 && (existing.headers.etag || '').replace(/"/g, '') === entry.md5 && Number(existing.headers['content-length']) === entry.bytes) {
    action = 'unchanged';
  } else if (existing.status === 200) {
    throw new Error('An object with different content already exists at ' + objectPath);
  } else {
    const headers = {'Content-Type': entry.contentType, 'Cache-Control': entry.objectCacheControl,
                     'Content-MD5': Buffer.from(entry.md5, 'hex').toString('base64')};
    if (acl) headers['x-cos-acl'] = acl;
    const put = await request(cfg, 'PUT', objectPath, {body: bytes, headers});
    if (put.status !== 200) throw new Error(`Upload failed for ${relative}: HTTP ${put.status} ${put.code || ''}`.trim());
    action = 'uploaded';
  }
  const check = await request(cfg, 'HEAD', objectPath, {signed: false});
  const ok = check.status === 200 && Number(check.headers['content-length']) === entry.bytes &&
             (check.headers.etag || '').replace(/"/g, '') === entry.md5 &&
             check.headers['content-type'] === entry.contentType && check.headers['cache-control'] === entry.objectCacheControl;
  if (!ok) throw new Error(`Anonymous verification failed for ${relative}: HTTP ${check.status} ${check.code || ''}`.trim());
  return {action, entry};
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return '';
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(name + ' needs a value.');
  args.splice(index, 2);
  return value;
}

(async () => {
  const args = process.argv.slice(2);
  const acl = args.includes('--public-read') ? 'public-read' : '';
  const groupDirectory = option(args, '--group'), list = option(args, '--list'), output = option(args, '--output');
  let paths = args.filter(arg => !arg.startsWith('--'));
  let group = null;
  if (groupDirectory) {
    if (!list || paths.length) throw new Error('A group is published from a list file only.');
    const name = /^maanshan\/media\/((?:[a-z0-9_-]+\/)*[a-z0-9_-]+)$/.exec(groupDirectory)?.[1];
    if (!name) throw new Error('Not a recorded audio folder: ' + groupDirectory);
    paths = fs.readFileSync(list, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!paths.length) throw new Error('The group list is empty.');
    for (const relative of paths) {
      if (!AUDIO.test(relative) || AUDIO.exec(relative)[1] !== name) throw new Error('Not a clip of that folder: ' + relative);
    }
    if (new Set(paths).size !== paths.length) throw new Error('The group list repeats a clip.');
    group = {name, id: groupId(paths.map(relative => ({relative, sha256: digest(relative).sha256})))};
  } else if (!paths.length) throw new Error('Give at least one repository media path.');
  const cfg = config();
  const results = [];
  for (const relative of paths) {
    results.push({path: relative, ...await publish(cfg, relative, {acl, group})});
    if (results.length % 25 === 0) console.error(`${results.length}/${paths.length} done`);
  }
  const report = JSON.stringify({...(group ? {group} : {}), published: results.map(r => ({path: r.path, action: r.action})), entries: results.map(r => r.entry)}, null, 2);
  if (output) fs.writeFileSync(output, report + '\n');
  else console.log(report);
  console.error(`published ${results.length} objects (${results.filter(r => r.action === 'uploaded').length} uploaded)`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
