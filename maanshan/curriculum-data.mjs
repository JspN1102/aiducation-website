// Public, account-independent curriculum. Boot and app share the same requests;
// a failed file can retry without downloading the already successful one again.
const resources = new Map();
function loadJSON(relative) {
  const url = new URL(relative, import.meta.url).href;
  if (resources.has(url)) return resources.get(url);
  let pending;
  pending = fetch(url, {signal: AbortSignal.timeout(15000)}).then(async response => {
    if (!response.ok) throw new Error('Curriculum resource unavailable');
    return response.json();
  }).catch(error => {if (resources.get(url) === pending) resources.delete(url);throw error;});
  resources.set(url, pending);
  return pending;
}

export function loadCurriculum() {
  return Promise.all([loadJSON('./poems.json?v=20260919b'), loadJSON('./pronunciation.json?v=20260919a')]);
}
