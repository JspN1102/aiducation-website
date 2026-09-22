// This dispatcher is itself loaded only when a game is opened. Each game loads
// its own scene. The mountain photography game alone loads its 3D viewer;
// no game asks for camera or AR permissions.
import {createProcessResearch} from './research.mjs?v=20260920a';
const loaders={
 'yong-e':()=>import('./goose.mjs?v=20260922-school16').then(m=>m.mountGoose),
 'zeng-wang-lun':()=>import('./zeng.mjs?v=20260922-school16').then(m=>m.mountFarewell),
 'ti-xi-lin-bi':()=>import('./views.mjs?v=20260922-school20').then(m=>m.mountMountain),
 'bo-chuan-gua-zhou':()=>import('./river.mjs?v=20260922-school16').then(m=>m.mountRiver),
 'gui-yuan-tian-ju':()=>import('./garden.mjs?v=20260922-school16').then(m=>m.mountGarden),
 'zao-chun':()=>import('./rain.mjs?v=20260922-school16').then(m=>m.mountRain)
};
export function mountPoemGame(holder,{slug,...options}={}){
 if(!loaders[slug])throw new TypeError('Unknown poem game');
 let dead=false,game=null,generation=0,pendingSolution=false;
 const research=createProcessResearch(options.onResearch,{prefix:`game.${slug}`,alive:()=>!dead});
 const events=new AbortController();
 const load=async()=>{
  if(generation)research.retry('module');
  const version=++generation;
  holder.innerHTML='<p class="poem-game-loading" role="status">小畫卷正在展開…</p>';
  try{
   const mount=await loaders[slug]();if(dead||version!==generation)return;
   holder.replaceChildren();game=mount(holder,{...options,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches});
   if(pendingSolution)game.showSolution?.();
  }catch{
   if(dead||version!==generation)return;
   research.error('module');
   holder.innerHTML='<div class="poem-game-loading" role="status"><p>畫卷剛才未能展開。</p><button type="button" data-game-load-retry>再試一次</button></div>';
  }
 };
 holder.addEventListener('click',event=>{if(event.target.closest('[data-game-load-retry]'))load();},{signal:events.signal});
 load();
 return {destroy(){dead=true;generation++;events.abort();game?.destroy();holder.replaceChildren();},showSolution(){pendingSolution=true;game?.showSolution?.();}};
}
