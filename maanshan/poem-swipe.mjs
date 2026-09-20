// Move the current and neighbouring paintings together, then settle one verse.
// Browsing never marks a verse read. Vertical touch gestures remain native.
export function mountPoemSwipe(holder,{onStep,isLocked=()=>false,stage,getAdjacent=()=>({})}={}){
  const events=new AbortController();let start=null,settling=false,disposed=false,generation=0,suppressClickUntil=0;
  holder.tabIndex=0;holder.setAttribute('role','group');
  holder.setAttribute('aria-label','古詩畫卷，左右滑動或按方向鍵選擇詩句');
  const previousTouchAction=holder.style.touchAction;
  holder.style.touchAction='pan-y pinch-zoom';
  function release(point){try{if(point&&holder.hasPointerCapture?.(point.id))holder.releasePointerCapture(point.id);}catch{}}
  function cancel(){const point=start;start=null;settling=false;generation++;release(point);stage?.cancelSwipe();holder.removeAttribute('data-swiping');}
  function move(event){
    if(!start||event.pointerId!==start.id)return;
    if(isLocked()){cancel();return;}
    const dx=event.clientX-start.x,dy=event.clientY-start.y;
    if(!start.horizontal){
      if(Math.abs(dy)>4&&Math.abs(dy)>Math.abs(dx)*1.15){cancel();return;}
      if(Math.abs(dx)<3||Math.abs(dx)<Math.abs(dy)*1.15)return;
      if(stage?.beginSwipe(start.adjacent)===false){cancel();return;}
      start.horizontal=true;holder.dataset.swiping='true';
      try{holder.setPointerCapture?.(event.pointerId);}catch{}
    }
    if(event.cancelable)event.preventDefault();
    const available=dx<0?start.adjacent.next:start.adjacent.previous;
    const offset=available?Math.max(-start.width,Math.min(start.width,dx)):Math.sign(dx)*Math.min(42,Math.abs(dx)*.22);
    start.samples.push({x:event.clientX,at:event.timeStamp});
    while(start.samples.length>2&&event.timeStamp-start.samples[0].at>90)start.samples.shift();
    stage?.moveSwipe(offset);
  }
  function finish(event,cancelled=false){
    if(!start||event.pointerId!==start.id)return;
    const point=start;start=null;release(point);
    if(!point.horizontal)return;
    suppressClickUntil=performance.now()+400;
    const dx=event.clientX-point.x,sample=point.samples[0],elapsed=event.timeStamp-sample.at;
    const velocity=elapsed>0&&elapsed<140?(event.clientX-sample.x)/elapsed:0;
    const direction=dx<0?1:-1,available=direction===1?point.adjacent.next:point.adjacent.previous;
    const threshold=Math.max(28,Math.min(110,point.width*.22));
    const commit=!cancelled&&!isLocked()&&available&&(Math.abs(dx)>=threshold||(Math.abs(dx)>=24&&Math.abs(velocity)>=.45&&Math.sign(velocity)===Math.sign(dx)));
    const step=commit?direction:0,request=++generation;settling=true;
    const settled=stage?.settleSwipe(step)??Promise.resolve({committed:step!==0});
    Promise.resolve(settled).then(result=>{
      if(disposed||request!==generation)return;
      settling=false;holder.removeAttribute('data-swiping');
      if(step&&result?.committed&&!isLocked())onStep?.(step);
    }).catch(()=>{if(request===generation)cancel();});
  }
  holder.addEventListener('dragstart',e=>e.preventDefault(),{signal:events.signal});
  holder.addEventListener('pointerdown',e=>{
    if(e.button===0&&e.isPrimary!==false)suppressClickUntil=0;
    if(e.button!==0||e.isPrimary===false||isLocked()||settling||start||e.target.closest('button,a,input,select,textarea'))return;
    start={x:e.clientX,y:e.clientY,id:e.pointerId,width:Math.max(1,holder.getBoundingClientRect().width),adjacent:getAdjacent(),horizontal:false,samples:[{x:e.clientX,at:e.timeStamp}]};
  },{signal:events.signal});
  holder.addEventListener('pointermove',move,{passive:false,signal:events.signal});
  window.addEventListener('pointerup',e=>finish(e),{signal:events.signal});
  holder.addEventListener('pointercancel',e=>finish(e,true),{signal:events.signal});
  holder.addEventListener('lostpointercapture',e=>{if(e.target===holder&&start?.id===e.pointerId)finish(e,true);},{signal:events.signal});
  holder.addEventListener('click',e=>{if(performance.now()<suppressClickUntil){e.preventDefault();e.stopPropagation();}},{capture:true,signal:events.signal});
  holder.addEventListener('keydown',e=>{
    if(e.target!==holder||isLocked()||settling||!['ArrowLeft','ArrowRight'].includes(e.key))return;
    e.preventDefault();cancel();onStep?.(e.key==='ArrowLeft'?-1:1);
  },{signal:events.signal});
  window.addEventListener('resize',cancel,{signal:events.signal});
  window.addEventListener('blur',cancel,{signal:events.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();},{signal:events.signal});
  return {cancel,destroy(){disposed=true;events.abort();cancel();holder.style.touchAction=previousTouchAction;}};
}
