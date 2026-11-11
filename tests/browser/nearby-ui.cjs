const fs=require('fs'), path=require('path'), assert=require('node:assert/strict');
const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'docs/verification/nearby-cards');
fs.mkdirSync(out,{recursive:true});
const data=JSON.parse(fs.readFileSync(path.join(root,'data/stops.json'),'utf8'));
const pos=data.stops[data.lines['7'][0].s[2]], results=[];
const wait=async(fn)=>{for(let n=0;n<100;n++){if(await fn())return;await new Promise(r=>setTimeout(r,30));}throw new Error('Expected state did not settle');};
async function check(name,type,options,theme){
 const browser=await type.launch({headless:true});
 try{
  const ctx=await browser.newContext({...options,colorScheme:theme,serviceWorkers:'block',permissions:['geolocation'],geolocation:{latitude:pos[1],longitude:pos[2],accuracy:10}});
  const page=await ctx.newPage();let calls=0,fail=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/v1/arrivals?**',async route=>{
   calls++;if(fail)return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Static host</title>'});
   const stopId=new URL(route.request().url()).searchParams.getAll('stopId')[0],now=Date.now();
   const rows=[['7','BUS','NCA427'],['4','TRAM','6040'],['73','TROLLEYBUS',null]].map(([line,type,plate],i)=>({key:'ui-'+i,stopId,tripId:'BKK_UI'+i,serviceDate:'20261111',line,type,plate,headsign:i===0?'Rákospalota, MEDIMPEX, Újpalota, Nyírpalota út':'Deák Ferenc tér M',scheduledAtMs:now+60000*i,predictedAtMs:now+180000+60000*i,timing:'realtime',delaySec:180,vehicle:null}));
   return route.fulfill({json:{schemaVersion:1,serverNowMs:now,state:'ok',arrivals:rows}});
  });
  await page.goto('http://127.0.0.1:8000',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>document.querySelector('#ride-info').textContent);
  assert.equal(calls,0,'Progress landing must not start location/arrival lookup');
  if(name==='pc'&&theme==='light'){await page.clock.install();await page.clock.pauseAt(new Date());}
  await page.locator('[data-view=log]').click();
  await page.locator('#nb-list .nb-row').first().waitFor();
  await wait(()=>page.evaluate(()=>!nb.busy));
  assert.equal(calls,1,'Log entry must start one automatic lookup');
  assert.equal(await page.locator('[data-mode=nearby]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#nb-list .nb-row').count(),3);
  const bounds=await page.locator('#nb-list .nb-row').evaluateAll(es=>es.map(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:b.x,y:b.y,w:b.width,h:b.height,overflow:e.scrollWidth>e.clientWidth+1,radius:parseFloat(s.borderRadius),border:parseFloat(s.borderLeftWidth),color:s.borderLeftColor,background:s.backgroundColor};}));
  bounds.forEach((r,i)=>{assert(!r.overflow);assert(r.radius<=12);assert(r.border>=3);if(i){assert.equal(r.x,bounds[0].x);assert(Math.abs(r.w-bounds[0].w)<1);assert(r.y>=bounds[i-1].y+bounds[i-1].h);}});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.match(await page.locator('#nb-list').innerText(),/NCA427/);
  assert.equal(await page.locator('#nb-list s.nb-old').count(),3);
  const disclosure=page.locator('details').filter({has:page.locator('#nb-stops')});
  assert.equal(await disclosure.getAttribute('open'),null);
  await page.screenshot({path:path.join(out,name+'-'+theme+'-rows.png'),fullPage:true});
  await disclosure.locator('summary').click();
  const buttons=page.locator('#nb-stops button');assert((await buttons.count())>1);
  const filters=await buttons.evaluateAll(es=>es.map(e=>({w:e.getBoundingClientRect().width,y:e.getBoundingClientRect().y,overflow:e.scrollWidth>e.clientWidth+1})));
  filters.forEach((r,i)=>{assert(!r.overflow);if(i){assert(Math.abs(r.w-filters[0].w)<1);assert(r.y>filters[i-1].y);}});
  await buttons.first().focus();await page.keyboard.press('Space');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');await page.keyboard.press('Space');
  await page.screenshot({path:path.join(out,name+'-'+theme+'-stops.png'),fullPage:true});
  await disclosure.locator('summary').click();
  if(name==='pc'&&theme==='light'){
   const before=calls;await page.clock.runFor(29999);assert.equal(calls,before);await page.clock.runFor(1);await wait(()=>calls===before+1);await wait(()=>page.evaluate(()=>!nb.busy));
   await page.locator('#nb-locate').click();await wait(()=>calls===before+2);await wait(()=>page.evaluate(()=>!nb.busy));
   await page.locator('[data-mode=form]').click();const manual=calls;await page.clock.runFor(60000);assert.equal(calls,manual,'manual mode must pause arrivals');
   await page.locator('[data-mode=nearby]').click();await wait(()=>calls===manual+1);await wait(()=>page.evaluate(()=>!nb.busy));
   await page.locator('[data-view=progress]').click();const elsewhere=calls;await page.clock.runFor(60000);assert.equal(calls,elsewhere,'other views must pause arrivals');
   fail=true;await page.locator('[data-view=log]').click();await wait(()=>page.evaluate(()=>!nb.busy&&nb.paused));
   const failed=calls;await page.clock.runFor(90000);assert.equal(calls,failed,'missing backend must pause automatic retries');
   assert.match(await page.locator('#nb-status').innerText(),/not available yet/);
   fail=false;await page.locator('#nb-locate').click();await wait(()=>calls===failed+1);await wait(()=>page.evaluate(()=>!nb.busy&&!nb.paused));
  }
  assert.deepEqual(errors,[]);results.push({profile:name,theme,passed:true,bounds,filters});
 }finally{await browser.close();}
}
(async()=>{try{for(const [name,type,options] of [['pc',chromium,{viewport:{width:1440,height:1000}}],['mac',webkit,{viewport:{width:1440,height:1000}}],['android',chromium,devices['Pixel 7']],['iphone',webkit,devices['iPhone 13']],['narrow',chromium,{viewport:{width:320,height:850}}]])for(const theme of ['light','dark']){await check(name,type,options,theme);console.log(name+' '+theme+': passed');}}catch(e){results.push({passed:false,error:e.stack});console.error(e.stack);process.exitCode=1;}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));})();
