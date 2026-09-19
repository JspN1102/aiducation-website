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

export default Object.freeze({
  soe, tts, chat, report, handwriting,
  'maanshan-chat': maanshanChat,
  'maanshan-report': maanshanReport,
  'maanshan-save': maanshanSave,
  'maanshan-data': maanshanData,
  'maanshan-init': maanshanInit
});
