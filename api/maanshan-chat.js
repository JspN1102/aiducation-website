const { getPoem, requestPoemText } = require('./_lib/poems.js');
const {poetSystemPrompt,POET_PROMPT_VERSION,POET_LIVE_VERSION}=require('./_lib/poet-prompt.cjs');
const presetCache=require('./_lib/poet-preset-cache.cjs');
const {withSchoolLearning} = require('./_lib/school-learning.cjs');

module.exports = withSchoolLearning('chat', async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  if (Buffer.byteLength(JSON.stringify(body)) > 64 * 1024) {
    return res.status(413).json({ error: 'Request too large' });
  }
  const poem = getPoem(body.poemId);
  if (!poem) return res.status(400).json({ error: 'Invalid poemId' });
  const suppliedGrade=Number(body.grade);
  const grade=Number.isInteger(suppliedGrade)&&suppliedGrade>=1&&suppliedGrade<=6?Math.min(suppliedGrade,poem.grade):poem.grade;

  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
    return res.status(400).json({ error: 'Expected 1 to 40 messages' });
  }
  let length = 0;
  for (const message of messages) {
    if (!message || !['user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' || !message.content.trim() || message.content.length > 2000) {
      return res.status(400).json({ error: 'Invalid message role or content' });
    }
    length += message.content.length;
  }
  if (length > 20000) return res.status(413).json({ error: 'Conversation too large' });
  if(messages.at(-1).role!=='user')return res.status(400).json({error:'Expected a user question'});

  const preset=await presetCache.matchRequest(body,poem,grade);
  // Kept with the research outcome (school-learning.cjs): the question, how it was entered, the suggestion tapped.
  const asked=messages.at(-1).content.trim().normalize('NFC').slice(0,1000);
  if(asked)res.researchExtras={...(res.researchExtras&&typeof res.researchExtras==='object'?res.researchExtras:{}),chat:{question:asked,
    ...(['typed','voice','suggestion'].includes(body.inputMode)?{inputMode:body.inputMode}:{}),
    ...(typeof body.presetId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(body.presetId)?{presetId:body.presetId}:{})}};
  const prepared=preset?await presetCache.lookup(body,poem,grade):null;
  res.setHeader('X-Poet-Cache',prepared?'HIT':preset?'MISS':'BYPASS');
  if(prepared){
    res.providerMetadata={provider:'aiducation-cache',model:prepared.model,providerVersion:POET_PROMPT_VERSION+'-preset-hit'};
    res.chatOutcomeStatus=200;
    if(res.chatStreaming)res.chatDelta(prepared.reply);
    return res.status(200).json({reply:prepared.reply,responseSource:'preset_cache'});
  }

  const system = poetSystemPrompt(poem, grade, {facts:true});

  return requestPoemText(res, preset?presetCache.preparedMessages(poem,preset,grade):[
    { role: 'system', content: system },
    ...messages.slice(-10).map(({ role, content }) => ({ role, content }))
  ], { field: 'reply', temperature: 0.8, timeoutMs: 20000, maxTokens: grade<=3?450:900, stream:res.chatStreaming===true,providerVersion:preset?POET_PROMPT_VERSION:POET_LIVE_VERSION });
});
