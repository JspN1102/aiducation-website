import soe from '../api/soe.js';
import tts from '../api/tts.js';
import chat from '../api/chat.js';
import report from '../api/report.js';
import maanshanChat from '../api/maanshan-chat.js';
import maanshanReport from '../api/maanshan-report.js';
import maanshanSave from '../api/maanshan-save.js';
import maanshanData from '../api/maanshan-data.js';
import maanshanInit from '../api/maanshan-init.js';
import handwriting from '../api/handwriting.js';
import schoolAuth from '../api/school-auth.js';
import researchEvents from '../api/research-events.js';
import teacherAnalytics from '../api/teacher-analytics.js';
import challengeResult from '../api/challenge-result.js';

export default Object.freeze({
  soe, tts, chat, report, handwriting,
  'maanshan-chat': maanshanChat,
  'maanshan-report': maanshanReport,
  'maanshan-save': maanshanSave,
  'maanshan-data': maanshanData,
  'maanshan-init': maanshanInit,
  'school-auth':schoolAuth,
  'research-events':researchEvents,
  'teacher-analytics':teacherAnalytics,
  'challenge-result':challengeResult
});
