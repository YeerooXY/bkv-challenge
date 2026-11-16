const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(__dirname,'../../docs/verification/live-search');fs.mkdirSync(out,{recursive:true});
(async()=>{
 for(const [name,engine,options] of [['pc',chromium,{viewport:{width:1440,height:1000}}],['mac',webkit,{viewport:{width:1440,height:1000}}],['android',chromium,devices['Pixel 7']],['iphone',webkit,devices['iPhone 13']]]){
  const browser=await engine.launch();
  try{
   const ctx=await browser.newContext({...options,serviceWorkers:'block',colorScheme:name==='iphone'?'dark':'light'}),page=await ctx.newPage();let calls=0,fail=false;
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/data/api.json',r=>r.fulfill({json:{apiBase:'',tiles:'https://tiles.test/{z}/{x}/{y}.png',attribution:'Test map'}}));
   await page.route('https://tiles.test/**',r=>r.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwXcAAAAASUVORK5CYII=','base64')}));
   await page.route('**/v1/vehicles?**',r=>{calls++;if(fail)return r.fulfill({status:503,json:{schemaVersion:1,reason:'unavailable'}});const q=new URL(r.request().url()).searchParams.get('q');return r.fulfill({json:{schemaVersion:1,state:'ok',query:q,kind:q==='225'?'line':'plate',vehicles:q==='ZZZ999'?[]:[{plate:'SKR806',line:'225',headsign:'Rákospalota, Székely Elek út',stop:'Árokhát út',positionAtMs:Date.now()-10000,lat:47.57,lon:19.12,stale:false}]}});});
   await page.goto('http://127.0.0.1:8000');await page.waitForFunction(()=>document.querySelector('#ride-info').textContent);
   await page.locator('[data-view=lines]').click();const input=page.locator('#q-lines'),panel=page.locator('#view-lines .livecard');
   await input.fill('225');assert.equal(calls,0);await input.press('Enter');await panel.locator('.nb-row').waitFor();assert.match(await panel.innerText(),/SKR806/);assert.match(await panel.innerText(),/225/);
   await panel.locator('.nb-row').focus();await page.keyboard.press('Space');await page.locator('#detail[open]').waitFor();await page.locator('#detail').evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)));
   assert.equal(await page.locator('#detail .mm-pin.vehicle').count(),1);assert.match(await page.locator('#detail-body').innerText(),/Toward Rákospalota/);
   await page.screenshot({path:path.join(out,name+'-map.png'),fullPage:true});await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('nb-row')),true);
   await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');
   await page.locator('[data-view=plates]').click();const plates=page.locator('#q-plates'),p=page.locator('#view-plates .livecard');await plates.fill('225');await plates.press('Enter');await p.locator('.nb-row').waitFor();assert.match(await p.innerText(),/SKR806/);
   await plates.fill('SKR806');await plates.press('Enter');await p.locator('.nb-row').waitFor();assert.match(await p.innerText(),/Line 225/);
   await page.screenshot({path:path.join(out,name+'-results.png'),fullPage:true});
   fail=true;await p.getByRole('button',{name:'Find live vehicles'}).click();await page.waitForFunction(()=>document.querySelector('#view-plates .livecard [role=status]').textContent.includes('retry'));assert.equal(await p.locator('.nb-row').count(),0);
   fail=false;await plates.fill('ZZZ999');await plates.press('Enter');await page.waitForFunction(()=>document.querySelector('#view-plates .livecard [role=status]').textContent.includes('No live vehicle'));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);console.log(name+': passed line and plate lookup, no keystroke requests, live map, keyboard focus, empty/error recovery');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
