// 鄭人買履: shoes are tried strictly 1 -> 2 -> 3 with real touch taps; only the third fits.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const repo=path.resolve(__dirname,'..');
const mime={'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
const fixture=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/maanshan/poem-games/shoe-market.css">
<style>*{box-sizing:border-box}body{margin:0;padding:12px;font-family:sans-serif;--sans:sans-serif}[hidden]{display:none!important}#holder{width:100%;max-width:700px;margin:auto}</style>
<main id="holder"></main>`;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fixture);return;}
  const file=path.resolve(repo,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(repo+path.sep)||!url.pathname.startsWith('/maanshan/')||!mime[path.extname(file)]){res.writeHead(404).end();return;}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',mime[path.extname(file)]);res.end(data);});
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const errors=[],checks=[];
  const check=(name,value)=>{assert(value,name);checks.push(name);};
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
    await page.evaluate(async()=>{
      window.completed=0;window.observed=[];
      const {mountShoeMarket}=await import('/maanshan/poem-games/shoe-market.mjs');
      window.game=mountShoeMarket(document.querySelector('#holder'),{initialState:{version:3,stage:'try',marks:2,size:null},reducedMotion:true,playAudio:async()=>true,onComplete:()=>completed++,onResearch:(type,fields)=>observed.push({type,...fields})});
    });
    await page.waitForFunction(()=>document.querySelector('.sm-loading')?.hidden===true);
    const turns=()=>page.locator('[data-sm-shoe]').evaluateAll(nodes=>nodes.map(n=>n.dataset.smShoe+':'+n.dataset.turn).join(' '));
    const feedback=()=>page.locator('.sm-feedback').innerText();
    check('only shoe 1 is next, shoes 2 and 3 wait',await turns()==='big:next small:wait right:wait');
    check('waiting shoes show a number badge and are announced as waiting',await page.locator('[data-sm-shoe=right]').evaluate(b=>b.querySelector('.sm-no').textContent==='3'&&b.getAttribute('aria-disabled')==='true'&&getComputedStyle(b.querySelector('img')).opacity<.5));
    // aria-disabled (not disabled) keeps the waiting shoe tappable so it can explain itself; Playwright treats it as not enabled.
    await page.locator('[data-sm-shoe=right]').tap({force:true});
    check('tapping shoe 3 first is refused with an in-order reminder',await turns()==='big:next small:wait right:wait'&&(await feedback()).includes('先試第 1 雙')&&await page.evaluate(()=>completed===0));
    await page.locator('[data-sm-shoe=big]').tap();
    check('shoe 1 is too big and shoe 2 becomes next',await turns()==='big:tried small:next right:wait'&&(await feedback()).includes('太大'));
    check('tried shoe shows its verdict tag',await page.locator('[data-sm-shoe=big] .sm-tag').evaluate(t=>t.textContent==='太大'&&getComputedStyle(t).display!=='none'));
    await page.locator('[data-sm-shoe=small]').tap();
    check('shoe 2 is too small and shoe 3 becomes next',await turns()==='big:tried small:tried right:next'&&(await feedback()).includes('太小'));
    await page.locator('[data-sm-shoe=right]').tap();
    await page.waitForFunction(()=>completed===1);
    check('shoe 3 fits and completes the game once',await page.evaluate(()=>completed===1&&observed.some(e=>e.type==='answer_submitted')));
    await page.evaluate(()=>window.game.destroy());
    await page.evaluate(async()=>{
      window.completed=0;
      const {mountShoeMarket}=await import('/maanshan/poem-games/shoe-market.mjs');
      window.game=mountShoeMarket(document.querySelector('#holder'),{initialState:{version:3,stage:'try',marks:2,size:'small'},reducedMotion:true,playAudio:async()=>true,onComplete:()=>completed++});
    });
    await page.waitForFunction(()=>document.querySelector('.sm-loading')?.hidden===true);
    check('a save after shoe 2 resumes with shoe 3 next',await turns()==='big:tried small:tried right:next');
    await context.close();
    check('no browser exceptions',errors.length===0);
    console.log(JSON.stringify({ok:true,checks},null,2));
  }catch(error){console.error(error,errors);process.exitCode=1;}finally{await browser.close();server.close();}
})();
