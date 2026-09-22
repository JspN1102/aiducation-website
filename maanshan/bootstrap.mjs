import {initializeSchoolSession, schoolState, onSchoolSessionInvalid} from './school-session.mjs?v=20260923-school23';
import {installImageRecovery} from './image-loader.mjs?v=20260923-school23';
import {loadCurriculum} from './curriculum-data.mjs?v=20260922-school12b';
import {installFonts} from './font-source.mjs?v=20260923-school23';
import {announcePackVersion} from './resource-pack.mjs?v=20260923-school23';

installImageRecovery();
// The full fonts arrive from the faster host; the page reads in the system font until then.
void installFonts();
// The recovery worker learns this deployment's pack version at once; app.js
// resumes a pack the pupil asked for once the account's grade is known.
announcePackVersion();

const app = document.querySelector('#app');
let invalidated = false;
onSchoolSessionInvalid(() => { invalidated = true; });

// Keep module evaluation synchronous: app.js awaits this same promise, while
// the dynamic app import starts only after login. There is no top-level cycle.
export const schoolSession = initializeSchoolSession(app);

// Public content starts alongside the account check. The app consumes these
// same promises; transient errors can retry without rejecting the login.
void loadCurriculum().catch(() => {});
// Only icons are needed to open the platform. Stroke demonstrations load their
// own optional library when requested, so they cannot delay reading or login.
const classroomResources = Promise.allSettled([
  loadScript('vendor/lucide-maanshan.js?v=20260918c', () => !!window.lucide)
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
    await import('./app.js?v=20260923-school23');
  } catch {
    if (!invalidated) window.showLoadRecovery?.();
  } finally {
    clearTimeout(recovery);
  }
}).catch(() => { if (!invalidated) window.showLoadRecovery?.(); });
