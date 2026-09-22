// Two routes for every published recording (word readings, poem lines and the
// official recitations): the deployed copy on the page's own origin and the
// public content-addressed COS copy in Guangzhou. The shared media-route
// memory decides which goes first; the player switches to the other copy when
// the first errors or produces nothing. Recordings made on the spot (blob and
// data URLs) and speech synthesised by the school server have one route only.
// Nothing about the pupil is sent or stored.
import {AUDIO_GROUPS} from './media-audio.mjs?v=20260923-school23';
import {orderRoutes} from './media-route.mjs?v=20260923-school23';

const NAME = /^[a-z0-9_-]+\.(?:mp3|m4a)$/;
const groups = Object.entries(AUDIO_GROUPS).map(([folder, prefix]) => ({folder: new URL(folder, import.meta.url).href, prefix}));

// Ordered routes for one recording URL. A published copy is recognised from
// either of its two forms; anything else keeps its single route.
export function audioCandidates(source, {preferPublic, memory} = {}) {
  if (typeof source !== 'string' || !source) return [];
  let url;
  try { url = new URL(source, import.meta.url); } catch { return [{route: 'local', url: source}]; }
  const clean = url.href.split('?')[0].split('#')[0];
  for (const {folder, prefix} of groups) {
    const local = clean.startsWith(folder) ? clean.slice(folder.length) : clean.startsWith(prefix) ? clean.slice(prefix.length) : null;
    if (local === null || !NAME.test(local)) continue;
    const own = clean.startsWith(folder) ? url.href : folder + local;
    return orderRoutes(own, prefix + local, {preferPublic, memory});
  }
  return [{route: 'local', url: url.href}];
}
