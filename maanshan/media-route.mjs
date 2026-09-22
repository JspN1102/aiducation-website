// One session-wide memory of which big-media route worked: the page's own
// origin (the Vercel deployment) or the public COS copy in Guangzhou. Poem
// animations and 3D models share it because they share the same two hosts: a
// COS copy that just played or downloaded is the best evidence that the next
// COS download will work too, and the same holds for the deployed copy. Until
// a route has proven itself, the session image probe decides the order.
// Nothing about the pupil is sent or stored.
import {preferPublicImages} from './image-policy.mjs?v=20260922-school16';

const STORAGE_KEY = 'maanshan:media-route';

export function rememberedRoute() {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function rememberRoute(route) {
  if (route !== 'public' && route !== 'local') return;
  try { sessionStorage.setItem(STORAGE_KEY, route); } catch { /* storage unavailable */ }
}

// Ordered routes for one asset. Without a public copy only the local route
// exists; otherwise session memory wins, then the image probe result.
export function orderRoutes(local, remote, {preferPublic = preferPublicImages(), memory = rememberedRoute()} = {}) {
  if (!remote) return [{route: 'local', url: local}];
  const publicFirst = memory === 'public' ? true : memory === 'local' ? false : !!preferPublic;
  const pair = [{route: 'public', url: remote}, {route: 'local', url: local}];
  return publicFirst ? pair : pair.reverse();
}
