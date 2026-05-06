const WebSocket = require('ws');

const WS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&ConnectionId=';

function uuid() {
  return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function edgeTTS(text, voice) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL + uuid(), {
      host: 'speech.platform.bing.com',
      origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0' }
    });

    const audioChunks = [];
    let done = false;

    const timeout = setTimeout(() => {
      if (!done) { done = true; ws.close(); reject(new Error('TTS timeout')); }
    }, 10000);

    ws.on('open', () => {
      const config = JSON.stringify({ context: { synthesis: { audio: {
        metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
        outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
      }}}});
      ws.send(`X-Timestamp:${new Date().toISOString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${config}`);

      const ssml = `X-RequestId:${uuid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toISOString()}\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='${voice}'><prosody rate='+0%' volume='+0%'>${text}</prosody></voice></speak>`;
      ws.send(ssml);
    });

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        if (data.toString().includes('turn.end')) {
          done = true;
          clearTimeout(timeout);
          resolve(Buffer.concat(audioChunks));
          ws.close();
        }
        return;
      }
      const buf = Buffer.from(data);
      const sep = 'Path:audio\r\n';
      const idx = buf.indexOf(sep);
      if (idx >= 0) {
        audioChunks.push(buf.subarray(idx + sep.length));
      }
    });

    ws.on('error', (err) => {
      if (!done) { done = true; clearTimeout(timeout); reject(err); }
    });
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Missing text' });

  try {
    const buffer = await edgeTTS(text, 'zh-CN-XiaoxiaoNeural');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.status(200).end(buffer);
  } catch (e) {
    res.status(502).json({ error: e.message || 'TTS failed' });
  }
};
