// Two independent routes for every poem animation: the page's own origin
// (the Vercel deployment) and the public COS copy in Guangzhou. Hong Kong and
// overseas networks reach Vercel in well under a second but often lose packets
// to COS; mainland networks see the opposite. The session image probe decides
// which route goes first, the other route takes over when playback errors or
// stalls, and the route that actually played is remembered for the session.
// Nothing about the pupil is sent or stored.
import {VIDEO_ASSETS} from './media-videos.mjs?v=20260922-school19';
import {preferPublicImages} from './image-policy.mjs?v=20260922-school16';

const STORAGE_KEY = 'maanshan:animation-route';
export const STALL_MS = 8000;
const HAVE_FUTURE_DATA = 3;

function remembered() {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function remember(route) {
  try { sessionStorage.setItem(STORAGE_KEY, route); } catch { /* storage unavailable */ }
}

// Ordered routes for one animation source such as "media/<poem>/animation.mp4".
export function animationCandidates(source, {preferPublic = preferPublicImages(), memory = remembered()} = {}) {
  if (typeof source !== 'string' || !source) return [];
  const local = source.split('?')[0].split('#')[0];
  const key = local.startsWith('media/') ? '/maanshan/' + local : local;
  const remote = VIDEO_ASSETS[key];
  if (!remote) return [{route: 'local', url: local}];
  const publicFirst = memory === 'public' ? true : memory === 'local' ? false : !!preferPublic;
  const pair = [{route: 'public', url: remote}, {route: 'local', url: local}];
  return publicFirst ? pair : pair.reverse();
}

// Attach the first route to the player and switch to the next one when the
// media errors or, after play was requested, no playable data arrives within
// stallMs. Register this before other listeners: a handled error does not
// propagate, so the page only reports failure once every route was tried.
// A failed load leaves the element paused, so whether the pupil asked to play
// is tracked here and playback resumes on the next route without another tap.
export function manageAnimationSource(player, source, {stallMs = STALL_MS, candidates = animationCandidates(source)} = {}) {
  const events = new AbortController();
  const listen = (event, callback) => player.addEventListener(event, callback, {signal: events.signal});
  let index = 0, timer = null, disposed = false, wantsPlay = false, recovering = false;
  const last = () => index >= candidates.length - 1;
  function clear() { clearTimeout(timer); timer = null; }
  function arm() { clear(); if (!last()) timer = setTimeout(stalled, stallMs); }
  function stalled() {
    timer = null;
    if (!player.paused && !player.ended && player.readyState < HAVE_FUTURE_DATA) advance();
  }
  function load(next, position) {
    index = next;
    clear();
    if (position > 0) player.addEventListener('loadedmetadata', () => { player.currentTime = position; }, {once: true, signal: events.signal});
    player.src = candidates[index].url;
    player.load();
  }
  function advance() {
    if (disposed || last()) return false;
    const position = player.currentTime;
    recovering = wantsPlay;
    load(index + 1, position);
    if (wantsPlay) player.play().catch(() => { recovering = false; });
    return true;
  }
  listen('error', event => { if (advance()) event.stopImmediatePropagation(); else recovering = false; });
  listen('play', () => { wantsPlay = true; arm(); });
  listen('waiting', () => { if (!player.paused) arm(); });
  listen('playing', () => { clear(); recovering = false; remember(candidates[index].route); });
  listen('pause', () => { wantsPlay = false; recovering = false; clear(); });
  listen('ended', clear);
  listen('emptied', clear);
  if (candidates.length) load(0, 0);
  return {
    get current() { return candidates[index]?.url || ''; },
    get route() { return candidates[index]?.route || ''; },
    // True while the next route is loading after a failure with play requested.
    get recovering() { return recovering; },
    candidates: candidates.map(candidate => candidate.url),
    retry() { if (!disposed && candidates.length) { recovering = false; load(0, 0); } },
    dispose() { disposed = true; clear(); events.abort(); }
  };
}
