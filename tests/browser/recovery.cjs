const assert=require('node:assert/strict');
const fs=require('fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output=require('path').resolve(__dirname, '../../docs/verification/nearby-lead/edge-results.json');
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwXcAAAAASUVORK5CYII=','base64');
fs.mkdirSync(require('path').dirname(output),{recursive:true});
const results=[];
async function boot(page){await page.route('**/data/api.json',r=>r.fulfill({json:{apiBase:'',tiles:''}}));await page.goto('http://127.0.0.1:8000',{waitUntil:'networkidle'});await page.waitForFunction(()=>typeof db!=='undefined'&&db&&document.body.dataset.rideState);}
async function board(page,plate){await page.evaluate(async plate=>{await startRide({source:'nearby',line:'7',plate,stop:{id:stopData.stops[stopData.lines['7'][0].s[0]][3],name:stopData.stops[stopData.lines['7'][0].s[0]][0]},headsign:stopData.lines['7'][0].to});},plate);await page.locator('#ride-off').waitFor();}
async function chooseStop(page){const value=await page.evaluate(()=>String(Math.min(pick.from+3,pick.data[pick.dir].s.length-1)));await page.locator('#to').selectOption(value);}
async function photo(page){await page.locator('#photo-gallery').setInputFiles({name:'test.png',mimeType:'image/png',buffer:image});await page.waitForFunction(()=>photos.length===1);}
async function closeCatch(page){if(await page.locator('#catch[open]').count())await page.keyboard.press('Escape');}
async function waitDraft(page){for(let i=0;i<40;i++){const ready=await page.evaluate(async()=>{const d=await getOne('drafts','form');return !!(d&&d.photos&&d.photos.length===1&&d.fields.notes===document.querySelector('#notes').value)});if(ready)return;await page.waitForTimeout(50);}throw new Error('Photo/form draft was not persisted');}
(async()=>{
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({serviceWorkers:'block',permissions:['geolocation'],geolocation:{latitude:47.497,longitude:19.05,accuracy:15}});
 await context.addInitScript(()=>{window.testOffset=0;const now=Date.now.bind(Date);Date.now=()=>now()+window.testOffset;});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await boot(page);
 await board(page,'NCA427');await page.locator('#ride-notes').evaluate(e=>e.open=true);await page.locator('#notes').fill('keep this note');await photo(page);
 const session=await page.evaluate(()=>rideSession.id);
 await waitDraft(page);
 await page.reload({waitUntil:'networkidle'});await page.locator('[data-view=log]').click();
 await page.waitForFunction(()=>rideSession!==null);
 assert.equal(await page.evaluate(()=>rideSession.id),session);
 assert.equal(await page.locator('#notes').inputValue(),'keep this note');
 assert.equal(await page.evaluate(()=>photos.length),1);
 if(await page.locator('#ride-board').isVisible())await page.locator('#ride-board').click();
 await context.setOffline(true);await page.evaluate(()=>window.testOffset=600000);
 await page.locator('#ride-off').click();await chooseStop(page);
 await page.evaluate(()=>{const real=db.transaction.bind(db);let once=true;db.transaction=(stores,...rest)=>{if(once&&Array.isArray(stores)&&stores.includes('entries')){once=false;throw new Error('simulated quota failure');}return real(stores,...rest);};});
 await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#msg').textContent.includes('Could not save'));
 assert.equal(await page.locator('#notes').inputValue(),'keep this note');assert.equal(await page.evaluate(()=>photos.length),1);
 await page.locator('#save').click();await page.waitForFunction(()=>entries.length===1);
 assert.equal(await page.evaluate(()=>clearedPlates().has('NCA427')),true);
 await closeCatch(page);await context.setOffline(false);
 results.push({check:'live ride reload/photos/notes, offline timer, failed-save recovery',passed:true});

 await page.locator('#saved-nearby').click();await board(page,'NCA518');await photo(page);await page.evaluate(()=>window.testOffset=1200000);await page.locator('#ride-off').click();
 await waitDraft(page);
 const second=await context.newPage();await boot(second);await second.waitForFunction(()=>rideSession&&rideSession.endedAtMs!==null);
 assert.equal(await second.evaluate(()=>photos.length),1);
 await Promise.all([page.locator('#save').click(),second.locator('#save').click()]);
 await second.reload({waitUntil:'networkidle'});await second.waitForFunction(()=>entries.length>=2);
 assert.equal(await second.evaluate(()=>entries.length),2,'concurrent tabs must not duplicate session');
 assert.equal(await second.evaluate(async()=>await getOne('drafts','ride-session')),undefined);
 results.push({check:'simultaneous two-tab save creates one entry for session and removes draft',passed:true});
 assert.deepEqual(errors,[]);
 await context.close();

 const legacy=await browser.newContext({serviceWorkers:'block'}),lp=await legacy.newPage();await boot(lp);await board(lp,'OLD123');await lp.evaluate(async()=>{rideSession.plate='';delete rideSession.ruleVersion;delete rideSession.mode;await saveSession();});await lp.reload();await lp.waitForFunction(()=>!!rideSession);assert.equal(await lp.locator('#identity-fields').isVisible(),true);assert.equal(await lp.locator('#plate').isVisible(),true);results.push({check:'legacy unfinished ride with missing plate retains correction controls after reload',passed:true});await legacy.close();
 const denied=await browser.newContext({serviceWorkers:'block'});await denied.addInitScript(()=>{window.testOffset=0;const now=Date.now.bind(Date);Date.now=()=>now()+window.testOffset;});
 const d=await denied.newPage();await boot(d);await board(d,'TEST123');await d.evaluate(()=>window.testOffset=600000);await d.locator('#ride-off').click();await chooseStop(d);await photo(d);await d.locator('#save').click();await d.waitForFunction(()=>entries.length===1);assert.equal(await d.evaluate(()=>clearedPlates().has('TEST123')),true);results.push({check:'GPS unavailable permits completion with rider-confirmed stops and duration',passed:true});await denied.close();
}catch(e){results.push({passed:false,error:e.stack});console.error(e.stack);process.exitCode=1;}finally{fs.writeFileSync(output,JSON.stringify(results,null,2));await browser.close();console.log(JSON.stringify(results));}
})();
