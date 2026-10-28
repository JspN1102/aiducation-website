// school74: pre-records every clip of 小老師找錯 / 讀音小偵探 (maanshan/practice-games-data.mjs)
// into maanshan/media/practice-games-20261029/<id>.mp3, through the site's own TTS handler with
// the app's voice, speed and pronunciation profile. Needs TENCENT_SECRET_ID/KEY in the environment
// and FFMPEG (path to ffmpeg.exe). Existing files are kept; pass --force to remake them.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'maanshan/media/practice-games-20261029');
const ffmpeg = process.env.FFMPEG || 'ffmpeg';
const force = process.argv.includes('--force');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');

function call(handler, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) {headers[name.toLowerCase()] = value;},
      status(code) {this.statusCode = code;return this;},
      json(value) {reject(new Error(`TTS ${this.statusCode}: ${value?.error || 'error'}`));return this;},
      end(buffer) {this.statusCode < 300 && buffer ? resolve({buffer, type: headers['content-type']}) : reject(new Error(`TTS ${this.statusCode}`));return this;}
    };
    Promise.resolve(handler({method: 'POST', headers: {}, body}, res)).catch(reject);
  });
}

async function main() {
  const {PRACTICE_GAME_CLIPS, clipMarkup} = await import('../maanshan/practice-games-data.mjs');
  const handler = require('../api/tts.js');
  fs.mkdirSync(output, {recursive: true});
  const report = [];
  for (const clip of PRACTICE_GAME_CLIPS) {
    if (only && !only.includes(clip.id)) continue;
    const file = path.join(output, `${clip.id}.mp3`);
    if (fs.existsSync(file) && !force) continue;
    const {buffer} = await call(handler, {text: clipMarkup(clip.id), voice: 403001, speed: -0.25, pronunciationVersion: 'edb-20260921-natural1-yunxiaohe', allowSSML: true});
    const wav = path.join(output, `${clip.id}.tmp.wav`);
    fs.writeFileSync(wav, buffer);
    const encoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-ar', '16000', '-b:a', '64k', file], {windowsHide: true});
    fs.rmSync(wav);
    if (encoded.status !== 0) throw new Error(`ffmpeg failed on ${clip.id}`);
    report.push({id: clip.id, bytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 12)});
    console.log(clip.id);
  }
  console.log(JSON.stringify({made: report.length, total: PRACTICE_GAME_CLIPS.length, bytes: report.reduce((sum, item) => sum + item.bytes, 0)}));
}
main().catch(error => {console.error(error.message);process.exitCode = 1;});
