const https = require('https');
const {createSSEParser}=require('./chat-stream.cjs');
const providerAgent=new https.Agent({keepAlive:true,maxSockets:16,maxFreeSockets:4,timeout:30000,scheduling:'lifo'});
const { poems: publicPoems } = require('../../maanshan/poems.json');
// Preview poems are listed separately so dashboards, exports and resource packs
// keep using poems.json alone; school-auth decides who may open them.
const { poems: previewPoems } = require('../../maanshan/poems-preview.json');
const poems = [...publicPoems, ...previewPoems.map(poem => ({ ...poem, preview: true }))];
const teachingNotes = {
  2: '依教育局《積累與感興》〈贈汪倫〉第1–2頁：「將欲」是將要；「踏歌」是一邊用腳打節拍，一邊唱歌。「深千尺」是誇張地形容潭水深，不是測量結果；重點是汪倫送別的情意更深。送別有驚喜、熱情和感動，不必一律講成悲傷。「萬家酒樓／千尺桃花」的邀請故事在材料中明列為傳說，聊到時要先說是傳說，不當作已證史實。',
  3: '依教育局《積累與感興》〈題西林壁〉第1–2頁：「題」是書寫，詩題指在西林寺的牆壁上題詩。「橫看」是從正面看，不是把頭橫過來；「嶺」是相連的山，「峰／峯」是高而陡峭的山，兩種字形在本詩意思相同。「緣」是因為，「真面目」指整體面貌。變的是觀察位置與視野，不是山自己變形；對低小學生用同一物品從正面、側面看作例子，不要求分析抽象哲理。',
  4: '依教育局《積累與感興》〈泊船瓜洲〉第1–2頁：京口與瓜洲隔着長江，鍾山指南京紫金山、王安石的家所在；本詩是離家赴京途中泊船瓜洲、盼望日後回家，不是已經回到家。「綠」作動詞，寫春風使江岸草木變綠；「還」讀 huán，指回到鍾山下的家。「到、過、入、滿」改成「綠」的煉字故事在材料中以「據說」引出，引用時保留這個性質。',
  5: '本平台依教育局《積累與感興——小學古詩文誦讀材料選編（修訂）》〈歸園田居（其三）〉第2頁注釋7：「道狹草木長」的「長」讀 cháng（第二聲）。教學、報告與聊天均依此讀音，不要以「生長」為由教學生改讀 zhǎng。「晨興」是早起，「理荒穢」是清除豆田雜草，「荷」讀 hè、是扛着，「霑」通「沾」。陶潛就是陶淵明。全詩既寫農事辛勞，也寫熱愛田園、堅守心願的滿足，不要只講成受苦或抱怨。',
  6: '依教育局《積累與感興》〈初春小雨〉第1–2頁：本詩是《早春呈水部張十八員外》的第一首，張十八指好友張籍。「天街」是京城街道，「皇都」指長安；「好處」在這裏是最好的時節，不是好地方或利益；「絕勝」是遠遠超過。詩人比較早春與暮春，表達自己更喜愛早春，不是宣告人人必須有同樣喜好。「近卻無」是細小稀疏的草芽近看不呈一片綠，草沒有消失。「酥」指酥油，取其細膩、潤澤比喻初春細雨。「路滑」「踩起來滑」「不泥濘」不是詞義，也不能用這些想像代替解釋。',
  7: '依教育局《積累與感興》〈詠雪〉第1–2頁：鄭燮號板橋，即鄭板橋（「燮」讀 xiè），是清代書畫家、文學家。詩人先數着一片片雪花，再寫大雪紛飛，末句寫無數雪片飛入梅花叢中，瞬間不見；材料以一「奇」字概括：題為《詠雪》卻沒有一個「雪」字，前三句幾乎全用數字而不累贅。材料未標拼音，按普通話讀音：「無數」的「數」讀 shù，指多得數不清，與數雪花動作的 shǔ 不同；「都不見」的「都」讀 dōu，表示全部。拼音按單字本調標 yī、bù，朗讀時「一片」讀 yí piàn、「不見」讀 bú jiàn 是正常變調，不要判錯。雪片為何「不見」，材料沒有說明，可讓學生看畫猜想，不要講成唯一答案。梅花耐寒，能在大雪中盛開，自古象徵堅毅不屈（第2頁），對一年級學生可說成「梅花不怕冷」。鄭板橋冒雪吟出此詩、令刁難他的讀書人甘拜下風的故事，材料以「據說」引出，聊到時要先說明是傳說，不當作已證史實。學生未必見過真雪，可按〈想一想〉第1題請他們說說對雪的聯想。字句以材料「飛入梅花都不見」為準，學生提到別的字句時，說明流傳版本不同即可。',
  8: '依教育局《積累與感興》〈畫雞〉第1–2頁：這是一首題畫詩。作者「唐寅」的「寅」讀 yín。「裁」是剪裁、縫製；「走將來」是走過來，「將」是語助詞，讀 jiāng；「輕言語」是輕易說話，這裏指雞的啼叫。前兩句寫紅冠白羽、紅白照應的外表；後兩句寫雄雞只在早晨報曉，其他時間不胡亂啼叫，牠一啼叫便是東方吐白、新的一天來臨，千萬人家給喚醒。《玄中記》桃都山天雞屬神話，聊到時先說明是神話；材料說雄雞「很可能」是詩人自況，只作一種理解。唐寅只是「牽涉」科場舞弊案，不要說成他作弊；材料以外的唐伯虎民間故事不當作真實經歷。對二年級學生以公雞的樣子和啼叫的作用為主，不要說教。',
  9: '依教育局《積累與感興》〈七步詩〉第1–2頁：本平台依材料作六句本「煮豆持作羹，漉豉以為汁」；「持作羹」一作「燃豆萁」、「豉」一作「菽」（第1頁注釋2、4），朗讀、默書和引用都以材料版本為準，不要改成四句本。「持」是拿來；「羹」在本詩是湯水，不是糊狀，才能濾出豆汁；「漉」讀 lù，是過濾，不要讀成「綠」lǜ；「豉」讀 chǐ，不要依粵音讀成 shì；「萁」讀 qí，是曬乾後作燃料的豆梗；「釜」是古代的煮食用具；「以為汁」的「為」讀 wéi，「相煎」的「相」讀 xiāng，「煎」是煎熬。「泣」是擬人，寫豆在鍋中受萁煎熬，像在哭泣，比喻兄弟相迫；豆和萁同一根上長成，比喻同胞兄弟。曹丕限曹植七步內作詩、不成就殺，聽後深有慚色的故事出自《世說新語》（第1頁背景資料），第2頁亦說明曹植詩集沒有收錄此詩、是否曹植所作許多人表示懷疑；聊到時要說「據《世說新語》記載」或「有一種說法是」，不當作確證史實，也不要細述殺害情節。對低小學生重點放在兄弟姊妹、同學之間要和睦相處（第2頁「想一想」），不追問學生家中私事。',
  10: '依教育局《積累與感興》〈絕句〉第1–3頁：本詩寫於唐代宗廣德二年（764）春天，杜甫在安史之亂時流落成都，在浣花溪畔搭建草堂居住，生活較為安定；本詩是一組四首題為《絕句》的七言絕詩的第三首（第1頁）。第2頁注釋：「黃鸝」即黃鶯，黃羽紅嘴，鳴聲婉轉，「鸝」讀 lí，不要因字中的「麗」讀成 lì；「兩個黃鸝」是一對小黃鸝；「翠柳」是翠綠的柳枝；「白鷺」是白羽長足尖嘴的水鳥，遷徙時列隊群飛，所以「一行」是一列、一排，「行」讀 háng，不讀 xíng；「窗含西嶺千秋雪」表示從窗口可以遠眺西邊的雪山，「含」是容納，「千秋雪」是終年積雪，不是數了一千個秋天，材料沒有說明是哪一座山，不要自行指定；「泊」是停船靠岸，讀 bó，不讀 pō；「東吳」泛指三國時代吳國的屬地，大約相當於今江蘇、浙江兩省東部。詩人不是在門前看見東吳，而是看見草堂附近錦江上停泊着遠航的船隻；當時戰亂平定、交通恢復，詩人開始計劃回歸，想到從這裏乘船沿長江而下就可到達吳地。賞析說全詩用輕快、生動的筆觸描繪春回大地的郊野風光，表現閒適心情：柳樹披上綠裝是春的色彩，黃鸝鳴叫是春天的聲音；從繪畫角度看，西嶺積雪是遠景，江上泊船是中景，白鷺飛翔是中近景，黃鸝鳴柳是近景，有動有靜，有聲有色。全詩兩兩成偶，對仗工整：「兩個」對「一行」、「黃鸝」對「白鷺」、「鳴」對「上」、「翠柳」對「青天」，「窗」對「門」、「含」對「泊」、「西嶺」對「東吳」、「千秋雪」對「萬里船」。基調是閒適、愉快，不要講成悲傷。「詩聖」「詩史」是後世對杜甫的稱號，詩人聊天時不要自稱。可連結第2頁跟進活動（把詩中美景畫出來）和第3頁〈想一想〉：詩中是哪個季節、詩人心情如何，以及學生回校途中所見的景物和心情，談談「情」與「景」的關係。',
  11: '依教育局古詩文誦讀材料〈鄭人買履〉第1–3頁：本篇是寓言，選自《韓非子．外儲說左（上）》，作者韓非是戰國末期思想家、法家主要代表人物（第1頁）。注釋（第1–2頁）：「履」讀 lǚ，是鞋；「且」是將要；「置」先解購買，後解擱在；「先自度其足」的「度」讀 duó，動詞，量度；「吾忘持度」「寧信度」的「度」讀 dù，名詞，量度的尺寸；「操」「持」同義，都是拿取；「罷」是結束；「遂」讀 suì，是於是；「何不試之以足」是「何不以足試之」的倒裝。第2頁語譯「寧信度」為「我寧願相信量度的尺寸」，「寧」讀 nìng。「坐」通「座」，「反」通「返」、讀 fǎn，是古今字，今天書寫不可相混（第2頁）。賞析（第2頁）：故事諷刺做事拘泥固執、不知靈活變通的人；作者沒有直接評價鄭人，而是透過他的言行寫出他迂腐可笑。這是寓言，不是真實歷史，聊天時要說明；韓非遭陷害死於獄中雖見於材料，不宜向小學生渲染。可結合第3頁「想一想」談知所變通。',
  12: '依教育局《積累與感興》〈客至〉第1–3頁：本詩作於761年，杜甫住在成都草堂，很少與人交往。「明府」是唐代對縣令的尊稱；崔明府一說是杜甫母家親戚，一說是舅氏崔頊，兩說並存，不要斷定。「舍」指草堂，讀 shè；「飧」讀 sūn，指熟食，不讀 cān；「舊醅」是不是新釀的酒，「醅」讀 pēi；「肯」是願意；「呼取」的「取」是語助詞，等於「得」。第三、四句「互文見義」：花徑不曾為客掃、蓬門不曾為客開，今天都為崔明府掃徑開門，表示熱烈歡迎。「市遠」「家貧」是坦白說出款待簡樸，既有歉意，也見二人親密無間，不是怠慢客人；「隔籬呼取」鄰翁同飲，寫敦親睦鄰，把氣氛推向高潮。談到飲酒，重點放在待客的熱情與人情味，不要鼓勵學生飲酒。'
};

