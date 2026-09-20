const https = require('https');
const {createSSEParser}=require('./chat-stream.cjs');
const providerAgent=new https.Agent({keepAlive:true,maxSockets:16,maxFreeSockets:4,timeout:30000,scheduling:'lifo'});
const { poems } = require('../../maanshan/poems.json');
const teachingNotes = {
  2: '依教育局《積累與感興》〈贈汪倫〉第1–2頁：「將欲」是將要；「踏歌」是一邊用腳打節拍，一邊唱歌。「深千尺」是誇張地形容潭水深，不是測量結果；重點是汪倫送別的情意更深。送別有驚喜、熱情和感動，不必一律講成悲傷。「萬家酒樓／千尺桃花」的邀請故事在材料中明列為傳說，聊到時要先說是傳說，不當作已證史實。',
  3: '依教育局《積累與感興》〈題西林壁〉第1–2頁：「題」是書寫，詩題指在西林寺的牆壁上題詩。「橫看」是從正面看，不是把頭橫過來；「嶺」是相連的山，「峰／峯」是高而陡峭的山，兩種字形在本詩意思相同。「緣」是因為，「真面目」指整體面貌。變的是觀察位置與視野，不是山自己變形；對低小學生用同一物品從正面、側面看作例子，不要求分析抽象哲理。',
  4: '依教育局《積累與感興》〈泊船瓜洲〉第1–2頁：京口與瓜洲隔着長江，鍾山指南京紫金山、王安石的家所在；本詩是離家赴京途中泊船瓜洲、盼望日後回家，不是已經回到家。「綠」作動詞，寫春風使江岸草木變綠；「還」讀 huán，指回到鍾山下的家。「到、過、入、滿」改成「綠」的煉字故事在材料中以「據說」引出，引用時保留這個性質。',
  5: '本平台依教育局《積累與感興——小學古詩文誦讀材料選編（修訂）》〈歸園田居（其三）〉第2頁注釋7：「道狹草木長」的「長」讀 cháng（第二聲）。教學、報告與聊天均依此讀音，不要以「生長」為由教學生改讀 zhǎng。「晨興」是早起，「理荒穢」是清除豆田雜草，「荷」讀 hè、是扛着，「霑」通「沾」。陶潛就是陶淵明。全詩既寫農事辛勞，也寫熱愛田園、堅守心願的滿足，不要只講成受苦或抱怨。',
  6: '依教育局《積累與感興》〈初春小雨〉第1–2頁：本詩是《早春呈水部張十八員外》的第一首，張十八指好友張籍。「天街」是京城街道，「皇都」指長安；「好處」在這裏是最好的時節，不是好地方或利益；「絕勝」是遠遠超過。詩人比較早春與暮春，表達自己更喜愛早春，不是宣告人人必須有同樣喜好。「近卻無」是細小稀疏的草芽近看不呈一片綠，草沒有消失。「酥」指酥油，取其細膩、潤澤比喻初春細雨。「路滑」「踩起來滑」「不泥濘」不是詞義，也不能用這些想像代替解釋。'
};

function getPoem(poemId, defaultId = 2) {
  const id = poemId === undefined ? defaultId : poemId;
  return Number.isInteger(id) ? poems.find(poem => poem.id === id) || null : null;
}

function poemContext(poem) {
  const lines = poem.lines.map(line => `${line.text}${line.punctuation || ''} (${line.pinyin.join(' ')})`);
  return [
    `篇目：《${poem.title}》`,
    `作者：${poem.dynasty}代${poem.author}`,
    `作者資料：${poem.authorBio}`,
    `詩意：${poem.description}`,
    `主題：${poem.theme}`,
    ...(teachingNotes[poem.id] ? [`字詞教學參考：${teachingNotes[poem.id]}`] : []),
    ...lines
  ].join('\n');
}

