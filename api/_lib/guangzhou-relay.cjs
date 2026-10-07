'use strict';
// The public school site relays its fixed APIs through SSH to the existing
// loopback-only Guangzhou service. No database port or public origin is opened.
const http=require('node:http');
const https=require('node:https');
const net=require('node:net');
const {createHash,createHmac,timingSafeEqual}=require('node:crypto');
const {Duplex}=require('node:stream');
const {Client}=require('ssh2');
const {TEACHER_ROUTES,acceptsGzip}=require('./response-encoding.cjs');
const LIMITS=Object.freeze({soe:4*1024*1024,tts:65536,'maanshan-chat':131072,'maanshan-report':524288,'maanshan-save':393216,'maanshan-data':1024,handwriting:524288,'school-auth':16384,'school-recordings':1400000,'research-events':131072,'teacher-analytics':1024,'challenge-result':16384,'teacher-tools':16384,'speech-to-text':4*1024*1024});
const HOP=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
const RESPONSE_LIMIT=4*1024*1024+65536;
const AUTH_DIAGNOSTIC_CODES=new Set(['TERMS_REQUIRED','TERMS_VERSION_CHANGED','INVALID_REQUEST','ORIGIN_REJECTED','INVALID_CREDENTIALS','LOGIN_THROTTLED','AUTH_DISABLED','AUTH_UNAVAILABLE','AUTH_REQUIRED','ACCOUNT_CHANGED','CSRF_REJECTED']);
function logAuthFailure(status,result,input){
 if(!Number.isInteger(status)||status<400||status>599)return;
 let code='UNRECOGNIZED_CODE';
 try{
  const data=JSON.parse(result.toString('utf8'));
  if(AUTH_DIAGNOSTIC_CODES.has(data?.code))code=data.code;
  else if(data?.error==='Invalid JSON body')code='INVALID_JSON_BODY';
  else if(data?.error==='Request interrupted')code='REQUEST_INTERRUPTED';
 }catch{code='NON_JSON_RESPONSE';}
 const entry={event:'school_auth_upstream_error',status,code};
 if(code==='INVALID_REQUEST'){
  entry.bodyKind=input===undefined?'undefined':input===null?'null':Buffer.isBuffer(input)?'buffer':Array.isArray(input)?'array':typeof input==='object'?'object':typeof input==='string'?'string':'other';
  const fields=input!==null&&typeof input==='object'&&!Buffer.isBuffer(input)&&!Array.isArray(input)?input:null;
  entry.fields=Object.fromEntries(['action','login','password','termsAccepted','termsVersion'].map(key=>[key,!!fields&&Object.hasOwn(fields,key)]));
 }
 // Only fixed labels, status, and presence flags reach logs; never payloads or headers.
 console.warn(JSON.stringify(entry));
}
// The loopback HTTP server closes idle sockets after 95 seconds (older releases:
// 65) and says so in its Keep-Alive header. Expire ten seconds before whichever
// deadline the origin advertises, including after a suspended serverless
// instance resumes without firing timers. The once-a-minute keep-warm request
// therefore keeps one channel open, and a pupil's first request after a quiet
// spell skips the fresh SSH channel round trip.
const CHANNEL_IDLE_MS=85000,CHANNEL_DEADLINE_MARGIN_MS=10000;
// Opening a channel normally takes one round trip (well under two seconds even
// when many open at once). Longer silence means the session is gone.
const CHANNEL_OPEN_TIMEOUT_MS=5000;
class ChannelAgent extends http.Agent{
 constructor(client,now,openTimeoutMs=CHANNEL_OPEN_TIMEOUT_MS){
  super({keepAlive:true,maxSockets:16,maxTotalSockets:16,maxFreeSockets:4,scheduling:'lifo'});
  this.client=client;this.now=now;this.openTimeoutMs=openTimeoutMs;this.idle=new Map();this.closed=false;
 }
 createConnection(options,callback){
  // A request still queued when its session was given up: no bytes left, so the
  // relay may reconnect once, exactly as for a dead session.
  if(this.closed){queueMicrotask(()=>callback(Object.assign(new Error('RELAY_CLOSED'),{sessionDead:true})));return;}
  // A suspended serverless instance resumes holding an SSH session that the
  // server may have closed meanwhile, or whose network path silently went
  // away. Opening the channel is the first round trip on it: a synchronous
  // throw, an error or a long silence all mean the session is dead. Report
  // that before any HTTP bytes exist so the relay can reconnect once safely.
  // An open failure answered by the server (it carries a reason) means the
  // session is alive but the origin refused; everything else marks it dead.
  let settled=false;
  const settle=(error,socket)=>{if(settled){socket?.destroy();return;}settled=true;clearTimeout(timer);if(error&&error.reason===undefined)error.sessionDead=true;callback(error,socket);};
  const timer=setTimeout(()=>{settle(new Error('CHANNEL_OPEN_TIMEOUT'));this.client.destroy();},this.openTimeoutMs);timer.unref?.();
  try{
   // The destination port is the request's own, so the pool keeps channels per port.
   this.client.forwardOut('127.0.0.1',0,'127.0.0.1',options.port,(error,stream)=>{
    if(error){settle(error);return;}
    if(this.closed||settled){stream.destroy();settle(new Error('RELAY_CLOSED'));return;}
    // ssh2 channels lack Socket ref/unref and synchronous destroyed semantics.
    // A Duplex wrapper supplies reliable abort/close handling for the HTTP pool.
    const socket=Duplex.from({readable:stream,writable:stream});
    socket.ref=socket.unref=()=>socket;
    socket.on('error',()=>{});
    socket.once('close',()=>this.clearIdle(socket));
    settle(null,socket);
   });
  }catch(error){settle(error);}
 }
 clearIdle(socket){const idle=this.idle.get(socket);if(idle){clearTimeout(idle.timer);this.idle.delete(socket);}}
 keepSocketAlive(socket){
  if(this.closed||socket.destroyed)return false;
  let lifetime=CHANNEL_IDLE_MS;
  const hint=/(?:^|,)\s*timeout=(\d+)/i.exec(String(socket._httpMessage?.res?.headers['keep-alive']||''));
  if(hint)lifetime=Math.min(lifetime,Number(hint[1])*1000-CHANNEL_DEADLINE_MARGIN_MS);
  if(lifetime<=0)return false;
  this.clearIdle(socket);
  const timer=setTimeout(()=>{this.clearIdle(socket);socket.destroy();},lifetime);timer.unref?.();
  this.idle.set(socket,{timer,expiresAt:this.now()+lifetime});return true;
 }
 addRequest(req,options){
  for(const [name,sockets]of Object.entries(this.freeSockets)){
   this.freeSockets[name]=sockets.filter(socket=>{
    const expiry=this.idle.get(socket)?.expiresAt;
    if(this.closed||socket.destroyed||!expiry||expiry<=this.now()){
     this.clearIdle(socket);socket.destroy();return false;
    }
    return true;
   });
   if(!this.freeSockets[name].length)delete this.freeSockets[name];
  }
  super.addRequest(req,options);
 }
 reuseSocket(socket,req){this.clearIdle(socket);super.reuseSocket(socket,req);}
 destroy(){this.closed=true;for(const socket of this.idle.keys())this.clearIdle(socket);super.destroy();}
}
function configuration(env){
 const host=env.GUANGZHOU_RELAY_HOST,username=env.GUANGZHOU_RELAY_USERNAME,privateKey=env.GUANGZHOU_RELAY_PRIVATE_KEY,hostHash=env.GUANGZHOU_RELAY_HOST_SHA256,port=Number(env.GUANGZHOU_RELAY_PORT||22);
 if(host!=='134.175.149.14'||username!=='maanshan-relay'||typeof privateKey!=='string'||!privateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')||privateKey.length>8192||!/^([a-f0-9]{64})$/.test(hostHash||''))throw new Error('RELAY_NOT_CONFIGURED');
 if(![22,2222].includes(port))throw new Error('RELAY_NOT_CONFIGURED');
 return {host,port,username,privateKey,hostHash};
}
// Guangzhou keeps reverse SSH tunnels open to this Hong Kong relay (Hong Kong
// cannot open connections into the mainland): Hong Kong's loopback 3100, 3101
// and 3102 each lead to the same application through their own tunnel. The
// Pacific leg then ends in Hong Kong at megabytes a second and only a 9 ms hop
// crosses the border; the direct route carried 25-50 KB/s and timed out scoring
// uploads. Same account and key, its own pinned host key.
// Requests take the ports in turn. A port that refuses a channel, or drops a
// fresh one before answering on a session that is still alive, rests for 10 s
// and the next port is tried on the same session. A port other requests rested
// is still tried before giving up, so only this request's own refusals on every
// port mean the tunnels are down. After a quiet spell a session first takes the
// port it used last, whose channel the keep-warm request keeps open.
// Full mode: any failure before a request is sent falls back to the direct
// route. Hong Kong rests 15 s after its tunnels were all down, and after an SSH
// connect or handshake failure 30 s, doubling up to 5 min.
// hk-primary mode (the hkg1 function) has no direct route: the same failures
// open a flat 10 s breaker and the request hops to the iad1 sibling function.
// GUANGZHOU_RELAY_HONG_KONG=off keeps every request off Hong Kong (hkg1: every
// request hops; iad1: the direct route).
const HONG_KONG=Object.freeze({host:'43.161.201.12',port:2222,hostHash:'c39e25fba8c733ecc6398a860909e152a147e871b7a756a9d333d460a69c2b03',ports:Object.freeze([3100,3101,3102])});
const DIRECT_PORTS=Object.freeze([3100]);
const HONG_KONG_RETRY_MS=30000,HONG_KONG_RETRY_MAX_MS=5*60000,HONG_KONG_TUNNEL_PAUSE_MS=15000,HONG_KONG_BREAKER_MS=10000,PORT_DOWN_MS=10000,QUIET_MS=20000;
// Inside Hong Kong a handshake takes tens of milliseconds, so the hkg1 function
// gives up early and hops instead of spending the pupil's wait.
const READY_TIMEOUT_MS=4500,PRIMARY_READY_TIMEOUT_MS=2500,PRIMARY_CHANNEL_OPEN_TIMEOUT_MS=2000;
const MODES=new Set(['full','hk-primary']);
// A whole class reading at once used to share one SSH session, which is one TCP
// flow across the Pacific: every upload queued behind every other one and
// scores timed out although Guangzhou answered within five seconds. Spread the
// load over several sessions (several flows), and keep the bulky background
// uploads (recordings, research events, saves) off the sessions that carry the
// scoring, speech and chat requests a pupil is waiting for.
const BACKGROUND_ROUTES=new Set(['school-recordings','research-events','maanshan-save']);
const LANE_SESSIONS=Object.freeze({interactive:3,background:2});
// A session carrying fewer requests than this is shared before another opens.
const SESSION_SHARE_LIMIT=2;
const FORWARDED_HEADERS=['origin','cookie','content-type','x-csrf-token','x-learning-epoch','sec-fetch-site','accept','user-agent','if-none-match','range'];
// The hkg1 function signs every hop to its iad1 sibling with a key derived from
// the relay key both share. The sibling accepts only a fresh signature for the
// same route and method, so no caller can pick its route or recorded address.
const SIBLING_PATH='/api/school-gateway-us/',HOP_REASONS=new Set(['connect','tunnel','breaker','off','retry']),HOP_WINDOW_SECONDS=120;
// Deployment Protection guards a deployment's own address (VERCEL_URL) unless
// the automation bypass secret goes along; the production domain stays public.
const PRODUCTION_HOST='mandarin.aiducation.asia';
// The sibling marks its own answers, so a platform page (a protection login, a
// missing function) or a rejected hop never reaches a pupil as if it were one.
const SIBLING_MARK='x-school-sibling';
// The platform's own headers on the sibling's response are not the origin's.
const SIBLING_HEADERS=/^(?:x-vercel-|x-matched-path$|server$|strict-transport-security$|age$|x-school-sibling$)/;
// Platform-reserved query parameters (bypass and share cookies) are never sent on.
const RESERVED_QUERY=/^(?:x-vercel-|_vercel|__school_route$)/i;
const SLOW_MS=5000;
const hopKey=privateKey=>createHash('sha256').update('maanshan-school-hop-v1\n'+privateKey).digest();
const hopMac=(key,ts,reason,ip,name,method)=>createHmac('sha256',key).update(['v1',ts,reason,ip,name,method].join('|')).digest('base64url');
const signHop=(key,ts,reason,ip,name,method)=>['v1',ts,reason,Buffer.from(ip).toString('base64url'),hopMac(key,ts,reason,ip,name,method)].join('.');
function verifyHop(key,value,name,method,nowSeconds){
 const parts=typeof value==='string'?value.split('.'):[];
 if(parts.length!==5||parts[0]!=='v1'||!/^\d{1,12}$/.test(parts[1])||!HOP_REASONS.has(parts[2])||!/^[\w-]{0,64}$/.test(parts[3])||!/^[\w-]{43}$/.test(parts[4]))return {error:'format'};
 const ip=Buffer.from(parts[3],'base64url').toString('utf8');
 if(ip&&!net.isIP(ip))return {error:'format'};
 const expected=Buffer.from(hopMac(key,parts[1],parts[2],ip,name,method),'base64url'),given=Buffer.from(parts[4],'base64url');
 if(given.length!==expected.length||!timingSafeEqual(given,expected))return {error:'signature'};
 if(Math.abs(nowSeconds-Number(parts[1]))>HOP_WINDOW_SECONDS)return {error:'expired'};
 return {reason:parts[2],ip};
}
const requestSibling=(url,options,callback)=>https.request(url,options,callback);
// Fluid compute packs concurrent requests into one instance: two classes reading
// at once must queue on the sessions, not be refused as busy.
const MAX_ACTIVE=96;
function createRelay({env=process.env,mode='full',clientFactory=()=>new Client(),request=http.request,hopRequest=requestSibling,now=Date.now,timeoutMs=55000,channelOpenTimeoutMs=mode==='hk-primary'?PRIMARY_CHANNEL_OPEN_TIMEOUT_MS:CHANNEL_OPEN_TIMEOUT_MS,hongKongReadyTimeoutMs=mode==='hk-primary'?PRIMARY_READY_TIMEOUT_MS:READY_TIMEOUT_MS,laneSessions=LANE_SESSIONS,maxActive=MAX_ACTIVE,log=line=>console.log(line)}={}){
 if(!MODES.has(mode))throw new Error('RELAY_MODE');
 const primary=mode==='hk-primary';
 let active=0,turn=0,hopSecret,hopPool;
 const secret=()=>hopSecret||(hopSecret=hopKey(configuration(env).privateKey));
 // Every active request may be hopping at once, so none waits for a free socket.
 const hopAgent=()=>hopPool||(hopPool=new https.Agent({keepAlive:true,maxSockets:maxActive,maxFreeSockets:8,timeout:10000}));
 const hopTarget=()=>{
  const deployment=String(env.VERCEL_URL||''),bypass=String(env.VERCEL_AUTOMATION_BYPASS_SECRET||''),named=/^[a-z0-9.-]{1,253}$/i.test(deployment);
  if(named&&/^[!-~]{8,256}$/.test(bypass))return {host:deployment,bypass};
  if(env.VERCEL_ENV==='production')return {host:PRODUCTION_HOST};
  if(named)return {host:deployment};
 };
 const hongKongEnabled=String(env.GUANGZHOU_RELAY_HONG_KONG||'').toLowerCase()!=='off';
 let hongKongFailures=0,hongKongRetryAt=0;
 const hongKongReady=()=>hongKongEnabled&&now()>=hongKongRetryAt;
 // Only fixed labels reach the logs, once per pause.
 const hongKongFailed=reason=>{
  if(now()<hongKongRetryAt)return;
  const pause=primary?HONG_KONG_BREAKER_MS:reason==='HONG_KONG_TUNNEL_DOWN'?HONG_KONG_TUNNEL_PAUSE_MS:Math.min(HONG_KONG_RETRY_MAX_MS,HONG_KONG_RETRY_MS*2**hongKongFailures++);
  hongKongRetryAt=now()+pause;
  console.warn(JSON.stringify({event:'school_relay_route',route:primary?'iad1':'guangzhou',reason,pauseSeconds:pause/1000}));
 };
 const portDown=new Map();
 const markDown=(port,reason)=>{const up=!(portDown.get(port)>now());portDown.set(port,now()+PORT_DOWN_MS);if(up)console.warn(JSON.stringify({event:'school_relay_port',port,reason,pauseSeconds:PORT_DOWN_MS/1000}));};
 // Sessions that ended or were given up. Their channels close with them, which
 // says nothing about the tunnel behind each port.
 const gone=new WeakSet(),lastPort=new WeakMap();
 // The next Hong Kong port in turn that this request has not tried and that is
 // not resting; failing that, the untried port whose rest ends first.
 const pickPort=(hongKong,tried,client)=>{
  if(!hongKong)return DIRECT_PORTS.find(port=>!tried.has('gz:'+port));
  const usable=port=>!tried.has('hk:'+port)&&!(portDown.get(port)>now()),last=lastPort.get(client);
  if(last&&now()-last.at>QUIET_MS&&usable(last.port))return last.port;
  let resting;
  for(let i=0;i<HONG_KONG.ports.length;i++){
   const index=(turn+i)%HONG_KONG.ports.length,port=HONG_KONG.ports[index];
   if(tried.has('hk:'+port))continue;
   if(portDown.get(port)>now()){if(resting===undefined||portDown.get(port)<portDown.get(resting))resting=port;continue;}
   turn=index+1;return port;
  }
  return resting;
 };
 const routeOf=new WeakMap();
 const slot=()=>({pending:null,pendingClient:null,connection:null,lastUsed:0,active:0});
 const lanes={interactive:Array.from({length:Math.max(1,laneSessions.interactive|0)},slot),background:Array.from({length:Math.max(1,laneSessions.background|0)},slot)};
 const slots=[...lanes.interactive,...lanes.background];
 const agents=new Map();
 const disposeAgent=client=>{const agent=agents.get(client);if(agent){agents.delete(client);agent.destroy();}};
 const agentFor=client=>{if(!agents.has(client))agents.set(client,new ChannelAgent(client,now,channelOpenTimeoutMs));return agents.get(client);};
 // Forget a session whose first round trip failed, so that no later request
 // (including a concurrent one that shares it) is offered the same dead client.
 const discard=client=>{gone.add(client);disposeAgent(client);for(const s of slots){if(s.connection===client)s.connection=null;if(s.pendingClient===client){s.pending=null;s.pendingClient=null;}}client.destroy();};
 // Least-loaded live session first; open another only when every live one is busy.
 // A hop prefers sessions on the direct route.
 function choose(lane,avoidHongKong){
  const all=lanes[lane],direct=avoidHongKong?all.filter(s=>routeOf.get(s.pendingClient||s.connection)!=='hongkong'):all,pool=direct.length?direct:all;
  const live=pool.filter(s=>s.connection||s.pending).sort((a,b)=>a.active-b.active);
  if(live.length&&live[0].active<SESSION_SHARE_LIMIT)return live[0];
  return pool.find(s=>!s.connection&&!s.pending)||live[0];
 }
 async function tunnel(s,route='direct',avoidHongKong=false){
  // A child can listen or write for several minutes between calls. Keep the
  // verified SSH session across those pauses (the relay sshd tolerates about
  // ten minutes of silence); transport errors/close still invalidate it
  // immediately, dead sessions are detected on use, and no forwarded POST is
  // ever replayed.
  // A session left on the direct route moves back to Hong Kong once it is idle
  // and Hong Kong may be tried again (and an idle Hong Kong one is replaced
  // for a hop).
  const upgrade=route==='hongkong'&&s.connection&&routeOf.get(s.connection)!=='hongkong';
  const downgrade=avoidHongKong&&s.connection&&routeOf.get(s.connection)==='hongkong';
  if(s.connection&&(now()-s.lastUsed>240000||upgrade||downgrade)&&s.active<=1){gone.add(s.connection);disposeAgent(s.connection);s.connection.end();s.connection=null;s.pending=null;s.pendingClient=null;}
  s.lastUsed=now();
  if(s.pending)return s.pending;
  const config=configuration(env),client=clientFactory();
  const target=route==='hongkong'?HONG_KONG:{host:config.host,port:route==='alternate'?(config.port===2222?22:2222):config.port,hostHash:config.hostHash};
  routeOf.set(client,route==='hongkong'?'hongkong':'guangzhou');
  s.pendingClient=client;
  s.pending=new Promise((resolve,reject)=>{
   let ready=false,tcpConnected=false,handshakeComplete=false;
   client.once('connect',()=>{tcpConnected=true;client.setNoDelay?.(true);});
   client.once('handshake',()=>{handshakeComplete=true;});
   const clear=()=>{gone.add(client);disposeAgent(client);if(s.connection===client)s.connection=null;if(s.pendingClient===client){s.pending=null;s.pendingClient=null;}};
   client.once('ready',()=>{ready=true;if(route==='hongkong')hongKongFailures=0;s.connection=client;resolve(client);});
   // The peer closing its side ends the writable socket before 'close' fires;
   // forget the session at once so nothing tries to open a channel on it.
   client.once('end',()=>{clear();});
   client.on('error',error=>{clear();if(!ready){const code=typeof error?.code==='string'&&/^[A-Z0-9_]+$/.test(error.code)?error.code:'SSH_CONNECT_ERROR';console.error('Guangzhou relay transport:',code,error?.level==='client-timeout'?'HANDSHAKE_TIMEOUT':'CONNECT_FAILED',JSON.stringify({tcpConnected,handshakeComplete,route:routeOf.get(client)}));reject(Object.assign(new Error('RELAY_CONNECT_FAILED'),{route}));}});
   client.once('close',()=>{clear();if(!ready)reject(Object.assign(new Error('RELAY_CONNECT_FAILED'),{route}));});
   // Offer the key straight away: the relay account accepts nothing else, and
   // the default 'none' probe costs a Pacific round trip on every new session.
   client.connect({host:target.host,port:target.port,username:config.username,privateKey:config.privateKey,authHandler:['publickey'],hostHash:'sha256',hostVerifier:hash=>hash===target.hostHash,readyTimeout:route==='hongkong'?hongKongReadyTimeoutMs:READY_TIMEOUT_MS,keepaliveInterval:15000,keepaliveCountMax:2,tryKeyboard:false});
  });
  try{return await s.pending;}catch(error){if(s.pendingClient===client){s.pending=null;s.pendingClient=null;}client.destroy();throw error;}
 }
 function fail(res,status,code){if(res.writableEnded||res.destroyed)return;if(res.headersSent){res.destroy();return;}res.statusCode=status;res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({ok:false,code,error:'服務暫時未能連線，請稍後再試。'}));}
 async function relay(name,req,res,{acceptHop=false}={}){
  if(acceptHop)res.setHeader(SIBLING_MARK,'1');
  if(!Object.hasOwn(LIMITS,name))return fail(res,404,'NOT_FOUND');
  if(!['GET','POST','HEAD','OPTIONS'].includes(req.method))return fail(res,405,'METHOD_NOT_ALLOWED');
  let url,body;
  try{
   url=new URL(req.url,'https://mandarin.aiducation.asia');
   if(url.pathname!=='/api/'+name&&url.pathname!=='/api/'+name+'/')return fail(res,400,'INVALID_RELAY_PATH');
   if(url.search.length>8192)return fail(res,413,'REQUEST_TOO_LARGE');
   body=['GET','HEAD'].includes(req.method)?null:Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body??{}));
   if(body&&body.length>LIMITS[name])return fail(res,413,'REQUEST_TOO_LARGE');
  }catch{return fail(res,400,'INVALID_REQUEST');}
  // Only the iad1 sibling reads a hop note, and only a fresh signed one; any
  // other copy of the header is ignored and never forwarded.
  let arrived=null;
  if(acceptHop&&req.headers?.['x-school-hop']!==undefined){
   let checked;
   try{checked=verifyHop(secret(),req.headers['x-school-hop'],name,req.method,Math.floor(now()/1000));}catch{return fail(res,503,'ORIGIN_UNAVAILABLE');}
   if(checked.error){
    console.warn(JSON.stringify({event:'school_relay_hop_rejected',route:name,reason:checked.error}));
    res.statusCode=403;res.setHeader(SIBLING_MARK,'rejected');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/json; charset=utf-8');return res.end('{"ok":false,"code":"BAD_HOP"}');
   }
   arrived=checked;
  }
  const lane=BACKGROUND_ROUTES.has(name)?'background':'interactive';
  // Only these may be sent again after a channel opened (once, on another
  // port, while no response has begun). Scoring, speech, chat, synthesis and
  // every other POST never are, nor a hop after hkg1 already sent it twice.
  const idempotent=(req.method==='GET'||req.method==='HEAD'||BACKGROUND_ROUTES.has(name))&&arrived?.reason!=='retry';
  // Every hop goes direct: Hong Kong is 2 ms from hkg1 and 212 ms from here, so
  // whatever made hkg1 give up on it would only cost this request more time.
  const avoidHongKong=!!arrived;
  // Vercel supplies this client address; never trust caller-provided X-Real-IP.
  // A verified hop carries the address the hkg1 function saw.
  const raw=String(req.headers?.['x-vercel-forwarded-for']||req.socket?.remoteAddress||'').split(',')[0].trim();
  const clientIp=arrived?arrived.ip:net.isIP(raw)?raw:'';
  let upstream,channel,timer,done=false,responseComplete=false,client,hongKong=false,port=null,via=null,code=null,hopped=null,reconnected=false,rerouted=false,replayed=false,bytes=0;
  const tried=new Set(),startedAt=now();let connectedAt=startedAt,channelAt=startedAt,headersAt=0;
  // One line per slow or failed request: fixed labels, timings and sizes only.
  const report=()=>{
   const ended=now(),totalMs=ended-startedAt,status=res.headersSent?res.statusCode:0,span=(from,to)=>Math.max(0,to-from);
   if(totalMs<=SLOW_MS&&status<500)return;
   log(JSON.stringify({event:'school_relay_slow',route:name,via,port,lane,status,code,retried:replayed,hop:hopped||arrived?.reason||null,connectMs:span(startedAt,connectedAt),channelMs:span(connectedAt,channelAt),originMs:span(channelAt,headersAt||ended),totalMs,bytes,region:env.VERCEL_REGION||process.env.VERCEL_REGION||null}));
  };
  if(active>=maxActive){code='SERVICE_BUSY';fail(res,503,code);report();return;}
  const session=choose(lane,avoidHongKong);
  active++;session.active++;
  const close=()=>{upstream?.destroy();channel?.destroy();};
  const disconnected=()=>{if(!res.writableEnded){done=true;close();}};
  res.once('close',disconnected);
  try{
   await new Promise(resolve=>{
    let settled=false;const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve();};
    const error=(status,failure)=>{if(done){finish();return;}done=true;code=failure;close();fail(res,status,failure);finish();};
    timer=setTimeout(()=>error(504,'ORIGIN_TIMEOUT'),timeoutMs);timer.unref?.();
    res.once('close',finish);
    const gzipAllowed=TEACHER_ROUTES.has(name)&&acceptsGzip(req.headers?.['accept-encoding']);
    const forwarded={'accept-encoding':gzipAllowed?'gzip':'identity'};
    for(const key of FORWARDED_HEADERS)if(typeof req.headers?.[key]==='string')forwarded[key]=req.headers[key];
    if(body)forwarded['content-length']=String(body.length);
    const onResponse=(response,attempt,sibling)=>{
     if(done||attempt.stale){response.destroy();return;}
     // An unmarked answer did not come from the sibling (none of its headers,
     // cookies or redirects are relayed); a rejected hop is no pupil's fault.
     if(sibling&&response.headers[SIBLING_MARK]!=='1'){
      attempt.stale=true;const rejected=response.headers[SIBLING_MARK]==='rejected';response.destroy();
      console.warn(JSON.stringify({event:'school_relay_hop_failed',route:name,reason:rejected?'rejected':'platform',status:response.statusCode||0}));
      error(503,'ORIGIN_UNAVAILABLE');return;
     }
     attempt.response=true;headersAt=now();
     const encoding=String(response.headers['content-encoding']||'identity').toLowerCase().trim();
     if(TEACHER_ROUTES.has(name)&&encoding!=='identity'&&(encoding!=='gzip'||!gzipAllowed)){response.destroy();error(502,'ORIGIN_ENCODING_UNSUPPORTED');return;}
     const streaming=name==='maanshan-chat'&&/^text\/event-stream(?:;|$)/i.test(String(response.headers['content-type']||''))&&String(req.headers?.accept||'').includes('text/event-stream');
     const chunks=[];let size=0;
     const copyHeaders=()=>{
      res.statusCode=response.statusCode||502;
      const hopByHop=new Set([...HOP,...String(response.headers.connection||'').toLowerCase().split(',').map(x=>x.trim())]);
      for(const [key,value]of Object.entries(response.headers))if(value!==undefined&&!hopByHop.has(key)&&key!=='content-length'&&!(sibling&&SIBLING_HEADERS.test(key)))res.setHeader(key,value);
      res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');
      const duration=(from,to)=>Math.max(0,to-from).toFixed(1);
      const originTiming=typeof response.headers['server-timing']==='string'?response.headers['server-timing']+', ':'';
      // A hop keeps the sibling's own route, port and timings.
      if(sibling){res.setHeader('X-Relay-Hop','iad1');res.setHeader('Server-Timing',originTiming+'relay_hop_wait;dur='+duration(startedAt,channelAt)+', relay_hop;dur='+duration(channelAt,now()));return;}
      res.setHeader('X-Relay-Route',via);res.setHeader('X-Relay-Port',String(attempt.port));
      res.setHeader('Server-Timing',originTiming+'relay_connect;dur='+duration(startedAt,connectedAt)+', relay_channel;dur='+duration(connectedAt,channelAt)+', relay_origin;dur='+duration(channelAt,now()));
     };
     if(streaming){copyHeaders();res.setHeader('X-Accel-Buffering','no');res.flushHeaders?.();}
     response.on('error',()=>error(502,'ORIGIN_INTERRUPTED'));
     response.on('aborted',()=>error(502,'ORIGIN_INTERRUPTED'));
     response.on('data',chunk=>{
      if(done)return;
      size+=chunk.length;bytes=size;
      if(size>RESPONSE_LIMIT){error(502,'ORIGIN_RESPONSE_TOO_LARGE');response.destroy();}
      else if(streaming){if(!res.write(chunk)){response.pause();res.once('drain',()=>{if(!done)response.resume();});}}
      else chunks.push(chunk);
     });
     response.on('end',()=>{
      if(done){finish();return;}
      responseComplete=true;
      done=true;
      if(!res.writableEnded&&!res.destroyed){
       if(streaming){res.end();finish();return;}
       copyHeaders();
       const result=Buffer.concat(chunks);
       // The sibling already logged its own diagnostics.
       if(name==='school-auth'&&!sibling)logAuthFailure(response.statusCode,result,req.body);
       if(req.method!=='HEAD')res.setHeader('Content-Length',result.length);
       else if(/^\d+$/.test(String(response.headers['content-length']||'')))res.setHeader('Content-Length',response.headers['content-length']);
       res.end(req.method==='HEAD'?undefined:result);
      }
      finish();
     });
    };
    const send=next=>{
     if(done||res.destroyed){finish();return;}
     const attempt={port:next,client,stale:false,socket:false,response:false};
     port=next;via=hongKong?'hk':'gz';tried.add(via+':'+next);channel=undefined;
     if(hongKong)lastPort.set(client,{port:next,at:now()});
     const headers={host:'mandarin.aiducation.asia',...forwarded,'x-forwarded-proto':'https','x-school-relay':(arrived?'hop-':'')+via+':'+next};
     if(clientIp)headers['x-real-ip']=clientIp;
     let sent;
     try{sent=upstream=request({host:'127.0.0.1',port:next,method:req.method,path:'/api/'+name+url.search,headers,agent:agentFor(client)},response=>onResponse(response,attempt,false));}
     catch{error(503,'ORIGIN_UNAVAILABLE');return;}
     sent.once('socket',socket=>{if(attempt.stale)return;attempt.socket=true;channel=socket;channelAt=now();if(done||res.destroyed){socket.destroy();finish();}});
     sent.on('error',cause=>failed(cause,attempt,sent));
     if(body)sent.write(body);sent.end();
    };
    // Without a channel nothing was written to the origin: a session that died
    // while the instance was idle is replaced once, and a port Hong Kong refused
    // rests while the next one is tried on the same session. After a channel
    // opened the request may have arrived, so only an idempotent request whose
    // response has not begun goes once more, on another port.
    const failed=(cause,attempt,sent)=>{
     if(attempt.stale)return;attempt.stale=true;
     if(done){finish();return;}
     sent.destroy();
     if(!attempt.socket){
      if(cause?.sessionDead===true){
       discard(attempt.client);
       if(!reconnected){reconnected=true;tried.delete(via+':'+attempt.port);proceed();return;}
      }
      else if(cause?.reason!==undefined&&hongKong){markDown(attempt.port,'refused');advance('tunnel');return;}
      if(primary){hongKongFailed('HONG_KONG_CONNECT_FAILED');hop('connect');return;}
      error(503,'ORIGIN_UNAVAILABLE');return;
     }
     if(attempt.response){error(502,'ORIGIN_INTERRUPTED');return;}
     // A fresh channel closed unanswered: that tunnel's listener is gone, unless
     // the whole session went (ssh2 reports that before closing its channels).
     if(hongKong&&!sent.reusedSocket){const lost=attempt.client,lostPort=attempt.port;setImmediate(()=>{if(!gone.has(lost))markDown(lostPort,'closed');});}
     if(idempotent&&!replayed){replayed=true;advance('retry');return;}
     if(primary&&idempotent){hop('retry');return;}
     error(502,'ORIGIN_INTERRUPTED');
    };
    const advance=kind=>{
     if(done||res.destroyed){finish();return;}
     if(!gone.has(client)){const next=pickPort(hongKong,tried,client);if(next===undefined)exhausted(kind);else send(next);return;}
     // The session itself is gone, which says nothing about Hong Kong: replace
     // it once (a retry needs another port, which only Hong Kong has).
     if(!reconnected&&(hongKong||kind!=='retry')){reconnected=true;discard(client);proceed();return;}
     if(primary){hop(kind==='retry'?'retry':'connect');return;}
     if(kind==='retry')error(502,'ORIGIN_INTERRUPTED');else error(503,'ORIGIN_UNAVAILABLE');
    };
    // No port is left that this request has not tried itself. Every Hong Kong
    // port refusing means Guangzhou's tunnels are down: rest Hong Kong, then
    // take the direct route once (full) or hop (hk-primary). A retry with no
    // other port fails honestly.
    const exhausted=kind=>{
     if(hongKong&&kind==='tunnel')hongKongFailed('HONG_KONG_TUNNEL_DOWN');
     if(primary){hop(kind);return;}
     if(hongKong&&kind==='tunnel'&&!rerouted){rerouted=true;discard(client);proceed();return;}
     if(kind==='retry')error(502,'ORIGIN_INTERRUPTED');else error(503,'ORIGIN_UNAVAILABLE');
    };
    // The iad1 sibling still has the direct route. It gets the same method,
    // body and allowed headers, plus the signed reason and client address.
    // The deployment's own address when the bypass secret can go along (same
    // release), else the public production domain, else (a preview without
    // the secret) the deployment's address, which must then be unprotected.
    const hop=(reason,fresh=false)=>{
     if(done||res.destroyed){finish();return;}
     const target=hopTarget();let signature;
     if(!target){console.warn(JSON.stringify({event:'school_relay_hop_failed',route:name,reason:'no_host',status:0}));error(503,'ORIGIN_UNAVAILABLE');return;}
     try{signature=signHop(secret(),Math.floor(now()/1000),reason,clientIp,name,req.method);}
     catch{error(503,'ORIGIN_UNAVAILABLE');return;}
     const attempt={port:null,stale:false,socket:true,response:false};
     hopped=reason;via='iad1';port=null;channel=undefined;channelAt=now();
     const query=new URLSearchParams([['__school_route',name],...[...url.searchParams].filter(([key])=>!RESERVED_QUERY.test(key))]);
     const headers={...forwarded,'x-school-hop':signature};if(target.bypass)headers['x-vercel-protection-bypass']=target.bypass;
     let sent;
     try{sent=upstream=hopRequest('https://'+target.host+SIBLING_PATH+'?'+query,{method:req.method,headers,agent:fresh?false:hopAgent()},response=>onResponse(response,attempt,true));}
     catch{error(503,'ORIGIN_UNAVAILABLE');return;}
     sent.on('error',cause=>{
      if(attempt.stale)return;
      // A kept-alive connection the edge had just closed never carried the
      // request (Node's documented reuse race): send it once on a new one.
      if(!fresh&&!attempt.response&&sent.reusedSocket&&['ECONNRESET','EPIPE'].includes(cause?.code)){attempt.stale=true;sent.destroy();hop(reason,true);return;}
      error(attempt.response?502:503,attempt.response?'ORIGIN_INTERRUPTED':'ORIGIN_UNAVAILABLE');
     });
     if(body)sent.write(body);sent.end();
    };
    // Another handshake is safe before any request reaches the origin.
    // A string result names why the hkg1 function must hop instead.
    const connect=async()=>{
     if(primary){
      if(!hongKongEnabled)return 'off';
      if(!hongKongReady())return 'breaker';
      try{return await tunnel(session,'hongkong');}
      catch(cause){if(cause?.route!=='hongkong')throw cause;hongKongFailed('HONG_KONG_CONNECT_FAILED');return done||res.destroyed?null:'connect';}
     }
     const routes=hongKongReady()&&!avoidHongKong?['hongkong','direct','alternate']:['direct','alternate'];
     for(const route of routes.slice(0,-1)){
      try{return await tunnel(session,route,avoidHongKong);}
      catch(cause){if(cause?.route==='hongkong')hongKongFailed('HONG_KONG_CONNECT_FAILED');if(done||res.destroyed)return null;}
     }
     return tunnel(session,routes.at(-1),avoidHongKong);
    };
    const proceed=async()=>{
     let next;
     try{next=await connect();}catch{error(503,'ORIGIN_UNAVAILABLE');return;}
     if(next===null||done||res.destroyed){finish();return;}
     if(typeof next==='string'){hop(next);return;}
     client=next;hongKong=routeOf.get(client)==='hongkong';connectedAt=now();
     advance('tunnel');
    };
    proceed();
   });
  }finally{clearTimeout(timer);res.off('close',disconnected);if(!responseComplete)close();active--;session.active--;report();}
 }
 return {relay,close(){for(const client of agents.keys()){gone.add(client);disposeAgent(client);}for(const s of slots){const connecting=s.pendingClient;if(connecting){gone.add(connecting);if(connecting!==s.connection)connecting.destroy();}if(s.connection){gone.add(s.connection);s.connection.end();}s.connection=null;s.pending=null;s.pendingClient=null;}hopPool?.destroy();hopPool=undefined;}};
}
// One relay per mode per instance, created on first use.
const relays=new Map();
const relayFor=mode=>{if(!relays.has(mode))relays.set(mode,createRelay({mode}));return relays.get(mode);};
const relay=(name,req,res)=>relayFor('full').relay(name,req,res);
function createGateway(forward=relay){return function gateway(req,res){
 const url=new URL(req.url,'https://mandarin.aiducation.asia');
 const name=req.query?.__school_route||/^\/api\/([a-z-]+)\/?$/.exec(url.pathname)?.[1];
 if(typeof name!=='string'||!Object.hasOwn(LIMITS,name)){
  res.statusCode=404;res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/json');return res.end('{"ok":false,"code":"NOT_FOUND"}');
 }
 const search=url.searchParams;
 search.delete('__school_route');
 req.url='/api/'+name+(search.size?'?'+search.toString():'');
 return forward(name,req,res);
};}
module.exports={LIMITS,BACKGROUND_ROUTES,HONG_KONG,configuration,createRelay,relay,createGateway,gateway:createGateway(),
 // hkg1: Hong Kong only, hopping to the sibling whenever Hong Kong is unusable.
 gatewayHongKong:createGateway((name,req,res)=>relayFor('hk-primary').relay(name,req,res)),
 // iad1 sibling: every route, and it honours signed hops from hkg1.
 gatewayUs:createGateway((name,req,res)=>relayFor('full').relay(name,req,res,{acceptHop:true}))};
