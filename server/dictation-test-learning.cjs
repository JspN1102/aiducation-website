'use strict';
// These regression suites isolate writing/correction/persistence. The dedicated
// learning-flow suite exercises real per-stroke tracing. Here the local renderer
// still draws each stroke, but its timeline is accelerated and quiz completion
// is synthetic so every viewport can reach the independent-assessment stage.
async function installLearningFixture(page){
 await page.evaluate(async()=>{
  const {loadHanziWriter}=await import('/maanshan/hanzi-library.mjs');
  const library=await loadHanziWriter(window);
  if(library.__dictationFixture)return;
  const create=library.create.bind(library);library.__dictationFixture=true;
  library.create=(holder,character,options)=>{
   const writer=create(holder,character,{...options,strokeAnimationSpeed:window.__dictationAnimationSpeed||50,delayBetweenStrokes:window.__dictationAnimationSpeed===1?180:0});
   const quiz=writer.quiz.bind(writer);
   writer.quiz=(options={})=>{
    window.__traceQuizCount=(window.__traceQuizCount||0)+1;
    window.__completeTracing=()=>options.onComplete?.({character,totalMistakes:0});
    return quiz(options);
   };
   return writer;
  };
 });
}
async function finishLearning(page){
 await page.waitForFunction(()=>document.querySelector('.challenge-writing')?.dataset.phase==='tracing');
 await page.evaluate(()=>window.__completeTracing());
 await page.waitForFunction(()=>['assessment','review'].includes(document.querySelector('.challenge-writing')?.dataset.phase));
}
module.exports={installLearningFixture,finishLearning};
