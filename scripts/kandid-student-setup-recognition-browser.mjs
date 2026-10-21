// Isolated Chrome, synthetic responses only. DNS also blocks Supabase as a
// second safeguard. The actual local release flag/environment is never changed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const origin="http://localhost:5174";
const artifactDirectory=process.env.KANDID_RECOGNITION_ARTIFACT_DIR || ".tmp";
mkdirSync(artifactDirectory,{recursive:true});
const profile=mkdtempSync(join(tmpdir(),"kandid-recognition-browser-"));
const chrome=spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",[
  "--headless=new","--disable-gpu","--disable-extensions","--disable-background-networking","--no-first-run","--no-default-browser-check",
  "--host-resolver-rules=MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND",
  "--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank",
],{windowsHide:true,stdio:"ignore"});
let ws,send,stopBrowser;
const results=[];
try {
  let port;
  for(let n=0;n<100;n++){try{port=Number(readFileSync(join(profile,"DevToolsActivePort"),"utf8").split("\n")[0]);break;}catch{await delay(100);}}
  assert.ok(port,"Chrome debugger available");
  const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:"PUT"})).json();
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((accept,reject)=>{ws.onopen=accept;ws.onerror=reject;});
  let serial=0,mode="success";
  const pending=new Map(),requests=[],errors=[],localFailures=[],localPaths=[];
  const user={id:"00000000-0000-4000-8000-000000000042",aud:"authenticated",role:"authenticated",email:"synthetic@example.invalid",email_confirmed_at:"2026-10-17T00:00:00Z",app_metadata:{provider:"email",providers:["email"]},user_metadata:{},identities:[]};
  const details={student_number:"9090909090",full_name:"Synthetic Student",program:"BSIT",year_level:1};
  let authReads=0;
  const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const expiry=Math.floor(Date.now()/1000)+3600;
  const token=`${encode({alg:"HS256",typ:"JWT"})}.${encode({...user,sub:user.id,exp:expiry,iat:expiry-3600})}.${Buffer.from("synthetic-only-signature").toString("base64url")}`;
  const session={access_token:token,refresh_token:"synthetic-refresh",expires_in:3600,expires_at:expiry,token_type:"bearer"};
  send=(method,params={})=>new Promise((accept,reject)=>{
    const id=++serial;
    const timer=setTimeout(()=>{if(pending.delete(id))reject(Error("Browser command timeout: "+method));},30000);
    pending.set(id,{accept,reject,timer});ws.send(JSON.stringify({id,method,params}));
  });
  stopBrowser=async()=>{
    if(ws.readyState===WebSocket.OPEN)await Promise.race([send("Browser.close").catch(()=>{}),delay(1500)]);
    for(const item of pending.values())clearTimeout(item.timer);
    pending.clear();
    ws.terminate();
  };
  const fulfill=(requestId,status,body,type="application/json")=>send("Fetch.fulfillRequest",{
    requestId,responseCode:status,responseHeaders:[{name:"Content-Type",value:type},{name:"Access-Control-Allow-Origin",value:origin},{name:"Access-Control-Allow-Headers",value:"authorization,apikey,x-client-info,content-type,x-supabase-api-version,x-retry-count"},{name:"Access-Control-Allow-Methods",value:"POST,GET,OPTIONS"}],
    body:Buffer.from(status===204?"":type==="application/json"?JSON.stringify(body):body).toString("base64"),
  });
  ws.onmessage=({data})=>{
    const message=JSON.parse(data);
    if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(Error(message.error.message)):p.accept(message.result);}
    if(message.method==="Runtime.exceptionThrown")errors.push(message.params.exceptionDetails.exception?.description?.split("\n")[0] || message.params.exceptionDetails.text);
    if(message.method==="Network.responseReceived" && message.params.response.status>=400 && message.params.response.url.startsWith(origin)) localFailures.push({path:new URL(message.params.response.url).pathname,status:message.params.response.status});
    if(message.method==="Fetch.requestPaused")void(async()=>{
      const p=message.params,url=new URL(p.request.url);
      if(url.origin===origin){localPaths.push(url.pathname);
        if(url.pathname.replace(/\.js$/,"")==="/src/utils/studentAccountSetupFeatureGate")return fulfill(p.requestId,200,`export const isStudentAccountSetupEnabled=()=>true;export const isVerifiedStudentSetupEnabled=()=>${mode!=="disabled"};`,"text/javascript");
        return send("Fetch.continueRequest",{requestId:p.requestId});
      }
      if(url.origin!=="https://fszgdxqxonqqcrzsnkca.supabase.co")return send("Fetch.failRequest",{requestId:p.requestId,errorReason:"BlockedByClient"});
      if(p.request.method==="OPTIONS")return fulfill(p.requestId,204,null);
      const body=p.request.postData?JSON.parse(p.request.postData):{};
      requests.push({path:url.pathname,action:body.action,hasPassword:Object.hasOwn(body,"password")});
      if(url.pathname.endsWith("/resolve-student-login")){
        assert.equal(body.student_number,details.student_number);
        assert.equal(Object.hasOwn(body,"registered_email"),false);assert.equal(Object.hasOwn(body,"email"),false);assert.equal(Object.hasOwn(body,"password"),false);
        if(body.action==="inspect_setup") {
          if(mode==="lookup-rate-limit")return fulfill(p.requestId,429,{data:{authenticated:false}});
          if(mode==="lookup-authorization")return fulfill(p.requestId,401,{data:{authenticated:false}});
          if(mode==="lookup-service")return fulfill(p.requestId,503,{error:"Temporarily unavailable"});
          if(mode==="lookup-transport")return send("Fetch.failRequest",{requestId:p.requestId,errorReason:"ConnectionClosed"});
          if(mode==="unknown")return fulfill(p.requestId,404,{error:"Student details are unavailable for setup."});
          if(mode==="old-v8-inspect")return fulfill(p.requestId,200,{data:{verification_required:true,student_details:{student_number:details.student_number,details_verified:false}}});
          return fulfill(p.requestId,200,{data:{recognition_version:2,student_number:details.student_number,student_details:{full_name:details.full_name,program:details.program,year_level:details.year_level,...(mode==="overbroad-inspect"?{email:user.email}:{})}}});
        }
        if(body.action==="begin_access" && mode==="request-limited")return fulfill(p.requestId,429,{data:{verification_requested:false}});
        if(body.action==="begin_access")return fulfill(p.requestId,202,{data:{verification_requested:true,delivery_confirmed:false,retry_after_seconds:60}});
        assert.equal(body.action,"verify_access");
        if(["incorrect","expired"].includes(mode))return fulfill(p.requestId,401,{data:{authenticated:false}});
        if(mode==="read-failure")return fulfill(p.requestId,503,{code:"setup_recognition_unavailable"});
        return fulfill(p.requestId,200,{data:{authenticated:true,session,setup_verification:mode==="old-v8-proof"?undefined:{contract_version:2,student_number:mode==="wrong-id"?"700002":details.student_number,auth_user_id:mode==="foreign-proof"?"foreign-auth":user.id,account_state:mode==="existing"?"active":"pending"}}});
      }
      if(url.pathname==="/auth/v1/user"){
        assert.equal(p.request.method,"GET","no direct password writes are permitted");
        authReads++;
        if(authReads===3 && ["session-change","session-expiry"].includes(mode)) {
          await value(mode==="session-change"
            ? "(async()=>{const {supabase}=await import('/src/lib/supabaseClient.js');await supabase.auth._notifyAllSubscribers('SIGNED_OUT',null);})()"
            : `(async()=>{const {supabase}=await import('/src/lib/supabaseClient.js');await supabase.auth._notifyAllSubscribers('TOKEN_REFRESHED',{user:${JSON.stringify(user)},expires_at:Math.floor(Date.now()/1000)-1});})()`);
        }
        return fulfill(p.requestId,200,user);
      }
      if(url.pathname==="/auth/v1/logout")return fulfill(p.requestId,204,null);
      if(url.pathname.endsWith("/link-student-identity")){
        assert.equal(body.student_number,details.student_number);assert.equal(body.setup_mode,true);assert.equal(body.password,"SyntheticSetup!123");
        assert.equal(requests.filter(r=>r.action==="verify_access").length,1);
        if(mode==="link-failure")return fulfill(p.requestId,403,{error:"Synthetic linking failure"});
        return fulfill(p.requestId,200,{linked:true,student:{id:42,student_number:details.student_number,status:"active"}});
      }
      // Empty synthetic notification/catalog responses; no real request passes.
      if(url.pathname.endsWith("/student-profile"))return fulfill(p.requestId,403,{error:"Synthetic pending profile"});
      if(url.pathname.endsWith("/student-notifications"))return fulfill(p.requestId,200,{data:{notifications:[]}});
      throw Error("Unexpected backend path in synthetic test");
    })().catch(e=>{if(!/Invalid InterceptionId/.test(e.message))errors.push(e.message);});
  };
  const value=async expression=>{const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error("Browser expression failed");return r.result?.value;};
  const wait=async expression=>{for(let n=0;n<300;n++){if(await value(expression))return;await delay(100);}console.log({errors,localFailures,requests,localPaths:localPaths.slice(-30),inputs:await value("[...document.querySelectorAll('input')].map(e=>({id:e.id,autocomplete:e.autocomplete}))"),location:await value("({url:location.href,ready:document.readyState,html:document.documentElement.outerHTML.slice(0,300)})")});throw Error("UI did not reach expected state: "+mode+" / "+await value("document.body.innerText.slice(-1200)"));};
  const click=selector=>value(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const type=async(selector,text)=>{if(!await value(`!!document.querySelector(${JSON.stringify(selector)})`))console.log({mode,selector,ui:await value("({path:location.pathname,text:document.body.innerText.slice(-1500)})"),errors});assert.equal(await value(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.focus();e.select();return true;})()`),true);await send("Input.insertText",{text});await delay(60);};
  const emailAbsent=async()=>assert.equal(await value("!document.body.textContent.includes('synthetic@example.invalid') && !document.body.textContent.includes('synthetic@') && !document.querySelector('input[type=email]')"),true);
  const privateAbsent=async()=>{assert.equal(await value("document.querySelector('#student-setup-new-password')===null && !document.body.textContent.includes('Synthetic Student')"),true);await emailAbsent();};
  const noOverflow=async()=>{
    assert.equal(await value("document.documentElement.scrollWidth <= window.innerWidth"),true);
    assert.equal(await value("[...document.querySelectorAll('.student-setup-stage .student-auth-setup-link')].every(e=>getComputedStyle(e).borderRadius==='0px')"),true);
  };
  const screenshot=async name=>{
    const metrics=await send("Page.getLayoutMetrics");
    const image=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:true,
      clip:{x:0,y:0,width:metrics.cssContentSize.width,height:metrics.cssContentSize.height,scale:1}});
    writeFileSync(join(artifactDirectory,`student-recognition-${name}.png`),Buffer.from(image.data,"base64"));
  };
  await send("Page.enable");await send("Runtime.enable");await send("Network.enable");
  // Test-profile-only: prevent Vite HMR/full reloads from unrelated local edits
  // interrupting a synthetic OTP journey. Application modules remain real.
  await send("Page.addScriptToEvaluateOnNewDocument",{source:`
    try { if(location.origin==='http://localhost:5174')localStorage.setItem('kandid-pwa-install-dismissed-until',String(Date.now()+3600000)); } catch {}
    window.WebSocket=new Proxy(window.WebSocket,{construct(Target,args){
      if(args[1]==='vite-hmr'){
        const socket=new EventTarget();socket.readyState=1;socket.send=()=>{};socket.close=()=>{};
        queueMicrotask(()=>socket.dispatchEvent(new Event('open')));return socket;
      }
      return Reflect.construct(Target,args);
    }});
  `});
  await send("Network.setCacheDisabled",{cacheDisabled:true});
  await send("Fetch.enable",{patterns:[{urlPattern:"*",requestStage:"Request"}]});
  const scenarios=[{mode:"success",width:1280},{mode:"success",width:768},...["success","disabled","unknown","old-v8-inspect","overbroad-inspect","lookup-rate-limit","lookup-authorization","lookup-service","lookup-transport","incorrect","expired","request-limited","read-failure","old-v8-proof","wrong-id","foreign-proof","existing","change-id","session-change","session-expiry","refresh","link-failure"].map(mode=>({mode,width:375}))];
  for(const scenario of scenarios){
    mode=scenario.mode;requests.length=0;authReads=0;console.log("Scenario",mode,scenario.width);
    if(results.length)await send("Page.navigate",{url:"about:blank"});
    await send("Storage.clearDataForOrigin",{origin,storageTypes:"all"});
    await send("Emulation.setDeviceMetricsOverride",{width:scenario.width,height:812,deviceScaleFactor:1,mobile:scenario.width<600});
    const navigation=await send("Page.navigate",{url:origin+"/student-setup"});assert.ok(!navigation.errorText);
    await wait("!!document.querySelector('#student-setup-student-id')");
    if(mode==="disabled"){
      assert.equal(await value("document.querySelector('.student-setup-lookup .student-auth-submit').disabled"),true);
      assert.equal(requests.filter(r=>r.action==="inspect_setup").length,0);
    }else{
      await type("#student-setup-student-id",details.student_number);
      await click(".student-setup-lookup .student-auth-submit");
      if(["unknown","old-v8-inspect","overbroad-inspect","lookup-rate-limit","lookup-authorization","lookup-service","lookup-transport"].includes(mode)){
        await wait("!!document.querySelector('[role=alert]')");await privateAbsent();
        const expected={unknown:"Student details unavailable","old-v8-inspect":"Setup compatibility issue","overbroad-inspect":"Setup compatibility issue","lookup-rate-limit":"Too many Student ID checks","lookup-authorization":"Student ID check denied","lookup-service":"Student ID service unavailable","lookup-transport":"Student ID response interrupted"}[mode];
        assert.equal(await value(`document.querySelector('[role=alert] strong').textContent === ${JSON.stringify(expected)}`),true);
        assert.equal(requests.filter(r=>r.action==="inspect_setup").length,1);
        assert.equal(requests.filter(r=>r.action==="begin_access").length,0);
      }else{
        await wait("!!document.querySelector('#student-setup-confirm-details')");
        assert.deepEqual(await value("[...document.querySelectorAll('.student-setup-identity dt')].map(e=>e.textContent)"),["Student full name","Program","Year level"]);
        assert.deepEqual(await value("[...document.querySelectorAll('.student-setup-identity dd')].map(e=>e.textContent)"),[details.full_name,details.program,String(details.year_level)]);
        assert.equal(await value("!document.querySelector('.student-setup-identity input,.student-setup-identity select,.student-setup-identity textarea') && !document.querySelector('#student-setup-new-password')"),true);
        await emailAbsent();await noOverflow();
        await wait("Math.abs(document.querySelector('#student-setup-confirm-details').getBoundingClientRect().height-20)<0.1");
        assert.equal(await value("document.querySelector('.student-setup-stage > .student-auth-submit').disabled"),true);
        await click(".student-setup-stage > .student-auth-submit");
        assert.equal(await value("!document.querySelector('#student-setup-new-password')"),true,"confirmation is required");
        if(mode==="success")await screenshot(`confirm-${scenario.width}`);
        await click("#student-setup-confirm-details");await click(".student-setup-stage > .student-auth-submit");
        await wait("!!document.querySelector('#student-setup-new-password')");
        await type("#student-setup-new-password","SyntheticSetup!123");await type("#student-setup-confirm-password","SyntheticSetup!123");
        assert.equal(requests.some(r=>r.hasPassword),false,"password is not submitted during configuration");
        assert.equal(await value("[...Object.values(localStorage),...Object.values(sessionStorage)].every(v=>!String(v).includes('SyntheticSetup!123'))"),true);
        await emailAbsent();await noOverflow();
        if(mode==="success" && scenario.width===375)await screenshot("password-375");
        if(mode==="change-id"){
          await click(".student-setup-activation > .student-auth-setup-link");
          await wait("!!document.querySelector('#student-setup-confirm-details')");
          assert.equal(await value("document.querySelector('#student-setup-confirm-details').checked"),false);
          await click(".student-setup-stage > .student-auth-setup-link");await wait("!!document.querySelector('#student-setup-student-id')");await privateAbsent();
        }else if(mode==="refresh"){
          await send("Page.reload",{ignoreCache:true});await wait("!!document.querySelector('#student-setup-student-id')");await privateAbsent();
          assert.equal(requests.filter(r=>r.action==="begin_access").length,0);
        }else{
          await click(".student-setup-activation .student-auth-submit");
          if(mode==="request-limited"){
            await wait("!!document.querySelector('[role=alert]')");
            assert.equal(await value("!document.querySelector('[data-student-otp-index]') && document.querySelector('.student-setup-activation .student-auth-submit').disabled"),true);
          }else{
            await wait("document.querySelectorAll('[data-student-otp-index]').length===6");
            assert.equal(await value("!document.querySelector('#student-setup-new-password') && document.querySelector('.student-otp-actions button').disabled"),true);
            assert.equal(requests.some(r=>r.hasPassword),false);await emailAbsent();
            for(let n=0;n<6;n++)await type(`[data-student-otp-index='${n}']`,String(n));
            await value("for(let n=0;n<5;n++)document.querySelector('.student-setup-verify .student-auth-submit').click()");
            if(["incorrect","expired","read-failure","old-v8-proof","wrong-id","foreign-proof","session-change","session-expiry","link-failure"].includes(mode)){
              await wait("!!document.querySelector('[role=alert]')");await delay(250);
              assert.equal(requests.filter(r=>r.action==="verify_access").length,1);
              assert.equal(requests.filter(r=>r.action==="begin_access").length,1);
              assert.equal(requests.filter(r=>r.path.endsWith('/link-student-identity')).length,mode==="link-failure"?1:0);
              if(["session-change","session-expiry"].includes(mode))await privateAbsent();
            }else if(mode==="existing"){
              await wait("document.body.textContent.includes('already active')");
              assert.equal(requests.filter(r=>r.path.endsWith('/link-student-identity')).length,0);
            }else{
              await wait("document.body.textContent.includes('Account Successfully Registered')");
              assert.equal(requests.filter(r=>r.path.endsWith('/link-student-identity')).length,1);
              assert.equal(requests.filter(r=>r.action==="verify_access").length,1);
              await click(".student-setup-success .student-auth-submit");await wait("location.pathname==='/student-login'");
            }
          }
        }
      }
    }
    await emailAbsent();await noOverflow();results.push({scenario:mode,width:scenario.width,status:"PASS"});
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({results,realSupabaseRequests:0,realEmails:0,realAccountsCreated:0},null,2));
}finally{
  await stopBrowser?.();
  if(!stopBrowser)ws?.terminate();
  if(chrome.exitCode===null)chrome.kill();
  chrome.unref();
}
