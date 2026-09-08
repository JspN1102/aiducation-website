export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
export const scoreLabel = score => score >= 90 ? '非常出色' : score >= 75 ? '表現良好' : score >= 60 ? '繼續進步' : '再練習一次';

export function mapAssessment(raw, line) {
  const accuracy = numeric(raw.PronAccuracy);
  const total = numeric(raw.SuggestedScore) ?? accuracy;
  if (total === null) throw new Error('評測沒有返回分數，請重新錄音。');
  const characters = Array.from(line.text);
  const simple = Array.from(line.simplified);
  const words = (Array.isArray(raw.Words) ? raw.Words : []).filter(w => /[\u3400-\u9fff]/.test(w.Word || '')).map((w, index) => {
    const source = w.Word || '';
    const position = simple[index] === source || characters[index] === source ? index : Math.max(simple.indexOf(source), characters.indexOf(source));
    const score = numeric(w.PronAccuracy);
    return {c: position >= 0 ? characters[position] : source, p:position >= 0 ? line.pinyin[position] : '', score:score === null ? null : Math.round(clamp(score)), status:score === null ? 'unknown' : score < 60 ? 'error' : score < 80 ? 'warn' : 'ok', error:score !== null && score < 80 ? '這個字可以再練習' : '', phones:(w.PhoneInfos || []).map(p => ({phone:p.Phone || '',score:numeric(p.PronAccuracy)})).filter(p => p.score !== null)};
  });
  return {total_score:Math.round(clamp(total)),grade:scoreLabel(total),dimensions:{phone_score:accuracy === null ? null : Math.round(clamp(accuracy)),fluency_score:numeric(raw.PronFluency) === null ? null : Math.round(clamp(raw.PronFluency * 100)),integrity_score:numeric(raw.PronCompletion) === null ? null : Math.round(clamp(raw.PronCompletion * 100))},words};
}

export function mergeAssessments(results) {
  const valid = results.filter(r => r && Number.isFinite(r.total_score));
  if (!valid.length) return null;
  const mean = values => values.length ? Math.round(values.reduce((a,b) => a+b,0)/values.length) : null;
  const total = mean(valid.map(r => r.total_score));
  return {total_score:total,grade:scoreLabel(total),dimensions:Object.fromEntries(['phone_score','fluency_score','integrity_score'].map(key => [key,mean(valid.map(r => r.dimensions[key]).filter(Number.isFinite))])),words:valid.flatMap(r => r.words)};
}

export function handwritingMatch(candidates, target, simplified) {
  const values = candidates.filter(c => typeof c === 'string').map(c => c.trim());
  if (simplified && simplified !== target && values[0] === simplified) return 'simplified';
  if (values.slice(0,5).includes(target)) return 'correct';
  return 'incorrect';
}

export function createSyncQueue({read,write,send}) {
  let active = null;
  function flush() {
    if (active) return active;
    let drained = false;
    active=(async()=>{
      while (true) {
        try {
          const item=read()[0];
          if (!item) {drained=true;return;}
          const response=await send(item);
          if (!response.ok) return;
          const result=await response.json();
          if (result.ok !== true || result.stored !== 'db') return;
          // Read again after acknowledgement to retain records added during upload.
          if (write(read().filter(p => p.syncId !== item.syncId)) === false) return;
        } catch { return; }
      }
    })().finally(()=>{
      active=null;
      // An enqueue can run between the last empty read and this promise cleanup.
      if (drained && read().length) return flush();
    });
    return active;
  }
  return {add(item) {const pending=read();pending.push(item);write(pending);},flush};
}
