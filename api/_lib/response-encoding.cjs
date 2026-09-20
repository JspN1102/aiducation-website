'use strict';
const TEACHER_ROUTES=new Set(['teacher-analytics','teacher-tools']);
function acceptsGzip(header){
  if(typeof header!=='string'||!header.trim())return false;
  let gzip=null,wildcard=null;
  for(const entry of header.toLowerCase().split(',')){
    const [coding,...parameters]=entry.split(';').map(value=>value.trim());
    if(coding!=='gzip'&&coding!=='*')continue;
    const quality=parameters.find(value=>/^q\s*=/.test(value));
    const raw=quality?.split('=')[1]?.trim();
    const q=raw===undefined?1:/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw)?Number(raw):0;
    if(coding==='gzip')gzip=gzip===null?q:Math.min(gzip,q);
    else wildcard=wildcard===null?q:Math.min(wildcard,q);
  }
  return (gzip??wildcard??0)>0;
}
function varyAcceptEncoding(value){
  const fields=(Array.isArray(value)?value.join(','):String(value||'')).split(',').map(item=>item.trim()).filter(Boolean);
  if(!fields.some(item=>item==='*'||item.toLowerCase()==='accept-encoding'))fields.push('Accept-Encoding');
  return fields.join(', ');
}
module.exports={TEACHER_ROUTES,acceptsGzip,varyAcceptEncoding};
