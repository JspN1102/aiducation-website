import {schoolFetch} from './school-session.mjs?v=20261007-school46';
import {prepareHandwritingPayload} from './handwriting-payload.mjs?v=20260922-school22';
// Research-only reason on the same error (message and type unchanged; never sets code).
const tag=(error,detail,status)=>Object.assign(error,{researchDetail:detail},Number.isInteger(status)?{researchHttpStatus:status}:{});

// Only a final, verified completion enters chat history. Partial tokens are
// shown immediately but an interrupted stream is never saved as an answer.
export async function requestChat(body,{signal,onDelta,timeout=30000,fetchImpl=schoolFetch}={}){
  const controller=new AbortController();let expired=false,reader;
  const cancel=()=>controller.abort();
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>{expired=true;controller.abort();},timeout);
  try{
    const response=await fetchImpl('/api/maanshan-chat/',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({...body,stream:true}),signal:controller.signal});
    if(!response.ok)throw tag(new Error(response.status===429?'現在較多人使用，稍後再試一次吧。':'暫時未能回答，可以再送一次。'),response.status===429?'busy':'service',response.status);
    if(!/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type')||'')){
      const data=await response.json();
      if(typeof data?.reply!=='string'||!data.reply.trim()||data.error)throw tag(new Error('剛才的回覆未能完整收到，可以再試一次。'),'incomplete');
      return data;
    }
    reader=response.body?.getReader();if(!reader)throw tag(new Error('剛才的回覆未能完整收到，可以再試一次。'),'incomplete');
    const decoder=new TextDecoder('utf-8',{fatal:true});let pending='',text='',bytes=0;
    for(;;){
      const part=await reader.read();
      if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
      bytes+=part.value?.byteLength||0;if(bytes>512*1024)throw tag(new Error('回覆過長，請再問一個短問題。'),'service');
      pending+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});
      pending=pending.replace(/\r\n/g,'\n');
      let boundary;
      while((boundary=pending.indexOf('\n\n'))!==-1){
        const frame=pending.slice(0,boundary);pending=pending.slice(boundary+2);
        const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
        if(!data)continue;
        const event=JSON.parse(data);
        if(event.type==='delta'){
          if(typeof event.text!=='string')throw tag(new Error('回覆格式不完整。'),'incomplete');
          text+=event.text;if(text.length>20000)throw tag(new Error('回覆過長，請再問一個短問題。'),'service');
          onDelta?.(event.text,text);
        }else if(event.type==='done'){
          if(typeof event.reply!=='string'||!event.reply.trim()||event.error)throw tag(new Error('剛才的回覆未能完整收到，可以再試一次。'),'incomplete');
          return event;
        }else if(event.type==='error')throw tag(new Error('剛才的回覆未能完整收到，可以再試一次。'),'incomplete');
      }
      if(part.done)throw tag(new Error('剛才的回覆未能完整收到，可以再試一次。'),'incomplete');
    }
  }catch(error){
    if(expired)throw tag(new Error('這次等得有點久，可以再試一次。'),'timeout');
    if(signal?.aborted)throw new DOMException('Screen changed','AbortError');
    if(error instanceof TypeError||error instanceof SyntaxError)throw tag(new Error('剛才未能完整連線，請再試一次。'),'network');
    throw error;
  }finally{
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);
    await reader?.cancel().catch(()=>{});
  }
}
// Bound the complete request (including the response body), and cancel it when
// its screen is left. retry:true resends only an early transport failure, never
// a slow job. retry:'transport' (a drawing carrying a requestId, which the origin
// answers once) also resends once when the answer was lost: the network dropped,
// the relay answered 502/503/504 or the body broke off; still within `timeout`.
export async function requestJSON(path, body, {timeout = 35000, signal, retry = false, fetchImpl = schoolFetch} = {}) {
  if (globalThis.navigator?.onLine === false) throw tag(new Error('網絡已斷開，連線後可以再試一次。'), 'offline');
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  const url = path.startsWith('/api/') ? path.replace(/\/+$/, '') + '/' : path;
  const payload = JSON.stringify(/(?:^|\/)handwriting\/?$/.test(path) ? await prepareHandwritingPayload(body) : body);
  try {
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();let lost = false;
      try {
        const response = await fetchImpl(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: payload, signal: controller.signal});
        if (!response.ok) {
          lost = [502, 503, 504].includes(response.status);
          throw tag(new Error(response.status === 429 ? '現在較多人使用，稍後再試一次吧。'
            : response.status === 504 ? '這次等得有點久，可以再試一次。'
              : '服務暫時未能完成，可以再試一次。'), response.status === 429 ? 'busy' : 'service', response.status);
        }
        let data;
        try { data = await response.json(); }
        catch (error) {
          if (controller.signal.aborted || error instanceof TypeError) throw error;
          lost = true;
          throw tag(new Error('剛才的回覆未能完整收到，可以再試一次。'), 'incomplete');
        }
        if (!data || data.error) throw tag(new Error('服務暫時未能完成，可以再試一次。'), 'service');
        return data;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        if (retry && attempt === 0 && globalThis.navigator?.onLine !== false && (retry === 'transport' ? lost || error instanceof TypeError : error instanceof TypeError && Date.now() - started < 4000)) continue;
        throw error;
      }
    }
  } catch (error) {
    if (timedOut) throw tag(new Error('這次等得有點久，可以再試一次。'), 'timeout');
    if (signal?.aborted) throw new DOMException('Screen changed', 'AbortError');
    if (globalThis.navigator?.onLine === false) throw tag(new Error('網絡已斷開，連線後可以再試一次。'), 'offline');
    if (error instanceof TypeError) throw tag(new Error('剛才未能連線，請再試一次。'), 'network');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
