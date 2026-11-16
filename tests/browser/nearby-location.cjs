const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const {chromium, webkit, devices} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = path.resolve(__dirname, '../../docs/verification/nearby-location');
fs.mkdirSync(out, {recursive:true});
(async () => {
 for (const [name, engine, options] of [['pc',chromium,{viewport:{width:1440,height:1000}}],['mac',webkit,{viewport:{width:1440,height:1000}}],['android',chromium,devices['Pixel 7']],['iphone',webkit,devices['iPhone 13']]]) {
  const browser = await engine.launch();
  try {
   const context = await browser.newContext({...options,serviceWorkers:'block',colorScheme:name==='iphone'?'dark':'light'});
   await context.addInitScript(() => {
    window.testPosition = [47.5,19.05]; window.locationOptions=[];
    navigator.geolocation.getCurrentPosition = (ok, fail, options) => { window.locationOptions.push(options); ok({coords:{latitude:window.testPosition[0],longitude:window.testPosition[1],accuracy:5},timestamp:Date.now()}); };
   });
   const page = await context.newPage();
   await page.route('**/data/api.json', r=>r.fulfill({json:{apiBase:'',tiles:''}}));
   await page.route('**/v1/arrivals?**',r=>{
    const ids=new URL(r.request().url()).searchParams.getAll('stopId'), now=Date.now();
    return r.fulfill({json:{schemaVersion:1,serverNowMs:now,state:'ok',arrivals:ids.map((stopId,i)=>({key:stopId,stopId,tripId:'trip-'+stopId,serviceDate:'20261116',line:'170',type:'BUS',plate:i<2?'AAHY815':'P'+stopId,headsign:'Újpest-központ M',scheduledAtMs:now+(i+1)*60000,predictedAtMs:null,delaySec:null,timing:'scheduled',vehicle:null}))}});
   });
   await page.goto('http://127.0.0.1:8000');
   await page.waitForFunction(()=>document.querySelector('#ride-info').textContent);
   await page.evaluate(()=>{nearbyStops=(pos)=>Array.from({length:12},(_,i)=>({i:0,id:(pos[0]>47.55?'NEW':'F')+i,name:'Stop '+i,m:i*20}));});
   await page.locator('[data-view=log]').click();
   await page.waitForFunction(()=>nb.at && !nb.busy);
   assert.equal(await page.locator('#nb-list .nb-row').count(),5);
   const old = await page.locator('#nb-list .nb-row').first().getAttribute('data-key');
   await page.locator('#nb-more').focus(); await page.keyboard.press('Enter');
   await page.waitForFunction(()=>!nb.busy && nb.offset===6);
   assert(await page.locator(`#nb-list [data-key="${old}"]`).count());
   assert.equal(await page.locator('#nb-stops button').count(),12);
   assert.equal(await page.evaluate(()=>document.activeElement.id),'nb-locate');
   await page.evaluate(()=>window.testPosition=[47.6,19.15]);
   await page.locator('#nb-locate').focus(); await page.keyboard.press('Space');
   await page.waitForFunction(()=>!nb.busy && nb.pos[0]===47.6);
   assert.equal(await page.locator('#nb-stops button').count(),6);
   assert.equal(await page.locator(`#nb-list [data-key="${old}"]`).count(),0);
   assert(await page.evaluate(()=>locationOptions.every(o=>o.maximumAge===0)));
   await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
   assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});
   console.log(name+': passed fresh GPS, cumulative stops, unique vehicles, keyboard focus, overflow');
  } finally { await browser.close(); }
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
