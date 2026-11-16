const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'docs/verification/ride-redesign');fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync(path.join(root,'data/stops.json'),'utf8')),pos=data.stops[data.lines['225'][0].s[0]],report=[];
async function accessibility(page){await page.addScriptTag({path:require.resolve(process.env.AXE_MODULE||'axe-core/axe.min.js')});return page.evaluate(async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));});}
const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwXcAAAAASUVORK5CYII=','base64');
(async()=>{
for(const [name,engine,options] of [['pc',chromium,{viewport:{width:1440,height:1000}}],['mac',webkit,{viewport:{width:1440,height:1000}}],['android',chromium,devices['Pixel 7']],['iphone',webkit,devices['iPhone 13']]])for(const theme of ['light','dark']){
 const browser=await engine.launch();try{
 const ctx=await browser.newContext({...options,colorScheme:theme,serviceWorkers:'block',permissions:['geolocation'],geolocation:{latitude:pos[1],longitude:pos[2],accuracy:5}}),page=await ctx.newPage(),errors=[],a11y={};
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const base=Date.now.bind(Date);window.testOffset=0;Date.now=()=>base()+window.testOffset;});
 await page.route('**/data/api.json',r=>r.fulfill({json:{apiBase:'',tiles:''}}));
 await page.route('**/v1/arrivals?**',r=>{const now=Date.now();return r.fulfill({json:{schemaVersion:1,serverNowMs:now,state:'ok',arrivals:[{key:'ride225',stopId:pos[3],tripId:'BKK_live225',serviceDate:'20261116',line:'225',type:'BUS',plate:'SKR806',headsign:'Rákospalota, Székely Elek út',scheduledAtMs:now+60000,predictedAtMs:null,delaySec:null,timing:'scheduled',vehicle:null}]}});});
 await page.route('**/v1/trip?**',r=>r.fulfill({json:{schemaVersion:1,vehicle:null,stopTimes:[]}}));
 await page.route('**/v1/vehicles?**',r=>r.fulfill({json:{schemaVersion:1,state:'ok',kind:'line',query:'225',vehicles:[{plate:'SKR806',line:'225',type:'BUS',headsign:'Rákospalota, Székely Elek út',stop:'Árokhát út',positionAtMs:Date.now(),lat:47.57,lon:19.12,stale:false,tripId:'BKK_live225',serviceDate:'20261116'}]}}));
 await page.goto('http://127.0.0.1:8000');await page.locator('#nb-list .board-action').waitFor();await page.waitForFunction(()=>!nb.busy);
 assert.equal(await page.locator('#log-mode').isVisible(),false);assert.equal(await page.locator('#identity-fields').isVisible(),false);
 const row=page.locator('#nb-list .nb-row').first();assert((await row.boundingBox()).height<130);
 await row.focus();await page.keyboard.press('Enter');await page.locator('#detail[open]').waitFor();await page.keyboard.press('Escape');await page.waitForFunction(()=>nb.open===null&&document.activeElement.dataset.key==='ride225');
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('board-action')),true);await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.dataset.key),'ride225');
 await page.waitForTimeout(250);await page.screenshot({path:path.join(out,`${name}-${theme}-nearby.png`)});
 a11y.nearby=await accessibility(page);
 await page.locator('#nb-list .board-action').click();await page.waitForFunction(()=>document.body.dataset.rideState==='active');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'ride-title');assert.equal(await page.locator('#identity-fields').isVisible(),false);assert.equal(await page.locator('#save').isVisible(),false);
 await page.locator('#ride-bar').evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)));await page.waitForTimeout(250);await page.screenshot({path:path.join(out,`${name}-${theme}-active.png`)});a11y.active=await accessibility(page);
 await page.locator('#ride-undo').click();await page.waitForFunction(()=>!rideSession);assert.equal(await page.evaluate(()=>document.activeElement.id),'nb-title');
 await page.locator('#nb-list .board-action').focus();await page.keyboard.press('Space');await page.waitForFunction(()=>!!rideSession);
 await page.locator('#photo-gallery').setInputFiles({name:'ride.png',mimeType:'image/png',buffer:photo});await page.waitForFunction(()=>photos.length===1);
 await page.locator('[data-view=lines]').click();assert.equal(await page.locator('#active-ride').isVisible(),true);
 await page.locator('#active-ride').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'ride-title');
 await page.waitForTimeout(400);await page.reload();await page.waitForFunction(()=>!!rideSession&&photos.length===1);if(await page.locator('#ride-board').isVisible())await page.locator('#ride-board').click();
 await page.evaluate(()=>{stopTrack();window.testOffset=601000;const d=pick.data[pick.dir],s=stopData.stops[d.s[pick.from+3]];trackPts=[[s[1],s[2],Date.now()/1000]];});
 await page.locator('#ride-off').click();await page.waitForFunction(()=>document.body.dataset.rideState==='finish');assert.equal(await page.evaluate(()=>document.activeElement.id),'save');
 assert.equal(await page.locator('#stop-picker').isVisible(),true);assert.equal(await page.evaluate(()=>pick.to-pick.from),3);
 await page.waitForTimeout(250);await page.screenshot({path:path.join(out,`${name}-${theme}-finish.png`)});a11y.finish=await accessibility(page);
 await page.locator('#save').click();await page.locator('#saved-result').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.id),'saved-title');
 assert.equal(await page.evaluate(()=>entries.length),1);assert.equal(await page.evaluate(()=>entries[0].ride.ruleVersion),2);assert.equal(await page.evaluate(()=>clearedPlates().has('SKR806')),true);
 await page.waitForTimeout(250);await page.screenshot({path:path.join(out,`${name}-${theme}-saved.png`)});a11y.saved=await accessibility(page);await page.locator('#saved-nearby').click();assert.equal(await page.evaluate(()=>document.activeElement.id),'nb-title');
 for(const tab of ['lines','plates','history','progress']){await page.locator(`[data-view=${tab}]`).click();await page.waitForTimeout(250);await page.screenshot({path:path.join(out,`${name}-${theme}-${tab}.png`)});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);a11y[tab]=await accessibility(page);}
 await page.locator('#settings').evaluate(e=>e.open=true);await page.locator('#settings').scrollIntoViewIfNeeded();await page.waitForTimeout(250);await page.screenshot({path:path.join(out,`${name}-${theme}-settings.png`)});a11y.settings=await accessibility(page);await page.locator('#theme').selectOption(theme);assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
 await page.locator('[data-view=lines]').click();await page.locator('#q-lines').fill('225');await page.locator('#list-lines .tile').click();await page.locator('#detail .livecard button').first().click();await page.locator('#detail .board-action').waitFor();await page.waitForTimeout(250);await page.screenshot({path:path.join(out,`${name}-${theme}-line.png`)});a11y.line=await accessibility(page);await page.locator('#detail .board-action').click();await page.waitForFunction(()=>!!rideSession&&!document.querySelector('#detail').open);assert.equal(await page.evaluate(()=>document.activeElement.id),'ride-title');await page.locator('#ride-undo').click();await page.waitForFunction(()=>!rideSession);
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>document.getAnimations().some(a=>a.playState==='running'&&a.effect?.getTiming().iterations===Infinity)),false);
 await page.locator('#nb-list .nb-row').first().focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');
 await page.locator('[data-view=log]').click();await page.locator('#nb-list .board-action').click();await page.waitForFunction(()=>!!rideSession);assert.equal(await page.locator('#ride-bar').evaluate(e=>e.getAnimations().length),0);
 await page.locator('#ride-off').click();await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#msg').textContent.includes('photo'));assert.equal(await page.evaluate(()=>document.activeElement.id),'add-photo');
 await page.locator('#add-photo').click();await page.locator('#pick-cancel').click();await page.waitForFunction(()=>document.activeElement.id==='add-photo');assert.equal(await page.evaluate(()=>!!rideSession),true);
 assert.deepEqual(Object.values(a11y).flat(),[]);assert.deepEqual(errors,[]);report.push({name,theme,passed:true,a11y});console.log(name+' '+theme+': passed; axe '+JSON.stringify(a11y));
 }finally{await browser.close();}
}
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
