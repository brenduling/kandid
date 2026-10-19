// Actual shared publication component + confirmation UI, synthetic transport.
// This is browser component acceptance, not an authenticated production test.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const origin='http://127.0.0.1:5197',out='deploy/election-campaign-publication-review';
const profile=mkdtempSync(join(tmpdir(),'kandid-publication-component-'));
const review={contract_version:1,election_id:3,publication_status:'draft',total_candidates:3,eligible_candidates:2,published_candidates:0,draft_candidates:2,hidden_candidates:1,invalid_candidates:0,issues:[],can_publish:true,roster_fingerprint:'a'.repeat(32)};
const clientCode=`window.fixture={state:${JSON.stringify(review)},calls:[],fail:false,readsFail:false};
export const supabase={auth:{getUser:async()=>({data:{user:{id:'synthetic-admin'}}})},rpc(name,args){
 const f=window.fixture;f.calls.push({name,args});
 const result=(async()=>{if(f.readsFail&&name.startsWith('kandid_get_'))return {error:{code:'PGRST202'}};
 if(name==='kandid_publish_election_campaigns_v1'){if(f.fail)return {error:{code:'42501',message:'Denied'}};
 f.state={...f.state,publication_status:'published',published_candidates:2,draft_candidates:0,can_publish:false,confirmed:true,updated_candidates:2,roster_fingerprint:'b'.repeat(32)};}
 return {data:structuredClone(f.state)};})();result.retry=()=>result;return result;}};`;
const harness=`import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';
import {PromptProvider} from '/src/context/PromptContext.jsx';import Publication from '/src/components/ElectionCampaignPublication.jsx';
import '/src/index.css';import '/src/pages/board/Candidates.css';
createRoot(document.getElementById('root')).render(React.createElement(BrowserRouter,null,React.createElement(PromptProvider,null,React.createElement('main',{style:{padding:16,maxWidth:1000,margin:'auto'}},React.createElement(Publication,{electionId:3,revision:1})))));`;
const server=await createServer({configFile:false,envFile:false,root:resolve('.'),
 cacheDir:join(profile,'vite-cache'),define:{'import.meta.env.VITE_ENABLE_CANDIDATE_MANAGEMENT':'"true"'},
 optimizeDeps:{noDiscovery:true,include:['react','react-dom/client','react-router-dom','framer-motion','lucide-react']},
 server:{host:'127.0.0.1',port:5197,strictPort:true},plugins:[react(),{
 name:'isolated-publication-fixture',resolveId(source,importer){if(source==='../lib/supabaseClient'&&importer?.endsWith('/ElectionCampaignPublication.jsx'))return '\0fixture-client';if(source==='/publication-fixture.jsx')return '\0fixture-entry.jsx';},
 load(id){if(id==='\0fixture-client')return clientCode;if(id==='\0fixture-entry.jsx')return harness;},
 configureServer(s){s.middlewares.use((req,res,next)=>{if(req.url?.split('?')[0]==='/board/candidates'){void s.transformIndexHtml(req.url,'<div id="root"></div><script type="module" src="/publication-fixture.jsx"></script>').then(html=>{res.setHeader('Content-Type','text/html');res.end(html);}).catch(next);}else next();});}
 }]});