function getPoem(poemId, defaultId = 2) {
  const id = poemId === undefined ? defaultId : poemId;
  return Number.isInteger(id) ? poems.find(poem => poem.id === id) || null : null;
}

// 戰國 is a period rather than a dynasty, so it is not followed by 代.
function dynastyLabel(poem) {
  return poem.dynasty.endsWith('國') ? poem.dynasty : `${poem.dynasty}代`;
}

function poemContext(poem) {
  const lines = poem.lines.map(line => `${line.text}${line.punctuation || ''} (${line.pinyin.join(' ')})`);
  return [
    `篇目：《${poem.title}》`,
    `作者：${dynastyLabel(poem)}${poem.author}`,
    `作者資料：${poem.authorBio}`,
    `詩意：${poem.description}`,
    `主題：${poem.theme}`,
    ...(teachingNotes[poem.id] ? [`字詞教學參考：${teachingNotes[poem.id]}`] : []),
    ...lines
  ].join('\n');
}

function requestPoemText(res, messages, { field, temperature, timeoutMs, maxTokens, stream=false,providerVersion='poet-report-prompts-20260920' }) {
  const apiKey = process.env.GPT_API_KEY;
  const apiBase = process.env.GPT_API_BASE;
  if (!apiKey || !apiBase) return res.status(500).json({ error: 'GPT API not configured' });
  const model=String(process.env.POET_CHAT_MODEL||'deepseek-flash').trim();
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,79}$/.test(model))return res.status(500).json({error:'Invalid GPT model configuration'});
  res.providerMetadata={provider:'deepseek',model,providerVersion};

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
    model,
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
          if(typeof event.model==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,79}$/.test(event.model))res.providerMetadata.model=event.model;
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
            if(typeof data.model==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,79}$/.test(data.model))res.providerMetadata.model=data.model;
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

module.exports = { catalog: poems, getPoem, dynastyLabel, poemContext, requestPoemText };
