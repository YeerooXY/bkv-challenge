// Run with the local backend on :8000. Uses isolated profiles and synthetic responses.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'docs/verification/likely-plate');fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync(path.join(root,'data/stops.json'),'utf8')),pos=data.stops[data.lines['225'][0].s[0]];
(async()=>{
 for(const [name,engine,options] of [['pc',chromium,{viewport:{width:1440,height:1000}}],['mac',webkit,{viewport:{width:1440,height:1000}}],['android',chromium,devices['Pixel 7']],['iphone',webkit,devices['iPhone 13']]]) {
  const browser=await engine.launch();
  try{
   const ctx=await browser.newContext({...options,serviceWorkers:'block',permissions:['geolocation'],geolocation:{latitude:pos[1],longitude:pos[2],accuracy:5},colorScheme:name==='iphone'?'dark':'light'});
   const page=await ctx.newPage();let confirmed=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/data/api.json',r=>r.fulfill({json:{apiBase:'',tiles:''}}));
   await page.route('**/v1/arrivals?**',r=>{const stopId=new URL(r.request().url()).searchParams.get('stopId');return r.fulfill({json:{schemaVersion:1,state:'ok',serverNowMs:Date.now(),arrivals:[{key:'candidate',stopId,tripId:'BKK_next',serviceDate:'20261116',line:'225',type:'BUS',plate:confirmed?'SKR806':null,...(confirmed?{}:{likelyPlate:'SKR806',identitySource:'vehicle-block',sourceTripId:'BKK_previous'}),headsign:'Rákospalota, Székely Elek út',scheduledAtMs:Date.now()+300000,predictedAtMs:null,delaySec:null,timing:'scheduled',vehicle:null}]}});});
   await page.goto('http://127.0.0.1:8000');await page.waitForFunction(()=>document.querySelector('#ride-info').textContent);
   await page.locator('[data-view=log]').click();const row=page.locator('#nb-list .nb-row');await row.waitFor();await page.waitForFunction(()=>!nb.busy);
   assert.match(await row.innerText(),/Likely SKR806/);assert.equal(await row.locator('.nb-state').count(),0);
   await row.focus();await page.keyboard.press('Space');await page.locator('#detail[open]').waitFor();
   assert.equal(await page.locator('#detail .mm-pin.vehicle').count(),0);
   assert.match(await page.locator('#detail-body').innerText(),/another trip/);
   await page.locator('#detail').evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)));
   await page.screenshot({path:path.join(out,name+'-detail.png'),fullPage:true});
   await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.dataset.key),'candidate');assert.equal(await page.evaluate(()=>rideSession),null);
   await page.keyboard.press('Enter');await page.getByRole('button',{name:'Board and enter plate',exact:true}).click();
   await page.waitForFunction(()=>document.activeElement.id==='ride-title');
   assert.equal(await page.locator('#plate').inputValue(),'');assert.equal(await page.evaluate(()=>document.activeElement.id),'ride-title');
   await page.evaluate(async()=>{rideSession=null;stopTrack();await del("drafts",SESSION_KEY);resetForm();nbSetMode('nearby');});
   await row.focus();await page.keyboard.press('Enter');
   const use=page.getByRole('button',{name:'Confirm SKR806 and board',exact:true});await use.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');
   await use.click();await page.waitForFunction(()=>rideSession && rideSession.plate==='SKR806');assert.equal(await page.locator('#plate').inputValue(),'SKR806');assert.equal(await page.evaluate(()=>rideSession.trip.tripId),'BKK_next');assert.equal(await page.evaluate(()=>rideSession.trip.vehicleId),null);
   await page.evaluate(async()=>{rideSession=null;stopTrack();await del("drafts",SESSION_KEY);resetForm();nbSetMode('nearby');});confirmed=true;await page.evaluate(()=>nbLoad(false));
   assert.doesNotMatch(await row.innerText(),/Likely/);assert.equal(await row.locator('.nb-state').count(),1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
   console.log(name+': passed likely identity, explicit confirmation/manual path, no guessed position, direct update, keyboard focus');
  }finally{await browser.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
