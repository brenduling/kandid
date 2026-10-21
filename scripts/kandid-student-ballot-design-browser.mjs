// Runs the actual localhost:5174 Student route. Every external backend request
// is intercepted with synthetic data; DNS blocks Supabase as a second boundary.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createHmac,randomBytes} from "node:crypto";
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
const origin='http://localhost:5174',backend='https://fszgdxqxonqqcrzsnkca.supabase.co';
const evidence=resolve(process.argv[2]||'.tmp/student-ballot-redesign');mkdirSync(evidence,{recursive:true});
const candidates=[
 {id:1,position_id:1,photo:null,students:{first_name:'Synthetic',last_name:'Candidate 1',photo_url:null},partylists:{name:'Synthetic Party'}},
 {id:2,position_id:1,photo:null,students:{first_name:'Synthetic',last_name:'Candidate 2',photo_url:null},partylists:null},
];
assert.equal(candidates.length,2);
const identity={id:'10000000-0000-4000-8000-000000000101',aud:'authenticated',role:'authenticated',email:'synthetic@example.invalid',app_metadata:{},user_metadata:{},identities:[]};
const profile={id:1,auth_user_id:identity.id,status:'active',role:'student',first_name:'Synthetic',last_name:'Student',student_number:'SYNTHETIC-ONLY',program:'BSIT',year_level:1,is_shs:false,photo_url:null};
const organization={id:2,name:'Synthetic Test Organization',organization_type:'departmental',membership_scope:'program'};
const term={id:1,status:'active',semester:'1st Semester',academic_year:'2026-2027'};
const secret=randomBytes(32);const encoded=[{alg:'HS256',typ:'JWT'},{sub:identity.id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600}].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
const token=encoded+'.'+createHmac('sha256',secret).update(encoded).digest('base64url');
const session={user:identity,access_token:token,refresh_token:'synthetic-unused-refresh',expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer'};
const profileDir=mkdtempSync(join(tmpdir(),'kandid-ballot-visibility-'));
const chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check','--host-resolver-rules=MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND','--remote-debugging-port=0',`--user-data-dir=${profileDir}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws,send,scenario='eligible',candidateCalls=0;const checks=[],unexpected=[],exceptions=[],requests=[],pending=new Map();
const pass=label=>{checks.push(label);console.log('PASS '+label);};
try{
 assert.equal((await fetch(origin,{signal:AbortSignal.timeout(10000)})).ok,true,'Existing localhost:5174 server required');
 let port;for(let n=0;n<150;n++){try{port=Number(readFileSync(join(profileDir,'DevToolsActivePort'),'utf8').split('\n')[0]);break;}catch{}await delay(100);}assert.ok(port);
 const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((a,r)=>{ws.onopen=a;ws.onerror=r;});
 let serial=0;
 ws.onclose=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Isolated browser closed'));}pending.clear();};
 send=(method,params={})=>new Promise((accept,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},120000);pending.set(id,{accept,reject,timer,method});ws.send(JSON.stringify({id,method,params}));});
 const fulfill=(id,status,data,contentType='application/json')=>send('Fetch.fulfillRequest',{requestId:id,responseCode:status,responseHeaders:[{name:'Content-Type',value:contentType},{name:'Access-Control-Allow-Origin',value:origin},{name:'Access-Control-Allow-Headers',value:'authorization,apikey,x-client-info,content-type,accept,accept-profile,content-profile,prefer,range,range-unit,x-retry-count,x-supabase-api-version'},{name:'Access-Control-Allow-Methods',value:'GET,HEAD,POST,OPTIONS'}],body:Buffer.from(typeof data==='string'?data:JSON.stringify(data)).toString('base64')});
 ws.onmessage=({data})=>{const msg=JSON.parse(data);if(msg.id&&pending.has(msg.id)){const p=pending.get(msg.id);pending.delete(msg.id);clearTimeout(p.timer);
  // Navigation may cancel a request while its synthetic response is being
  // fulfilled. The cancelled interception cannot reach the network.
  if(msg.error?.message==='Invalid InterceptionId.'&&p.method==='Fetch.fulfillRequest')p.accept({cancelled:true});
  else msg.error?p.reject(Error(msg.error.message)):p.accept(msg.result);}
  if(msg.method==='Runtime.exceptionThrown')exceptions.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
  if(msg.method!=='Fetch.requestPaused')return;
  void(async()=>{const p=msg.params,u=new URL(p.request.url);
   if(u.origin===origin)return send('Fetch.continueRequest',{requestId:p.requestId});
   if(['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return fulfill(p.requestId,200,'','text/css');
   if(u.origin!==backend){unexpected.push('external '+u.hostname);return send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'});}
   if(p.request.method==='OPTIONS')return fulfill(p.requestId,200,{});
   if(u.pathname==='/auth/v1/user')return fulfill(p.requestId,200,identity);
   const body=JSON.parse(p.request.postData||'{}');
   requests.push(u.pathname+' '+(body.action||''));
   if(u.pathname==='/functions/v1/student-profile'){
    if(body.action==='profile')return fulfill(p.requestId,200,{data:profile});
    if(body.action==='organization_memberships')return fulfill(p.requestId,200,{data:{student_id:1,academic_term:term,enrollment:{academic_term_id:1,enrollment_status:'enrolled'},count:1,memberships:[{organization_id:2,academic_term_id:1,membership_status:'active',organization}]}});
   }
   if(u.pathname==='/functions/v1/student-notifications')return fulfill(p.requestId,200,{data:{notifications:[],read_notification_ids:[],count:0}});
   if(u.pathname==='/functions/v1/vote-access'&&body.action==='student_has_voted')return fulfill(p.requestId,200,{data:{has_voted:scenario==='duplicate'}});
   if(u.pathname==='/functions/v1/vote-access'&&body.action==='student_voted_elections')return fulfill(p.requestId,200,{data:{election_ids:scenario==='duplicate'?[4]:[]}});
   if(u.pathname==='/rest/v1/elections'&&p.request.method==='GET'){
    const now=Date.now(),expired=scenario==='expired';
    const row={id:4,title:'Synthetic Finalized Election',organization_id:2,academic_term_id:1,status:'active',electorate_policy_version:1,electorate_frozen_at:scenario==='unfrozen'?null:new Date(now-7200000).toISOString(),campaign_start:new Date(now-172800000).toISOString(),campaign_end:new Date(now-86400000).toISOString(),start_date:new Date(now-3600000).toISOString(),end_date:new Date(now+(expired?-1000:3600000)).toISOString(),voting_access_mode:'anywhere',organizations:{name:organization.name}};
    return fulfill(p.requestId,200,u.searchParams.get('id')==='eq.4'?row:[row]);
   }
   if(u.pathname==='/rest/v1/positions'&&p.request.method==='GET'){
    assert.equal(u.searchParams.get('status'),'eq.active');return fulfill(p.requestId,200,[{id:1,name:'Chairman',election_id:4,max_votes:1,display_order:1}]);
   }
   if(u.pathname==='/rest/v1/rpc/kandid_get_student_ballot_candidates'){
    assert.deepEqual(body,{p_election_id:4});candidateCalls++;
    if(scenario==='ineligible')return fulfill(p.requestId,403,{code:'42501',message:'Ballot choices are unavailable.'});
    return fulfill(p.requestId,200,scenario==='expired'?[]:candidates);
   }
   unexpected.push(p.request.method+' '+u.pathname+' '+(body.action||''));return send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'});
  })().catch(e=>unexpected.push(e.message));
 };
 await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('user',${JSON.stringify(JSON.stringify(profile))});localStorage.setItem('sb-fszgdxqxonqqcrzsnkca-auth-token',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('kandid-pwa-install-dismissed-until',String(Date.now()+86400000));`});
 const value=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const wait=async expression=>{for(let n=0;n<600;n++){if(await value(expression))return;await delay(100);}throw Error('Browser timeout '+expression+' '+JSON.stringify({unexpected,exceptions,requests,candidateCalls})+' '+(await value("document.body?.innerText || ''")).slice(-1600));};
 const dismiss=()=>value("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Not Now')?.click()");
 const clickChoice=async index=>{
  await value(`document.querySelectorAll('.ballot-choice')[${index}].scrollIntoView({block:'center'})`);await delay(100);
  const point=await value(`(()=>{const b=document.querySelectorAll('.ballot-choice')[${index}],r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return {x,y,hit:b.contains(document.elementFromPoint(x,y))};})()`);
  assert.ok(point.hit,'Ballot choice must be unobscured and physically clickable');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:point.x,y:point.y});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:point.x,y:point.y});
 };
 for(const width of [1280,768,375]){
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===375});
  scenario='eligible';await send('Page.navigate',{url:origin+'/student/vote/4'});await wait("document.querySelectorAll('.ballot-choice').length===3");await dismiss();
  assert.equal(await value("document.querySelector('.student-ballot-header h1').textContent"),'Cast Your Vote');
  await value("document.querySelector('.student-ballot-review-button').click()");
  await wait("document.querySelector('#kandid-prompt-title')?.textContent==='Incomplete Ballot'");
  await value("document.querySelector('[aria-label=\"Close dialog\"]').click()");
  await wait("!document.querySelector('#kandid-prompt-title')");
  pass(width+'px: incomplete ballot still requires a candidate or abstention');
  for(let n=0;n<2;n++){
   await clickChoice(n);
   assert.equal(await value(`document.querySelectorAll('.ballot-choice')[${n}].getAttribute('aria-pressed')`),'true');
   assert.equal(await value("document.querySelectorAll('.ballot-choice[aria-pressed=true]').length"),1);
  }
  await clickChoice(2);assert.equal(await value("document.querySelectorAll('.ballot-choice')[2].getAttribute('aria-pressed')"),'true');
  await value("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Review Ballot').click()");
  await wait("document.querySelector('#kandid-prompt-title')?.textContent==='Review Your Ballot'");
  assert.match(await value("document.querySelector('#kandid-prompt-description').textContent"),/Chairman\s*Abstain/);
  assert.equal(await value("document.querySelector('.config-footer .primary-btn').textContent"),'Submit My Vote');
  assert.equal(await value("document.querySelector('.config-footer .secondary-btn').textContent"),'Change Selection');
  assert.match(await value("document.querySelector('#kandid-prompt-description').textContent"),/ballot cannot be changed/);
  assert.match(await value("document.querySelector('#kandid-prompt-description').textContent"),/Blockchain verification may still be pending/);
  const reviewLayout=await value("(()=>{const d=document.querySelector('[role=dialog]'),r=d.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,height:r.height,viewport:innerHeight,radius:getComputedStyle(d).borderRadius,shadow:getComputedStyle(d).boxShadow,scroll:d.scrollWidth,client:d.clientWidth};})()");
  assert.equal(reviewLayout.radius,'0px');assert.equal(reviewLayout.shadow,'none');
  assert.ok(reviewLayout.left>=0&&reviewLayout.right<=reviewLayout.width&&reviewLayout.height<=reviewLayout.viewport&&reviewLayout.scroll<=reviewLayout.client+1,JSON.stringify(reviewLayout));
  await delay(350);
  const reviewShot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(evidence,'review-'+width+'.png'),Buffer.from(reviewShot.data,'base64'));
  pass(width+'px: structured review, immutable submission notice, pending anchoring wording and sharp dialog fit');

  await value("document.querySelector('.config-footer .secondary-btn').click()");
  await wait("!document.querySelector('#kandid-prompt-title')");
  assert.equal(await value("document.querySelector('.student-ballot-abstain').getAttribute('aria-pressed')"),'true');
  await clickChoice(0);
  await value("document.querySelector('.student-ballot-review-button').click()");
  await wait("document.querySelector('#kandid-prompt-title')?.textContent==='Review Your Ballot'");
  assert.equal(await value("document.querySelector('.student-ballot-review-choice').textContent"),candidates[0].students.first_name+' '+candidates[0].students.last_name);
  await value("document.querySelector('.config-footer .secondary-btn').click()");
  await wait("!document.querySelector('#kandid-prompt-title')");
  await wait("document.querySelectorAll('.ballot-choice').length===3");
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  const design=await value("(()=>{const b=document.querySelector('.ballot-choice'),t=document.querySelector('.student-ballot-header h1'),p=document.querySelector('.student-ballot-position h2');b.focus();return {radius:getComputedStyle(b).borderRadius,filter:getComputedStyle(document.querySelectorAll('.ballot-choice')[1]).filter,opacity:getComputedStyle(document.querySelectorAll('.ballot-choice')[1]).opacity,title:parseFloat(getComputedStyle(t).fontSize),position:parseFloat(getComputedStyle(p).fontSize),focus:getComputedStyle(b).outlineStyle,state:b.querySelector('.student-ballot-choice-state').textContent};})()");
  assert.equal(design.radius,'0px');assert.equal(design.filter,'none');assert.equal(design.opacity,'1');assert.ok(design.title>design.position);assert.equal(design.focus,'solid');assert.equal(design.state,'Selected');
  pass(width+'px: Change Selection preserves choice, candidate review is accurate, focus is visible and unselected choices stay legible');
  const layout=await value("(()=>{const b=document.querySelectorAll('.ballot-choice')[2];b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {page:document.documentElement.scrollWidth,width:innerWidth,choiceVisible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};})()");
  assert.ok(layout.page<=layout.width+1&&layout.choiceVisible,JSON.stringify(layout));
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(evidence,'ballot-'+width+'.png'),Buffer.from(shot.data,'base64'));
  pass(width+'px: two candidate cards, one-of-one selection, abstention and review work without submission or overflow');
  scenario='unfrozen';const before=candidateCalls;await send('Page.reload',{ignoreCache:true});await wait("document.body?.innerText.includes('has not finalized')");assert.equal(candidateCalls,before);assert.equal(await value("document.querySelectorAll('.ballot-choice').length"),0);pass(width+'px: unfrozen electorate explains finalization and exposes no choices');
  scenario='ineligible';await send('Page.reload',{ignoreCache:true});await wait("document.body?.innerText.includes('not available to this student account')");assert.equal(await value("document.querySelectorAll('.ballot-choice').length"),0);pass(width+'px: authorized RPC 403 cannot expose candidates or abstention');
  scenario='duplicate';const prior=candidateCalls;await send('Page.reload',{ignoreCache:true});await wait("document.body?.innerText.includes('Vote already recorded')");assert.equal(candidateCalls,prior);assert.equal(await value("document.querySelectorAll('.ballot-choice').length"),0);pass(width+'px: existing vote prevents ballot selection and candidate retrieval');
  scenario='expired';await send('Page.reload',{ignoreCache:true});await wait("document.body?.innerText.includes('Voting not available')");assert.equal(await value("document.querySelectorAll('.ballot-choice').length"),0);pass(width+'px: expired election remains unavailable');
 }
 assert.deepEqual(exceptions,[]);assert.deepEqual(unexpected,[]);
 const result={result:'PASS',checks:checks.length,details:checks,candidateSource:'Synthetic UI fixtures matching the authorized ballot RPC shape',officialBackendRequests:0,productionMutations:0,ballotSubmissions:0};writeFileSync(join(evidence,'browser-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
 if(ws?.readyState===WebSocket.OPEN){await Promise.race([send('Browser.close').catch(()=>{}),delay(3000)]);ws.close();}
 for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Isolated browser cleanup'));}pending.clear();
 if(chrome.exitCode===null)chrome.kill();chrome.unref();
}