let browser,ws;const results=[],exceptions=[],blocked=[];
try{
 await server.listen();
 browser=spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',[
  '--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-allow-origins=*',
  '--host-resolver-rules=MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND',
  '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;for(let i=0;i<70;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break;}catch{await delay(100);}}
 assert.ok(port,'Fresh isolated browser debugger unavailable; no repeated CDP attempts');
 const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((yes,no)=>{ws.onopen=yes;ws.onerror=no;});
 let serial=0;const pending=new Map();
 const send=(method,params={})=>new Promise((yes,no)=>{const id=++serial;pending.set(id,{yes,no});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.delete(id))no(Error(`Browser timeout: ${method}`));},12000).unref();});
 ws.onmessage=({data})=>{const message=JSON.parse(data);if(message.id&&pending.has(message.id)){const item=pending.get(message.id);pending.delete(message.id);message.error?item.no(Error(message.error.message)):item.yes(message.result);}
  if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails.text);
  if(message.method==='Fetch.requestPaused'){const p=message.params,url=new URL(p.request.url);const continuation=url.origin===origin||url.protocol==='data:'?send('Fetch.continueRequest',{requestId:p.requestId}):(blocked.push(url.origin),send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'}));void continuation.catch(error=>exceptions.push('Browser interception: '+error.message));}
 };
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value;};
 const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Browser state unavailable: '+expression);};
 const click=label=>evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.trim()===${JSON.stringify(label)}&&!x.disabled);if(!b)throw Error('Missing enabled button');b.click();})()`);
 await send('Runtime.enable');await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 for(const width of [375,820,1440]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:950,deviceScaleFactor:1,mobile:width===375});
  await send('Page.navigate',{url:origin+'/board/candidates'});
  await wait("window.fixture&&!!document.querySelector('.election-campaign-publication-summary')");
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,`${width}px overflow`);
  await click('Publish All Campaigns');await wait("document.body.textContent.includes('Publish all eligible campaigns?')");
  await click('Cancel');await delay(100);
  assert.equal(await evaluate("fixture.calls.filter(x=>x.name.startsWith('kandid_publish_')).length"),0);
  await click('Publish All Campaigns');await wait("document.body.textContent.includes('Publish all eligible campaigns?')");
  await evaluate("Array.from(document.querySelectorAll('button')).filter(x=>x.textContent.trim()==='Publish All Campaigns').at(-1).click()");
  await wait("document.body.textContent.includes('All eligible campaigns are published.')");
  assert.equal(await evaluate("fixture.calls.filter(x=>x.name.startsWith('kandid_publish_')).length"),1);
  assert.equal(await evaluate("document.querySelector('.election-campaign-publication-summary').textContent.includes('Published')"),true);
  results.push({name:`${width}px review, confirmation, Cancel zero writes, one publish, persisted status, no overflow`,status:'PASS'});
 }
 await send('Page.navigate',{url:origin+'/board/candidates'});await wait("!!document.querySelector('.election-campaign-publication-summary')");
 await evaluate('fixture.fail=true');await click('Publish All Campaigns');await wait("document.body.textContent.includes('Publish all eligible campaigns?')");
 await evaluate("Array.from(document.querySelectorAll('button')).filter(x=>x.textContent.trim()==='Publish All Campaigns').at(-1).click()");
 await wait("!!document.querySelector('.election-campaign-publication-error')");
 assert.equal(await evaluate("document.querySelector('.election-campaign-publication-summary').textContent.includes('Draft')"),true);
 assert.equal(await evaluate("document.body.textContent.includes('All eligible campaigns are published.')"),false);
 results.push({name:'Failed write retains Draft, displays permission error and permits read-only Retry',status:'PASS'});
 await evaluate('fixture.readsFail=true');await click('Retry review');await wait("document.body.textContent.includes('backend is not installed')");
 assert.equal(await evaluate("document.querySelector('.election-campaign-publication-heading button').disabled"),true);
 results.push({name:'Unavailable backend fails closed with Retry and no false empty roster',status:'PASS'});
 assert.deepEqual(exceptions,[]);
 mkdirSync(out,{recursive:true});writeFileSync(`${out}/BROWSER_ACCEPTANCE.json`,JSON.stringify({status:'PASS',scope:'Shared actual component and PromptProvider; synthetic intercepted transport, not production session',results,exceptions,blocked_external_origins:[...new Set(blocked)],production_requests:0},null,2));
 console.log(JSON.stringify({status:'PASS',journeys:results.length,production_requests:0}));
}catch(error){mkdirSync(out,{recursive:true});writeFileSync(`${out}/BROWSER_ACCEPTANCE.json`,JSON.stringify({status:'BLOCKED',results,error:error.message,exceptions},null,2));throw error;}
finally{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify({id:999999,method:'Browser.close'}));ws?.close();browser?.kill();await server.close();}
