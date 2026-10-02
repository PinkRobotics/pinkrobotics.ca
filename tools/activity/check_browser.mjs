// Optional browser acceptance probe. The generator and unit suite use Python's standard library.
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile, rm, rename} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const base = process.argv[2];
if (!base || !process.env.TMPDIR) throw new Error('Pass the local site URL and set TMPDIR.');
const profile = await mkdtemp(join(process.env.TMPDIR,'activity-browser-'));
const browser = spawn(process.env.CHROME || '/snap/bin/chromium',[
  '--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking',
  '--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
  `--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',detached:true});
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
let socket, moved=false;
const dataPath='site/log/data/activity.json', heldPath='site/log/data/.activity-held';
const records=[];
try {
  let port;
  for(let i=0;i<100;i++){
    try {port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;} catch {await pause(100);}
  }
  assert.ok(port,'Browser started');
  const tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let seq=0, errors=[], foreign=[], mockJson=null;
  const pending=new Map();
  socket.onmessage=event=>{
    const m=JSON.parse(event.data);
    if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(new Error(m.error.message));else p.resolve(m.result);}
    else if(m.method==='Runtime.exceptionThrown')errors.push('uncaught script error');
    else if(m.method==='Network.requestWillBeSent'){
      const url=m.params.request.url;
      if(/^https?:/.test(url) && new URL(url).origin!==new URL(base).origin)foreign.push('foreign request');
    }
    else if(m.method==='Fetch.requestPaused'){
      const params={requestId:m.params.requestId,responseCode:200,
        responseHeaders:[{name:'Content-Type',value:'application/json'}],
        body:Buffer.from(mockJson).toString('base64')};
      call('Fetch.fulfillRequest',params).catch(()=>errors.push('fixture response failed'));
    }
  };
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    assert.equal(Boolean(result.exceptionDetails),false,'Evaluation completed');
    return result.result.value;
  };
  for(const method of ['Page.enable','Network.enable','Runtime.enable'])await call(method);
  await call('Network.setCacheDisabled',{cacheDisabled:true});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const navigate=async path=>{errors=[];foreign=[];await call('Page.navigate',{url:base+path});await pause(1800);};
  const verifyNetwork=()=>{assert.equal(errors.length,0);assert.equal(foreign.length,0);};
  for(const width of [1440,834,390]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await navigate('/log/');
    let record=await evaluate(`(() => ({ready:!document.getElementById('record').hidden,overflow:document.documentElement.scrollWidth>innerWidth,emDashes:document.body.innerText.split(String.fromCharCode(8212)).length-1,sections:[...document.querySelectorAll('main section')].map(x=>x.id),reduced:matchMedia('(prefers-reduced-motion:reduce)').matches}))()`);
    assert.equal(record.ready,true);assert.equal(record.overflow,false);assert.equal(record.emDashes,0);assert.equal(record.reduced,true);
    assert.deepEqual(record.sections,['scoreboard','landings','commits','flight','checks','questions','objections','cost','method']);
    await evaluate(`document.querySelector('#landing-list summary').focus()`);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    assert.equal(await evaluate(`document.querySelector('#landing-list details').open`),true);
    await evaluate(`document.querySelectorAll('details').forEach(d=>d.open=true)`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`),false);
    verifyNetwork();
    records.push({page:'log',width,...record,keyboardDisclosure:true,allDisclosuresNoOverflow:true,foreign:0,scriptErrors:0});
    await navigate('/');
    const home=await evaluate(`(() => {const strip=document.getElementById('activity-strip');return {loaded:!document.getElementById('activity-latest').hidden,inside:strip.getBoundingClientRect().right<=innerWidth,summary:document.getElementById('activity-summary').textContent}})()`);
    assert.equal(home.loaded,true);assert.equal(home.inside,true);verifyNetwork();
    records.push({page:'home-strip',width,...home,foreign:0,scriptErrors:0});
  }
  const fixture=JSON.parse(await readFile(dataPath,'utf8'));
  fixture.checks={state:'available',message:'Fixture labelled result.',items:[{name:'Fixture measurement',class:'measurement',verdict:'MISS'}]};
  fixture.commits[0].subject='<img src=x onerror=globalThis.activityInjected=true>';
  mockJson=JSON.stringify(fixture);
  await call('Fetch.enable',{patterns:[{urlPattern:base+'/log/data/activity.json',requestStage:'Request'}]});
  await navigate('/log/');
  const fixtureResult=await evaluate(`({miss:document.querySelector('#check-list .miss')?.textContent==='MISS',safeText:document.querySelector('#commit-list summary').textContent.includes('<img'),noInjectedElement:document.querySelector('#commit-list img')===null,noExecutedText:!globalThis.activityInjected})`);
  for(const value of Object.values(fixtureResult))assert.equal(value,true);
  verifyNetwork();records.push({page:'log',state:'labelled-MISS-and-text-safety',...fixtureResult,foreign:0,scriptErrors:0});
  await call('Fetch.disable');
  await rename(dataPath,heldPath);moved=true;
  for(const path of ['/log/','/']){
    await navigate(path);
    const state=await evaluate(path==='/log/' ? `({visible:!document.getElementById('fallback').hidden,recordHidden:document.getElementById('record').hidden,text:document.getElementById('fallback').textContent})` : `({visible:document.getElementById('activity-latest').hidden,text:document.getElementById('activity-summary').textContent})`);
    assert.equal(state.visible,true);if(path==='/log/')assert.equal(state.recordHidden,true);verifyNetwork();
    records.push({page:path,state:'missing-data',...state,foreign:0,scriptErrors:0});
  }
  await rename(heldPath,dataPath);moved=false;
  await call('Emulation.setScriptExecutionDisabled',{value:true});
  for(const path of ['/log/','/']){
    await navigate(path);
    const state=await evaluate(path==='/log/' ? `({visible:!document.getElementById('fallback').hidden,recordHidden:document.getElementById('record').hidden})` : `({visible:document.getElementById('activity-latest').hidden})`);
    assert.equal(state.visible,true);verifyNetwork();records.push({page:path,state:'script-disabled',...state,foreign:0,scriptErrors:0});
  }
  await writeFile('tools/activity/evidence/browser-check.json',JSON.stringify(records,null,2)+'\n');
  console.log(`PASS ${records.length} browser states; zero foreign requests, script errors or page overflow; keyboard disclosures and reduced motion checked.`);
} finally {
  if(moved)await rename(heldPath,dataPath);
  socket?.close();
  try {process.kill(-browser.pid,'SIGTERM');} catch (error) {if(error.code!=='ESRCH')throw error;}
  await new Promise(resolve=>{if(browser.exitCode!==null)resolve();else browser.once('exit',resolve);});
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
