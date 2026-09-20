'use strict';

function wantsChatStream(req){
  if(req.method!=='POST'||req.body?.stream!==true)return false;
  return String(req.headers?.accept||'').split(',').some(entry=>{
    const [type,...parameters]=entry.trim().toLowerCase().split(';');
    const quality=parameters.map(value=>value.trim()).find(value=>value.startsWith('q='));
    return type==='text/event-stream'&&(!quality||Number(quality.slice(2))>0);
  });
}

// Install before authentication, but do not send headers until there is a
// successful response. Login, CSRF and input errors retain ordinary JSON/status.
function installChatStream(req,res){
  if(!wantsChatStream(req)||typeof res.write!=='function'||typeof res.end!=='function')return false;
  if(res.chatStreaming)return true;
  const originalJSON=res.json.bind(res),controller=new AbortController();
  let started=false,finished=false;
  const cleanup=()=>{res.off?.('close',closed);res.off?.('finish',cleanup);req.off?.('aborted',disconnected);};
  const disconnected=()=>{if(finished||controller.signal.aborted)return;controller.abort(new DOMException('Chat connection closed','AbortError'));cleanup();};
  const closed=()=>{if(!res.writableEnded)disconnected();else cleanup();};
  res.once?.('close',closed);res.once?.('finish',cleanup);req.once?.('aborted',disconnected);
  res.chatSignal=controller.signal;res.chatStreaming=true;
  function start(){
    if(started)return;
    res.removeHeader?.('Content-Length');res.removeHeader?.('Content-Encoding');
    res.setHeader('Content-Type','text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Accel-Buffering','no');
    started=true;res.flushHeaders?.();
  }
  function send(value){
    if(finished||controller.signal.aborted||res.destroyed||res.writableEnded)return false;
    start();return res.write('data: '+JSON.stringify(value)+'\n\n');
  }
  res.chatDelta=text=>typeof text==='string'&&text.length?send({type:'delta',text}):true;
  res.json=body=>{
    if(finished||controller.signal.aborted||res.destroyed||res.writableEnded)return res;
    const error=(res.statusCode||200)>=400||!body||typeof body!=='object'||!!body.error;
    if(!started&&error){finished=true;cleanup();return originalJSON(body);}
    send({...body,type:error?'error':'done',...error?{}:{researchRecorded:body.researchRecorded===true}});
    finished=true;cleanup();res.end();return res;
  };
  if(req.aborted||res.destroyed)disconnected();
  return true;
}

// One UTF-8 decoder and one line buffer survive arbitrary network boundaries,
// including a Chinese character or the CRLF separator split across chunks.
function createSSEParser(onData){
  const decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',data=[],ended=false;
  function line(value){
    if(value===''){if(data.length){const value=data.join('\n');data=[];onData(value);}return;}
    if(value.startsWith(':'))return;
    const colon=value.indexOf(':'),field=colon<0?value:value.slice(0,colon);
    if(field!=='data')return;
    const valuePart=colon<0?'':value.slice(colon+1).replace(/^ /,'');data.push(valuePart);
  }
  function drain(final=false){
    for(;;){
      const index=buffer.search(/[\r\n]/u);if(index<0)break;
      if(!final&&buffer[index]==='\r'&&index===buffer.length-1)break;
      const width=buffer[index]==='\r'&&buffer[index+1]==='\n'?2:1,value=buffer.slice(0,index);
      buffer=buffer.slice(index+width);line(value);
    }
    if(final){if(buffer){line(buffer);buffer='';}line('');}
  }
  return {push(chunk){if(ended)throw new Error('SSE parser ended');buffer+=decoder.decode(chunk,{stream:true});drain();},finish(){if(ended)return;ended=true;buffer+=decoder.decode();drain(true);}};
}

module.exports={wantsChatStream,installChatStream,createSSEParser};
