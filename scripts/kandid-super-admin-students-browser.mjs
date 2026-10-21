// Isolated browser fixtures only. All non-local requests are intercepted;
// Supabase DNS is additionally blocked. Never uses an existing browser profile.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,statSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve,sep,extname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import WebSocket from 'ws';
const root=resolve('dist');
const server=createServer((req,res)=>{
  let file=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403).end();return;}
  try{if(!statSync(file).isFile())file=join(root,'index.html');}catch{file=join(root,'index.html');}
  const type={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json','.woff2':'font/woff2'}[extname(file)]||'text/html';
  res.writeHead(200,{'Content-Type':type});res.end(readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,backend='https://fszgdxqxonqqcrzsnkca.supabase.co';
const profile=mkdtempSync(join(tmpdir(),'kandid-sa-students-browser-'));
const chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--host-resolver-rules=MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws,send;
const pending=new Map(),errors=[],requests=[],results=[],localRequests=[];
const user={id:'00000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',email:'synthetic-admin@example.invalid',app_metadata:{provider:'email'},user_metadata:{}};
const admin={id:1,auth_user_id:user.id,full_name:'Synthetic Admin',email:user.email,role:'super_admin',status:'active',organization_id:null};
const term={id:1,academic_year:'2026-2027',semester:'1st Semester',status:'active'};
const organizations=[{id:2,name:'Synthetic Institution',membership_scope:'institution',organization_type:'non_departmental'},{id:3,name:'Synthetic Club',membership_scope:'manual',organization_type:'non_departmental'}];
const students=Array.from({length:12},(_,i)=>({id:i+1,student_number:String(90001+i),first_name:'Synthetic',last_name:`Student ${String(i+1).padStart(2,'0')}`,email:`synthetic-${i+1}@example.invalid`,program:'BSIT',year_level:1,status:['active','pending','disabled'][i%3],identity_linked:i===0,created_at:`2026-10-${String(i+1).padStart(2,'0')}T00:00:00Z`}));
const membership=s=>({student_id:s.id,organization_id:2,academic_term_id:1,membership_status:'active',student:s,organization:organizations[0],program:'BSIT',year_level:1,source:'masterlist'});
let mode='success',serial=0;
try{
  let port;for(let i=0;i<100;i++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break;}catch{await delay(100);}}
  assert.ok(port,'Chrome debugger ready');
  const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method+' / '+JSON.stringify({errors,requests,localRequests:localRequests.slice(-12)})));},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  const fulfill=(id,status,body)=>send('Fetch.fulfillRequest',{requestId:id,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin},{name:'Access-Control-Allow-Headers',value:'authorization,apikey,x-client-info,content-type,x-supabase-api-version'},{name:'Access-Control-Allow-Methods',value:'GET,POST,OPTIONS'}],body:Buffer.from(status===204?'':JSON.stringify(body)).toString('base64')});
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
    if(m.method==='Network.loadingFailed'&&!m.params.canceled&&!m.params.errorText.includes('BLOCKED_BY_CLIENT'))errors.push(m.params.errorText);
    if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value||a.description).join(' '));
    if(m.method==='Fetch.requestPaused')void(async()=>{
      const p=m.params,url=new URL(p.request.url);if(url.origin===origin){localRequests.push(url.pathname);return send('Fetch.continueRequest',{requestId:p.requestId});}
      if(url.origin!==backend)return send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'});
      if(p.request.method==='OPTIONS')return send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:204,responseHeaders:[{name:'Access-Control-Allow-Origin',value:origin},{name:'Access-Control-Allow-Headers',value:Object.entries(p.request.headers).find(([k])=>k.toLowerCase()==='access-control-request-headers')?.[1]||'authorization,apikey,content-type,x-client-info'},{name:'Access-Control-Allow-Methods',value:'GET,POST,OPTIONS'}]});
      const b=p.request.postData?JSON.parse(p.request.postData):{};requests.push({path:url.pathname,...b});
      if(url.pathname==='/auth/v1/user')return fulfill(p.requestId,200,user);
      if(url.pathname.startsWith('/rest/v1/')){
        const table=url.pathname.split('/').pop();const single=Object.entries(p.request.headers).some(([key,v])=>key.toLowerCase()==='accept'&&v.includes('object+json'));
        let rows=table==='admin_users'?[admin]:table==='organizations'?organizations:table==='academic_terms'?[term]:table==='programs'?[{id:1,code:'BSIT',name:'BSIT',is_active:true}]:table==='students'?students:[];
        return fulfill(p.requestId,200,single?rows[0]||null:rows);
      }
      if(url.pathname.endsWith('/super-admin-manual-enrollment')){
        if(b.action==='list_students'){
          if(mode==='missing')return fulfill(p.requestId,404,{error:'not found'});
          if(mode==='denied')return fulfill(p.requestId,403,{error:'not authorized'});
          let rows=mode==='empty'?[]:students.filter(s=>(!b.search||[s.student_number,s.first_name+' '+s.last_name,s.email].some(v=>v.toLowerCase().includes(b.search.toLowerCase())))&&(!b.status||b.status==='all'||s.status===b.status)&&(!b.student_ids||b.student_ids.includes(s.id)));
          rows.sort((a,c)=>b.sort==='id_asc'?a.id-c.id:b.sort==='name_asc'?a.last_name.localeCompare(c.last_name):c.id-a.id);
          return fulfill(p.requestId,200,{data:{data:rows.slice((b.page-1)*b.page_size,b.page*b.page_size),total_count:rows.length}});
        }
        if(b.action==='resolve_student_for_term'){
          const s=students.find(s=>s.student_number===b.student_number);return fulfill(p.requestId,200,{data:{outcome:s?'ALREADY_ENROLLED_CURRENT_TERM':'NEW_STUDENT',student:s,academic_term:term,enrollment:s?{status:'enrolled',source:'masterlist'}:null}});
        }
        if(b.action==='create_new_student_for_term')return fulfill(p.requestId,200,{data:{outcome:'NEW_STUDENT_CREATED',student_status:'pending',academic_term:term}});
        throw Error('Unexpected manual action '+b.action);
      }
      if(url.pathname.endsWith('/organization-eligibility')){
        const rows=students.filter(s=>s.id<=6&&(!b.student_ids||b.student_ids.includes(s.id))).map(membership);
        return fulfill(p.requestId,200,{data:{academic_term:term,organization:organizations[0],count:rows.length,members:rows,memberships:rows}});
      }
      if(url.pathname.endsWith('/super-admin-masterlist-import')){
        assert.equal(b.action,'create_import');assert.equal(b.rows.length,1);assert.equal(b.import_scope,'incremental');
        return fulfill(p.requestId,201,{data:{import:{id:7,academic_term_id:1,import_status:'review'},rows:[],counts:{blocking:0}}});
      }
      if(url.pathname.endsWith('/admin-user-management'))return fulfill(p.requestId,200,{data:{admins:[admin]}});
      return fulfill(p.requestId,200,{data:[],notifications:[]});
    })().catch(e=>{if(!e.message.includes('Invalid InterceptionId'))errors.push(e.message);});
  };
  const value=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  const wait=async expression=>{for(let i=0;i<450;i++){if(await value(expression))return;await delay(100);}throw Error('UI assertion timed out: '+expression+' / '+await value('document.body.innerText.slice(-1400)')+' / '+JSON.stringify({errors,requests,localRequests:localRequests.slice(-20)}));};
  const click=selector=>value(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const type=async(selector,text)=>{await value(`document.querySelector(${JSON.stringify(selector)}).focus();document.querySelector(${JSON.stringify(selector)}).select()`);await send('Input.insertText',{text});};
  const select=async(selector,option)=>value(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(option)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const clickText=text=>value(`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('Button missing');e.click();})()`);
  const noOverflow=async()=>assert.equal(await value('document.documentElement.scrollWidth<=innerWidth'),true,'no horizontal page overflow');
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Network.setCacheDisabled',{cacheDisabled:true});await send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
  const expiry=Math.floor(Date.now()/1000)+3600,enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const token=`${enc({alg:'HS256',typ:'JWT'})}.${enc({...user,sub:user.id,exp:expiry,iat:expiry-3600})}.synthetic-only`;
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.origin===${JSON.stringify(origin)}){localStorage.setItem('user',${JSON.stringify(JSON.stringify(admin))});localStorage.setItem('sb-fszgdxqxonqqcrzsnkca-auth-token',${JSON.stringify(JSON.stringify({access_token:token,refresh_token:'synthetic',expires_at:expiry,expires_in:3600,token_type:'bearer',user}))});localStorage.setItem('kandid-pwa-install-dismissed-until',String(Date.now()+3600000));} window.WebSocket=new Proxy(window.WebSocket,{construct(T,args){if(args[1]==='vite-hmr'){const s=new EventTarget();s.readyState=1;s.send=()=>{};s.close=()=>{};queueMicrotask(()=>s.dispatchEvent(new Event('open')));return s;}return Reflect.construct(T,args);}});`});
  for(const width of [1280,375]){
    console.log('Synthetic browser viewport',width);
    mode='success';await send('Emulation.setDeviceMetricsOverride',{width,height:812,deviceScaleFactor:1,mobile:width<600});await send('Page.navigate',{url:origin+'/super-admin/students'});
    await wait("document.querySelectorAll('.sa-students-record').length>0");await noOverflow();
    const capture=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`.tmp/super-admin-students-${width}.png`,Buffer.from(capture.data,'base64'));
    await clickText('Next');await wait("document.querySelector('.sa-students-page-count')?.textContent==='Page 2 of 2'");await clickText('Previous');await wait("document.querySelector('.sa-students-page-count')?.textContent==='Page 1 of 2'");
    await select('.sa-students-sort select','id_asc');await wait("document.querySelector('.sa-students-record')?.innerText.includes('90001')");
    await clickText('Pending');await wait("document.querySelectorAll('.sa-students-record').length===4");assert.equal(await value("[...document.querySelectorAll('.sa-students-record')].every(e=>e.classList.contains('is-pending'))"),true);
    await clickText('All');await select('.sa-students-control select','2');await wait("document.querySelectorAll('.sa-students-record').length===6");await select('.sa-students-control select','all');await wait("document.querySelectorAll('.sa-students-record').length===10");
    await type('.sa-students-search input','90001');await wait("document.body.innerText.includes('90001') && !document.body.innerText.includes('90002')");await noOverflow();
    if(width===375){await click('.sa-students-mobile-actions-trigger');await clickText('View student');}else await click('[aria-label^="View Synthetic"]');
    await wait("!!document.querySelector('.sa-student-details') && !document.body.innerText.includes('Loading student details')");await noOverflow();assert.equal(await value("document.querySelector('.sa-student-details').innerText.includes('Synthetic Student 01')"),true);
    await click('.sa-student-details header button');await type('.sa-students-search input','');await delay(400);
    await clickText('Add student');await wait("!!document.querySelector('#registration-student-id')");await type('#registration-student-id','90999');await wait("!document.querySelector('.sa-registration-actions button[type=submit]').disabled");await click('.sa-registration-actions button[type=submit]');await wait("!!document.querySelector('#registration-first-name')");
    await type('#registration-first-name','New');await type('#registration-last-name','Synthetic');await type('#registration-program','BSIT');await click('.sa-registration-actions button[type=submit]');await wait("document.querySelector('.sa-registration-review')!==null");await noOverflow();
    await value("for(let i=0;i<3;i++)document.querySelector('.sa-registration-actions button[type=submit]').click()");await wait("document.querySelector('.sa-registration-complete')!==null");await noOverflow();
    await clickText('Back to Students');
    results.push({viewport:width,directory:true,search:true,details:true,manualRegistration:true,overflow:false});
  }
  for(const testMode of ['empty','missing','denied']){
    mode=testMode;await send('Page.navigate',{url:'about:blank'});await send('Page.navigate',{url:origin+'/super-admin/students'});
    await wait(testMode==='empty'?"document.body.innerText.includes('No matching student records')":"document.body.innerText.includes('not deployed') || document.body.innerText.includes('Super Admin authorization')");await noOverflow();results.push({state:testMode,pass:true});
  }
  mode='success';await send('Page.navigate',{url:origin+'/super-admin/csv-import'});await wait("!!document.querySelector('.sa-csv-import-file-action input') && document.querySelector('#academic-term').value==='1'");
  await value(String.raw`(()=>{const f=new File(['student_number,first_name,last_name,program,year_level,email\n90998,CSV,Synthetic,BSIT,1,csv@example.invalid\nBAD,Wrong,ID,BSIT,1,wrong@example.invalid'],'synthetic.csv',{type:'text/csv'});const d=new DataTransfer();d.items.add(f);const e=document.querySelector('.sa-csv-import-file-action input');e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait("document.querySelector('.sa-csv-import-summary')?.innerText.includes('1') && document.body.textContent.includes('CSV Synthetic')");await noOverflow();
  assert.equal(requests.filter(r=>r.path.endsWith('/super-admin-masterlist-import')).length,0,'preview cannot stage automatically');
  assert.equal(requests.filter(r=>r.action==='create_new_student_for_term').length,2,'one synthetic registration per viewport');
  assert.deepEqual(errors,[]);results.push({csvPreview:true,valid:1,invalid:1});
  console.log(JSON.stringify({results,realSupabaseRequests:0,productionWrites:0},null,2));
}finally{
  if(ws?.readyState===WebSocket.OPEN)await Promise.race([send('Browser.close').catch(()=>{}),delay(1000)]);
  for(const p of pending.values())clearTimeout(p.timer);ws?.terminate();chrome.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
