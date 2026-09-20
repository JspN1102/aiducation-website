import {initializeSchoolSession, schoolState, onSchoolSessionInvalid} from './school-session.mjs?v=20260921-school3';
import {installImageRecovery} from './image-loader.mjs?v=20260920-art2';

installImageRecovery();

const app = document.querySelector('#app');
let invalidated = false;
onSchoolSessionInvalid(() => { invalidated = true; });

// Keep module evaluation synchronous: app.js awaits this same promise, while
// the dynamic app import starts only after login. There is no top-level cycle.
export const schoolSession = initializeSchoolSession(app);

// These are public classroom libraries. Fetch them while the account check is
// in flight instead of adding two more network waits after a successful login.
const classroomResources = Promise.allSettled([
  loadScript('vendor/lucide-maanshan.js?v=20260918c', () => !!window.lucide),
  loadScript('vendor/hanzi-writer.min.js', () => !!window.HanziWriter)
]);

function loadScript(src, available) {
  if (available()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); reject(new Error('Learning resource unavailable')); };
    document.head.append(script);
  });
}

schoolSession.then(async school => {
  if (invalidated || schoolState() !== school) return;
  delete document.body.dataset.screen;
  app.innerHTML = '<main id="main" class="loading-page" aria-busy="true"><span class="spinner"></span><p>正在開啟古詩</p></main>';
  const recovery = setTimeout(() => { if (!invalidated) window.showLoadRecovery?.(); }, 20000);
  try {
    const resources=await classroomResources;
    if(resources.some(result=>result.status==='rejected'))throw new Error('Learning resource unavailable');
    if (invalidated || schoolState() !== school) return;
    await import('./app.js?v=20260921-school3');
  } catch {
    if (!invalidated) window.showLoadRecovery?.();
  } finally {
    clearTimeout(recovery);
  }
}).catch(() => { if (!invalidated) window.showLoadRecovery?.(); });