function requestPoemText(res, messages, { field, temperature, timeoutMs, maxTokens, stream=false }) {
  const apiKey = process.env.GPT_API_KEY;
  const apiBase = process.env.GPT_API_BASE;
  if (!apiKey || !apiBase) return res.status(500).json({ error: 'GPT API not configured' });

  let url;
  try {
    url = new URL(apiBase);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
  } catch (_) {
    return res.status(500).json({ error: 'Invalid GPT API configuration' });
  }
  const basePath = url.pathname.replace(/\/+$/, '');
  const path = basePath.endsWith('/chat/completions') ? basePath : basePath.endsWith('/v1') ? basePath + '/chat/completions' : basePath + '/v1/chat/completions';
  const streaming=stream===true&&typeof res.chatDelta==='function';
  const payload = JSON.stringify({
    model: 'deepseek-flash',
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: streaming,
    thinking: { type: 'disabled' }
  });

  return new Promise((resolve,reject) => {
    let settled = false;
    let apiReq,apiResponse,drainListener;
    let timer;
    const started=performance.now(),signal=res.chatSignal;
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);res.off?.('close',onClose);if(drainListener)res.off?.('drain',drainListener);};
    const abort=()=>{
      if(settled)return;settled=true;cleanup();apiResponse?.destroy();apiReq?.destroy();
      reject(new DOMException('Chat connection closed','AbortError'));
    };
    const onClose=()=>{if(!res.writableEnded)abort();};
    const finish = (status, body) => {
      if (settled) return;
      settled = true;
      cleanup();
      res.chatTimings={...(res.chatTimings||{}),providerTotalMs:Math.round(performance.now()-started)};
      // SSE has already sent HTTP 200; retain the provider's terminal status
      // separately so research records still distinguish timeout from failure.
      res.chatOutcomeStatus=status;
      try{res.status(status).json(body);resolve();}catch(error){reject(error);}
    };
    const failResponse=message=>{finish(502,{error:message});apiResponse?.destroy();apiReq?.destroy();};
    const firstText=()=>{
      if(res.chatTimings?.providerTtfbMs!==undefined)return;
      const elapsed=Math.round(performance.now()-started);res.chatTimings={providerTtfbMs:elapsed};
      if(!res.headersSent)res.setHeader('Server-Timing','ai_ttfb;dur='+elapsed);
    };
    if(signal?.aborted||res.destroyed){abort();return;}
    signal?.addEventListener('abort',abort,{once:true});res.once?.('close',onClose);
    timer = setTimeout(() => {
      finish(504, { error: 'GPT timeout' });
      apiResponse?.destroy();apiReq?.destroy();
    }, timeoutMs);

    try {
      apiReq = https.request({
        hostname: url.hostname,
        port: url.port || 443,
        path,
        method: 'POST',
        agent:providerAgent,
        headers: {
          'Content-Type': 'application/json',
          Accept:streaming?'text/event-stream':'application/json',
          Authorization: 'Bearer ' + apiKey,
          'Content-Length': Buffer.byteLength(payload)
        }
      }, apiRes => {
        apiResponse=apiRes;
        if(settled){apiRes.destroy();return;}
        if(apiRes.statusCode<200||apiRes.statusCode>=300){failResponse('GPT service unavailable');return;}
        const eventStream=streaming&&String(apiRes.headers?.['content-type']||'').toLowerCase().includes('text/event-stream');
        const chunks = [];
        let bytes = 0,reply='',done=false,finishReason=null;
        const parser=eventStream?createSSEParser(data=>{
          if(settled||done)return;
          if(data.trim()==='[DONE]'){done=true;return;}
          const event=JSON.parse(data);if(event.error)throw new Error('Provider error');
          const choice=event.choices?.find(item=>item.index===0)||event.choices?.[0];if(!choice)return;
          if(choice.finish_reason!=null)finishReason=choice.finish_reason;
          if(choice.delta?.content==null)return;
          if(typeof choice.delta.content!=='string')throw new Error('Invalid content');
          let text=choice.delta.content.replace(/\*/g,'');if(!reply)text=text.trimStart();if(!text)return;
          reply+=text;firstText();
          if(res.chatDelta(text)===false&&typeof apiRes.pause==='function'&&typeof res.once==='function'&&!drainListener){
            apiRes.pause();drainListener=()=>{drainListener=null;if(!settled)apiRes.resume();};res.once('drain',drainListener);
          }
        }):null;
        apiRes.on('data', chunk => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > 512 * 1024) {
            failResponse('GPT response too large');
            return;
          }
          if(parser){try{parser.push(chunk);}catch{failResponse('Invalid GPT stream');}}
          else chunks.push(chunk);
        });
        apiRes.on('end', () => {
          if (settled) return;
          try {
            if(parser){
              parser.finish();
              if((!done&&finishReason!=='stop')||finishReason&&finishReason!=='stop'||!reply.trim())throw new Error('Incomplete stream');
              finish(200,{[field]:reply.trim()});return;
            }
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const content = data.choices?.[0]?.message?.content;
            const text = typeof content === 'string' ? content.replace(/\*/g, '').trim() : '';
            if (!text || data.error || streaming&&data.choices?.[0]?.finish_reason==='length') throw new Error();
            firstText();
            finish(200, { [field]: text });
          } catch (_) {
            finish(502, { error: 'Invalid or empty GPT response' });
          }
        });
        apiRes.on('aborted', () => finish(502, { error: 'GPT response interrupted' }));
        apiRes.on('error', () => finish(502, { error: 'GPT response failed' }));
      });
      apiReq.on('error', () => finish(502, { error: 'GPT request failed' }));
      apiReq.end(payload);
    } catch (_) {
      finish(502, { error: 'GPT request failed' });
      if (apiReq) apiReq.destroy();
    }
  });
}

module.exports = { getPoem, poemContext, requestPoemText };
