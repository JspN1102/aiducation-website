'use strict';

// This list is deliberately explicit: a URL can never select an arbitrary file.
module.exports = Object.freeze({
  soe: { bodyLimit: 4 * 1024 * 1024, timeoutMs: 30000 },
  tts: { bodyLimit: 64 * 1024, timeoutMs: 35000 },
  chat: { bodyLimit: 128 * 1024, timeoutMs: 35000 },
  report: { bodyLimit: 512 * 1024, timeoutMs: 65000 },
  'maanshan-chat': { bodyLimit: 128 * 1024, timeoutMs: 35000 },
  'maanshan-report': { bodyLimit: 512 * 1024, timeoutMs: 65000 },
  'maanshan-save': { bodyLimit: 384 * 1024, timeoutMs: 15000 },
  'maanshan-data': { bodyLimit: 1024, timeoutMs: 20000 },
  'maanshan-init': { bodyLimit: 1024, timeoutMs: 15000 },
  handwriting: { bodyLimit: 512 * 1024, timeoutMs: 15000 }
});
