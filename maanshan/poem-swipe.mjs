// A horizontal gesture selects the verse and painting without marking it read.
// Vertical gestures remain available to the page; arrows support keyboards.
export function mountPoemSwipe(holder,{onStep,isLocked=()=>false}={}){
  const events=new AbortController();let start=null;
  holder.tabIndex=0;holder.setAttribute('role','group');
  holder.setAttribute('aria-label','古詩畫卷，左右滑動或按方向鍵選擇詩句');
  const reset=()=>{start=null;};
  holder.addEventListener('dragstart',e=>e.preventDefault(),{signal:events.signal});
  holder.addEventListener('pointerdown',e=>{
    if(e.button!==0||isLocked()||e.target.closest('button,a'))return;
    start={x:e.clientX,y:e.clientY,id:e.pointerId};
    holder.setPointerCapture?.(e.pointerId);
  },{signal:events.signal});
  holder.addEventListener('pointerup',e=>{
    if(!start||e.pointerId!==start.id)return;
    const dx=e.clientX-start.x,dy=e.clientY-start.y;reset();
    if(!isLocked()&&Math.abs(dx)>=38&&Math.abs(dx)>Math.abs(dy)*1.35)onStep?.(dx<0?1:-1);
  },{signal:events.signal});
  holder.addEventListener('pointercancel',reset,{signal:events.signal});
  holder.addEventListener('lostpointercapture',reset,{signal:events.signal});
  holder.addEventListener('keydown',e=>{
    if(e.target!==holder||isLocked()||!['ArrowLeft','ArrowRight'].includes(e.key))return;
    e.preventDefault();onStep?.(e.key==='ArrowLeft'?-1:1);
  },{signal:events.signal});
  return {destroy(){events.abort();reset();}};
}
