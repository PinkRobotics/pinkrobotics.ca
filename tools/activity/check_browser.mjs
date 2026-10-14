// Browser acceptance for the bounded record, including old snapshots and hostile text.
import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const [base, output='tools/activity/evidence'] = process.argv.slice(2);
if (!base || !process.env.TMPDIR) throw new Error('Pass the local site URL and set TMPDIR.');
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(process.env.TMPDIR,'activity-browser-'));
const browser=spawn(process.env.CHROME || '/snap/bin/chromium',[
  '--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking',
  '--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
  `--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore',detached:true});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let socket;
const records=[];
try {
  let port;
  for(let i=0;i<100;i++){
    try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await pause(100);}
  }
  assert.ok(port,'Browser started');
  const tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  socket=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let seq=0,errors=[],foreign=[],reply;
  const pending=new Map();
  socket.onmessage=event=>{
    const m=JSON.parse(event.data);
    if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p.reject(new Error(m.error.message));else p.resolve(m.result);}
    else if(m.method==='Runtime.exceptionThrown')errors.push('uncaught script error');
    else if(m.method==='Network.requestWillBeSent'){
      const url=m.params.request.url;
      if(/^https?:/.test(url) && new URL(url).origin!==new URL(base).origin)foreign.push('foreign request');
    } else if(m.method==='Fetch.requestPaused'){
      call('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:reply.code,
        responseHeaders:[{name:'Content-Type',value:'application/json'}],
        body:Buffer.from(reply.body).toString('base64')}).catch(()=>errors.push('fixture failed'));
    }
  };
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{
    const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    assert.equal(Boolean(r.exceptionDetails),false,'Evaluation completed');return r.result.value;
  };
  for(const m of ['Page.enable','Network.enable','Runtime.enable'])await call(m);
  await call('Network.setCacheDisabled',{cacheDisabled:true});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const navigate=async path=>{errors=[];foreign=[];await call('Page.navigate',{url:base+path});await pause(1200);};
  const network=()=>{assert.equal(errors.length,0);assert.equal(foreign.length,0);};
  for(const width of [1440,834,390]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:width===390?844:900,deviceScaleFactor:1,mobile:false});
    await navigate('/log/');
    const state=await evaluate(`({ready:!document.getElementById('record').hidden,overflow:document.documentElement.scrollWidth>innerWidth,
      overviewBottom:Math.round(document.getElementById('overview').getBoundingClientRect().bottom),
      recent:document.querySelectorAll('#landing-list>.record-row').length,
      closed:[...document.querySelectorAll('details')].every(d=>!d.open),
      noPlaceholders:!/withheld.*boundary check/i.test(document.body.innerText),
      floatValues:[...document.querySelectorAll('.score strong')].map(n=>n.textContent),
      reduced:matchMedia('(prefers-reduced-motion:reduce)').matches})`);
    assert.equal(state.ready,true);assert.equal(state.overflow,false);assert.equal(state.closed,true);
    assert.equal(state.noPlaceholders,true);assert.equal(state.reduced,true);assert.ok(state.recent<=3);
    assert.ok(state.overviewBottom<=(width===390?844:900),`First-screen record is ${state.overviewBottom}px high at ${width}px`);
    const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(output,`worklog-${width}.png`),Buffer.from(shot.data,'base64'));
    await evaluate(`document.querySelector('#landing-list summary').focus()`);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    assert.equal(await evaluate(`document.querySelector('#landing-list details').open`),true);
    await evaluate(`document.querySelectorAll('details').forEach(d=>d.open=true)`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`),false);
    assert.equal(await evaluate(`/withheld.*boundary check/i.test(document.body.innerText)`),false);
    network();records.push({width,...state,keyboardDisclosure:true,expandedNoOverflow:true});
  }
  const fixture=await (await fetch(base+'/log/data/activity.json')).json();
  const commit=fixture.commits.find(c=>fixture.landings.some(l=>l.commits.includes(c.sha)));
  assert.ok(commit,'An accepted recorded commit exists for the renderer test');
  commit.subject='<img src=x onerror=globalThis.activityInjected=true>';
  fixture.checks={state:'available',message:'Fixture result.',items:[{name:'Fixture measurement',class:'measurement',verdict:'MISS'}]};
  fixture.lanes[0]={...fixture.lanes[0],status:'abandoned',title:'Fixture design stopped after a failed check'};
  fixture.questions.push({number:999,title:'Text withheld by the boundary check.',state:'open',fixed_date:null});
  fixture.landings.push({...fixture.landings[0],number:999,title:'Title withheld by the boundary check',summary:undefined});
  delete fixture.float_status;
  reply={code:200,body:JSON.stringify(fixture)};
  await call('Fetch.enable',{patterns:[{urlPattern:base+'/log/data/activity.json',requestStage:'Request'}]});
  await navigate('/log/?fixture=hostile#commit-'+commit.sha);
  assert.equal(await evaluate(`(() => {const t=document.getElementById('commit-${commit.sha}');for(let p=t;p;p=p.parentElement)if(p.tagName==='DETAILS'&&!p.open)return false;return !!t;})()`),true);
  await evaluate(`document.querySelectorAll('details').forEach(d=>d.open=true)`);
  const hostile=await evaluate(`({miss:document.querySelector('#check-list .miss')?.textContent==='MISS',
    abandoned:document.getElementById('setback-list').innerText.includes('Fixture design stopped'),
    textOnly:document.body.innerText.includes('<img src=x'),noImage:document.querySelector('main img')===null,
    noExecution:!globalThis.activityInjected,noPlaceholders:!/withheld.*boundary check/i.test(document.body.innerText),
    legacyFloat:[...document.querySelectorAll('.score strong')].every(n=>n.textContent==='Not shown')})`);
  for(const [key,value] of Object.entries(hostile))assert.equal(value,true,key+' '+JSON.stringify(hostile));
  network();records.push({case:'legacy-and-hostile-data',...hostile,deepLink:true});
  reply={code:404,body:''};await navigate('/log/');
  assert.equal(await evaluate(`!document.getElementById('fallback').hidden && document.getElementById('record').hidden`),true);
  network();records.push({case:'missing-data',fallback:true});
  await call('Fetch.disable');await call('Emulation.setScriptExecutionDisabled',{value:true});await navigate('/log/?scripts=off');
  assert.equal(await evaluate(`!document.getElementById('fallback').hidden && document.getElementById('record').hidden`),true);
  network();records.push({case:'script-disabled',fallback:true});
  await writeFile(join(output,'browser-check.json'),JSON.stringify(records,null,2)+'\n');
  console.log(`PASS ${records.length} browser states; no foreign requests, script errors, placeholders or overflow.`);
} finally {
  socket?.close();try{process.kill(-browser.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}
  await new Promise(resolve=>{if(browser.exitCode!==null)resolve();else browser.once('exit',resolve);});
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
