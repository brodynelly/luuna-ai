/** Real Windows native workbench smoke, real CLI data, synthetic Pi only. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..');
if(process.platform!=='win32') throw Error('Native smoke requires Windows WebView2; macOS is not verified by this test.');
const exe=join(repo,'src-tauri/target/release/luuna-ai.exe');
assert(existsSync(exe),'Run npm run build first: native release executable missing.');
for(const f of ['renderer/workbench.js','renderer/workbench.css','renderer/renderer.js','src-tauri/src/main.rs','src-tauri/src/components.rs','src-tauri/src/component_runner.rs']) assert(statSync(exe).mtimeMs>=statSync(join(repo,f)).mtimeMs,`Native executable is stale relative to ${f}; run npm run build.`);
const temp=mkdtempSync(join(tmpdir(),'luuna-workbench-'));
const evidence=resolve(process.env.LUUNA_SMOKE_EVIDENCE || join(repo,'.tac/runs/8d2ea719/native'));
mkdirSync(evidence,{recursive:true});
const a=join(temp,'project-a'),b=join(temp,'project-b');[a,b,join(temp,'pi-config')].forEach(p=>mkdirSync(p));
const rpc=join(temp,'pi-rpc.jsonl');const shim=join(temp,'synthetic-pi.cmd');
writeFileSync(shim,`@"${process.execPath}" "${join(repo,'test/fixture-pi.mjs')}" %*\r\n`);
const port=19443 + Math.floor(Math.random()*1000);
const env={...process.env,LUUNA_AI_DIR:a,LUUNA_AI_WORKBENCH_ROOT:join(temp,'data'),PI_CMD:shim,PI_CONFIG_DIR:join(temp,'pi-config'),LUUNA_SMOKE_RPC_LOG:rpc,WEBVIEW2_USER_DATA_FOLDER:join(temp,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`};
let child,client;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function connect() {
 for(let i=0;i<120;i++) {try {const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();const target=targets.find(t=>t.type==='page');if(target?.webSocketDebuggerUrl) {
  const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let seq=0;const pending=new Map();ws.onmessage=event=>{const m=JSON.parse(event.data);if(pending.has(m.id)){const [r,j]=pending.get(m.id);pending.delete(m.id);m.error?j(Error(JSON.stringify(m.error))):r(m.result);}};
  return {send(method,params={}){return new Promise((r,j)=>{const id=++seq;pending.set(id,[r,j]);ws.send(JSON.stringify({id,method,params}));});},close(){ws.close();}};
 }}catch{}await delay(250);}throw Error('No native WebView2 CDP page opened.');
}
async function evaluate(expression){const r=await client.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
// A view can make multiple sequential CLI calls, each with a 30-second backend
// deadline. Wait for its actual ready state, including on slower native hosts.
async function until(expression,label){const deadline=Date.now()+90000;while(Date.now()<deadline){if(await evaluate(expression))return;await delay(100);}throw Error(`Timed out: ${label}; UI: ${await evaluate('document.querySelector("#workbench")?.innerText')}`);}
async function click(selector){await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control: '+${JSON.stringify(selector)});e.scrollIntoView({block:'center'});e.click();})()`);}

async function textButton(text){const selector=await evaluate(`(()=>{const es=Array.from(document.querySelectorAll('#workbench button'));const e=es.find(e=>e.textContent===${JSON.stringify(text)});if(!e)throw Error('Button missing');e.setAttribute('data-smoke-target','1');return '[data-smoke-target="1"]'})()`);await click(selector);await evaluate(`document.querySelector('[data-smoke-target="1"]')?.removeAttribute('data-smoke-target')`);}
async function fill(name,value){await evaluate(`(()=>{const e=document.querySelector('#wb-'+${JSON.stringify(name)});e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function ready(){await until(`document.querySelector('#workbench')?.getAttribute('aria-busy')==='false'`,'workbench ready');const error=await evaluate(`document.querySelector('.wb-notice.wb-error')?.textContent`);if(error)throw Error(error);}
async function shot(name){const {data}=await client.send('Page.captureScreenshot',{format:'png'});writeFileSync(join(evidence,name+'.png'),Buffer.from(data,'base64'));}
async function open(){await click('#menubar .menu-item:nth-child(7)');await click('.dropdown .row[data-index="0"]');await ready();}
async function launch(){child=spawn(exe,[],{cwd:repo,env,windowsHide:true,stdio:'ignore'});client=await connect();await until(`!!window.luunaWorkbench && document.querySelectorAll('#menubar .menu-item').length===10`,'app boot');}
async function stop(){client?.close();if(child&&!child.killed)spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});await delay(800);}
const checks=[];
try {
 await launch();await open();assert(await evaluate(`!!document.querySelector('#wb-initialize')`));assert(!existsSync(join(temp,'data')));await click('#wb-initialize');await ready();checks.push('Opening read-only; explicit initialization');
 await click('#wb-new');await fill('title',"UI ticket <img src=x onerror=alert(1)>");await fill('description',"O'Brien 日本語\nTicket context");await click('#wb-save');await ready();assert.equal(await evaluate(`document.querySelectorAll('.wb-card').length`),1);assert.equal(await evaluate(`document.querySelectorAll('.wb-card img').length`),0);
 await click('.wb-card [data-move="in_progress"]');await ready();assert.equal(await evaluate(`document.querySelectorAll('[data-status="in_progress"] .wb-card').length`),1);await shot('kanban-normal');
 await click('.wb-card > button');await fill('title','Edited UI ticket');await click('#wb-save');await ready();checks.push('Ticket create/edit/move, stored markup stays text');
 await click('#wb-nav-prompts');await ready();await click('#wb-new');await fill('name','ui-review');await fill('description','Native review prompt');await fill('body','Review this module.');await fill('tags','native,test');await click('#wb-save');await ready();assert(await evaluate(`document.querySelector('.wb-body').textContent.includes('Review this module.')`));await click('#wb-edit');await fill('body','Review carefully. 日本語');await click('#wb-save');await ready();assert.equal(await evaluate(`document.querySelectorAll('#wb-history button').length`),2);await shot('prompt-normal');
 await evaluate(`document.querySelector('#input-textarea').value='Existing draft';document.querySelector('#input-textarea').dispatchEvent(new Event('input',{bubbles:true}));`);await click('#wb-insert');assert(await evaluate(`document.querySelector('#workbench').hidden`));assert(await evaluate(`document.querySelector('#input-textarea').value.startsWith(${JSON.stringify('Existing draft\n\n[Beacon ui-review@2]')})`));assert.equal(await evaluate('document.activeElement.id'),'input-textarea');checks.push('Beacon create/edit/history/current render; insertion preserves draft and focuses composer');
 await open();await click('#wb-nav-memory');await ready();await click('#wb-new');await fill('domain','native');await fill('content','Native searchable expertise');await click('#wb-save');await ready();await fill('query','searchable');await click('#wb-search');await ready();assert.equal(await evaluate(`document.querySelectorAll('.wb-card').length`),1);await click('.wb-card > button');await fill('content','Updated native expertise');await click('#wb-save');await ready();await fill('query','');await click('#wb-search');await ready();await shot('memory-normal');
 await client.send('Emulation.setDeviceMetricsOverride',{width:760,height:480,deviceScaleFactor:1,mobile:false});await shot('memory-minimum');await click('#wb-nav-tickets');await ready();await shot('kanban-minimum');await click('#wb-nav-prompts');await ready();await shot('prompt-minimum');assert(await evaluate(`document.querySelector('#workbench').getBoundingClientRect().right<=innerWidth && document.documentElement.scrollWidth<=innerWidth`));await client.send('Emulation.clearDeviceMetricsOverride');
 await click('#wb-nav-memory');await ready();await click('.wb-card > button');await click('#wb-delete');assert(await evaluate(`!!document.querySelector('#wb-confirm-delete')`));await click('#wb-confirm-delete');await ready();assert.equal(await evaluate(`document.querySelectorAll('.wb-card').length`),0);checks.push('Atlas create/search/edit/delete confirmation; all three views at 760x480 and normal');
 // UI error is visible; invalid identifier never becomes successful empty data.
 await click('#wb-new');await fill('domain','../invalid');await fill('content','Bad path');await click('#wb-save');await until(`document.querySelector('#workbench').getAttribute('aria-busy')==='false'`,'validation error');assert(await evaluate(`document.querySelector('.wb-error').textContent.includes('identifier')`));assert.equal(await evaluate('document.activeElement.id'),'wb-content');await evaluate('document.activeElement.blur()');
 await client.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await client.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});assert(await evaluate(`document.querySelector('#workbench').hidden`));checks.push('Errors visible; Escape closes without global command');
 await open();const oldKey=await evaluate('luuna.workbenchStatus().then(r => r.data.projectKey)');
 const initialStats=await evaluate('luuna.getStats()');assert(initialStats.success,initialStats.error);
 const changed=await evaluate(`luuna.changeDirectory(${JSON.stringify(b)})`);assert(changed.success,changed.error);
 await until(`!!document.querySelector('#wb-initialize')`,'new project uninitialized');await ready();
 assert(!await evaluate(`document.querySelector('.wb-body').textContent.includes('Edited UI ticket')`));
 const stale=await evaluate(`luuna.workbenchAction(${JSON.stringify(oldKey)},{op:'tickets'})`);assert(!stale.success);
 await click('#wb-initialize');await ready();assert.equal(await evaluate(`document.querySelectorAll('.wb-card').length`),0);
 await delay(700);const bStats=await evaluate('luuna.getStats()');assert(bStats.success,bStats.error);assert.notEqual(bStats.data.fixturePid,initialStats.data.fixturePid);
 assert(!await evaluate(`document.querySelector('#agent-body').textContent.includes('PI DISCONNECTED')`));
 const back=await evaluate(`luuna.changeDirectory(${JSON.stringify(a)})`);assert(back.success,back.error);
 await until(`document.querySelector('.wb-card')?.textContent.includes('Edited UI ticket')`,'project A restored');await ready();
 await delay(700);const aStats=await evaluate('luuna.getStats()');assert(aStats.success,aStats.error);assert.notEqual(aStats.data.fixturePid,bStats.data.fixturePid);
 assert(!await evaluate(`document.querySelector('#agent-body').textContent.includes('PI DISCONNECTED')`));
 assert.equal(readFileSync(rpc,'utf8').trim().split('\n').map(s=>JSON.parse(s)).filter(r=>r.type==='fixture_launch').length,3);
 checks.push('A-B-A switching preserves isolated records, rejects stale keys, uses exactly one new Pi per switch, and answers real RPC after old EOF');
 await stop();await launch();await open();assert.equal(await evaluate(`document.querySelectorAll('.wb-card').length`),1);assert(await evaluate(`document.querySelector('.wb-card').textContent.includes('Edited UI ticket')`));await click('#wb-nav-prompts');await ready();assert(await evaluate(`document.querySelector('.wb-body').textContent.includes('ui-review')`));checks.push('Fresh process reopens persisted project A tickets/prompts');
 const finalStats=await evaluate('luuna.getStats()');assert(finalStats.success,finalStats.error);
 process.kill(finalStats.data.fixturePid);
 await until(`document.querySelector('#agent-body').textContent.includes('PI DISCONNECTED')`,'active Pi EOF visible');
 const disconnected=await evaluate('luuna.getStats()');assert(!disconnected.success);checks.push('Active-child EOF remains visible and subsequent RPC fails promptly');
 const requests=existsSync(rpc)?readFileSync(rpc,'utf8').trim().split('\n').filter(Boolean).map(s=>JSON.parse(s)):[];assert(!requests.some(r=>r.type==='prompt'));checks.push('Synthetic Pi fixture recorded zero prompt sends');
 writeFileSync(join(evidence,'verification.json'),JSON.stringify({complete:true,platform:process.platform,executable:exe,sha256:createHash('sha256').update(readFileSync(exe)).digest('hex'),syntheticPi:true,checks,screenshots:readdirSync(evidence).filter(f=>/-(normal|minimum)\.png$/.test(f)),disposableRoot:temp},null,2));
 console.log(`Native workbench smoke passed (${checks.length} workflow checks). Evidence: ${evidence}`);
} catch(e){try{await shot('failure');writeFileSync(join(evidence,'failure.txt'),String(e.stack)+'\n'+await evaluate('document.body.innerText'));}catch{}throw e;}finally{await stop();}
