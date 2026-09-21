import {schoolFetch} from './school-session.mjs?v=20260921-school8';

// Only a final, verified completion enters chat history. Partial tokens are
// shown immediately but an interrupted stream is never saved as an answer.
export async function requestChat(body,{signal,onDelta,timeout=30000,fetchImpl=schoolFetch}={}){
  const controller=new AbortController();let expired=false,reader;
  const cancel=()=>controller.abort();
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>{expired=true;controller.abort();},timeout);
  try{
    const response=await fetchImpl('/api/maanshan-chat/',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream'},body:JSON.stringify({...body,stream:true}),signal:controller.signal});
    if(!response.ok)throw new Error(response.status===429?'現在較多人使用，稍後再試一次吧。':'暫時未能回答，可以再送一次。');
    if(!/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type')||'')){
      const data=await response.json();
      if(typeof data?.reply!=='string'||!data.reply.trim()||data.error)throw new Error('剛才的回覆未能完整收到，可以再試一次。');
      return data;
    }
    reader=response.body?.getReader();if(!reader)throw new Error('剛才的回覆未能完整收到，可以再試一次。');
    const decoder=new TextDecoder('utf-8',{fatal:true});let pending='',text='',bytes=0;
    for(;;){
      const part=await reader.read();
      if(controller.signal.aborted)throw new DOMException('Aborted','AbortError');
      bytes+=part.value?.byteLength||0;if(bytes>512*1024)throw new Error('回覆過長，請再問一個短問題。');
      pending+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});
      pending=pending.replace(/\r\n/g,'\n');
      let boundary;
      while((boundary=pending.indexOf('\n\n'))!==-1){
        const frame=pending.slice(0,boundary);pending=pending.slice(boundary+2);
        const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
        if(!data)continue;
        const event=JSON.parse(data);
        if(event.type==='delta'){
          if(typeof event.text!=='string')throw new Error('回覆格式不完整。');
          text+=event.text;if(text.length>20000)throw new Error('回覆過長，請再問一個短問題。');
          onDelta?.(event.text,text);
        }else if(event.type==='done'){
          if(typeof event.reply!=='string'||!event.reply.trim()||event.error)throw new Error('剛才的回覆未能完整收到，可以再試一次。');
          return event;
        }else if(event.type==='error')throw new Error('剛才的回覆未能完整收到，可以再試一次。');
      }
      if(part.done)throw new Error('剛才的回覆未能完整收到，可以再試一次。');
    }
  }catch(error){
    if(expired)throw new Error('這次等得有點久，可以再試一次。');
    if(signal?.aborted)throw new DOMException('Screen changed','AbortError');
    if(error instanceof TypeError||error instanceof SyntaxError)throw new Error('剛才未能完整連線，請再試一次。');
    throw error;
  }finally{
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);
    await reader?.cancel().catch(()=>{});
  }
}
// Bound the complete request (including the response body), and cancel it when
// its screen is left. Retry only an early transport failure, never a slow job.
export async function requestJSON(path, body, {timeout = 35000, signal, retry = false} = {}) {
  if (globalThis.navigator?.onLine === false) throw new Error('網絡已斷開，連線後可以再試一次。');
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, {once: true});
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  const url = path.startsWith('/api/') ? path.replace(/\/+$/, '') + '/' : path;
  const payload = JSON.stringify(body);
  try {
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      try {
        const response = await schoolFetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: payload, signal: controller.signal});
        if (!response.ok) {
          throw new Error(response.status === 429 ? '現在較多人使用，稍後再試一次吧。'
            : response.status === 504 ? '這次等得有點久，可以再試一次。'
              : '服務暫時未能完成，可以再試一次。');
        }
        let data;
        try { data = await response.json(); }
        catch (error) {
          if (controller.signal.aborted || error instanceof TypeError) throw error;
          throw new Error('剛才的回覆未能完整收到，可以再試一次。');
        }
        if (!data || data.error) throw new Error('服務暫時未能完成，可以再試一次。');
        return data;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        if (retry && attempt === 0 && error instanceof TypeError && Date.now() - started < 4000 && globalThis.navigator?.onLine !== false) continue;
        throw error;
      }
    }
  } catch (error) {
    if (timedOut) throw new Error('這次等得有點久，可以再試一次。');
    if (signal?.aborted) throw new DOMException('Screen changed', 'AbortError');
    if (globalThis.navigator?.onLine === false) throw new Error('網絡已斷開，連線後可以再試一次。');
    if (error instanceof TypeError) throw new Error('剛才未能連線，請再試一次。');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
