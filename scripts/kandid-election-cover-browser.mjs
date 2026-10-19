// Actual localhost Elections route with synthetic Auth/data. Every
// backend response is intercepted; Supabase DNS is blocked as a backstop.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const origin = "http://localhost:5174", api = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const profile = mkdtempSync(join(tmpdir(), "kandid-cover-browser-"));
const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", [
  "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
  "--host-resolver-rules=MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { windowsHide: true, stdio: "ignore" });
const identity = { id: "10000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "synthetic@example.invalid", email_confirmed_at: "2026-10-01T00:00:00Z", app_metadata: {}, user_metadata: {}, identities: [] };
const board = { id: 1, auth_user_id: identity.id, role: "electoral_board", status: "active", organization_id: 2, full_name: "Synthetic Board", organizations: { name: "WITSG", membership_scope: "institution" } };
const election = { id: 3, title: "Synthetic Prac Elec", organization_id: 2, academic_term_id: 1, removed_at: null,
 status:"active",cover_url:null,campaign_start:"2099-10-20T08:00:00",campaign_end:"2099-10-21T08:00:00",start_date:"2099-10-22T08:00:00",end_date:"2099-10-22T18:00:00",student_result_visibility:"after_close",voting_access_mode:"anywhere",location_label:null,geo_lat:null,geo_lng:null,geo_radius_meters:null,electorate_frozen_at:null,results_released_at:null,organizations:{name:"WITSG"} };
const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=";
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const access = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: identity.id, exp: 2100000000, iat: 1700000000, role: "authenticated" })}.${encode("synthetic-signature")}`;
const session = { user: identity, access_token: access, refresh_token: "synthetic-refresh", expires_at: 2100000000, expires_in: 3600, token_type: "bearer" };
const mutations = [], uploads = [], exceptions = [], failures = [], duplicateAuthWarnings = [], results = [];
let ws, send, slowUpload = false, uploadFailure = false;
try {
  let port;
  for (let n = 0; n < 100; n++) { try { port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]); break; } catch { await delay(100); } }
  assert.ok(port, "Fresh isolated browser debugger unavailable");
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((accept, reject) => { ws.onopen = accept; ws.onerror = reject; });
  let serial = 0; const pending = new Map();
  send = (method, params = {}) => new Promise((accept, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 20000);
    pending.set(id, { accept, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const fulfill = (id, status, body, extra = []) => send("Fetch.fulfillRequest", {
    requestId: id, responseCode: status,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: origin },
      { name: "Access-Control-Expose-Headers", value: "Content-Range" },
      { name: "Access-Control-Allow-Headers", value: "authorization,apikey,x-client-info,content-type,accept,accept-profile,content-profile,prefer,range,range-unit,x-retry-count,x-supabase-api-version,x-upsert,cache-control" },
      { name: "Access-Control-Allow-Methods", value: "GET,HEAD,POST,PATCH,DELETE,OPTIONS" }, ...extra],
    body: Buffer.from(status === 204 || body === undefined ? "" : JSON.stringify(body)).toString("base64"),
  });
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id); pending.delete(message.id); clearTimeout(entry.timer);
      message.error ? entry.reject(new Error(message.error.message)) : entry.accept(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.args.some((arg) => String(arg.value || "").includes("Multiple GoTrueClient"))) duplicateAuthWarnings.push("Duplicate Auth client");
    if (message.method !== "Fetch.requestPaused") return;
    void (async () => {
      const p = message.params, url = new URL(p.request.url), method = p.request.method;
      if (url.origin === origin) return send("Fetch.continueRequest", { requestId: p.requestId });
      if (url.origin !== api) return send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" });
      if (method === "OPTIONS") return fulfill(p.requestId, 204);
      if (url.pathname === "/auth/v1/user") return fulfill(p.requestId, 200, identity);
      if (url.pathname === "/rest/v1/admin_users") return fulfill(p.requestId, 200, [board]);
      if(url.pathname.startsWith('/storage/v1/object/public/election-covers/'))return send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/png'},{name:'Access-Control-Allow-Origin',value:origin}],body:png});
      if(url.pathname.startsWith('/storage/v1/object/election-covers/')){
        assert.equal(method,'POST');uploads.push(url.pathname);
        if(slowUpload)await delay(800);
        return fulfill(p.requestId,uploadFailure?400:200,uploadFailure?{statusCode:'404',message:'Bucket not found',error:'Bucket not found'}:{Key:url.pathname,Id:'synthetic'});
      }
      if(url.pathname==='/rest/v1/elections'){
        if(method==='PATCH'||method==='POST'){
          const body=JSON.parse(p.request.postData);mutations.push({method,body,query:url.search});
          if(method==='PATCH')Object.assign(election,body);
          else Object.assign(election,body[0],{id:42});
          return fulfill(p.requestId,200,{id:election.id});
        }
        const accepts=Object.entries(p.request.headers).find(([k])=>k.toLowerCase()==='accept')?.[1]||'';
        return fulfill(p.requestId,200,accepts.includes('vnd.pgrst.object')?election:[election]);
      }
      if(url.pathname==='/rest/v1/academic_terms'){
        const term={id:1,status:'active',academic_year:'2026?2027',semester:'1st Semester',is_current:true};
        const accepts=Object.entries(p.request.headers).find(([k])=>k.toLowerCase()==='accept')?.[1]||'';
        return fulfill(p.requestId,200,accepts.includes('vnd.pgrst.object')?term:[term]);
      }
      if(url.pathname==='/rest/v1/rpc/kandid_get_admin_election_geofence')return fulfill(p.requestId,200,{geo_lat:null,geo_lng:null,geo_radius_meters:null});
      if(url.pathname==='/rest/v1/rpc/kandid_preview_election_electorate')return fulfill(p.requestId,200,{eligible_count:0,locked:false});
      if(url.pathname==='/rest/v1/rpc/kandid_get_board_electorate_preview')return fulfill(p.requestId,200,{eligible_voters:0,is_locked:false,locking_allowed:false,academic_term_id:1});
      if(url.pathname==='/functions/v1/student-profile') {
        const body=JSON.parse(p.request.postData);
        const student={id:42,auth_user_id:identity.id,student_number:'9090909090',first_name:'Synthetic',last_name:'Student',role:'student',status:'active',program:'BSIT',year_level:2};
        if(body.action==='profile')return fulfill(p.requestId,200,{data:student});
        assert.equal(body.action,'organization_memberships');
        return fulfill(p.requestId,200,{data:{student_id:42,academic_term:{id:1,status:'active'},enrollment:{academic_term_id:1,enrollment_status:'enrolled'},count:1,memberships:[{organization_id:2,academic_term_id:1,membership_status:'active',organization:{id:2,name:'WITSG',membership_scope:'institution'}}]}});
      }
      if(url.pathname==='/functions/v1/vote-access') {
        const body=JSON.parse(p.request.postData);
        assert.ok(['student_voted_elections','student_has_voted'].includes(body.action));
        return fulfill(p.requestId,200,{data:body.action==='student_has_voted'?{has_voted:false}:{election_ids:[]}});
      }
      if(url.pathname==='/functions/v1/student-notifications')return fulfill(p.requestId,200,{data:{notifications:[]}});
      if(url.pathname==='/rest/v1/positions')return fulfill(p.requestId,200,[],[{name:'Content-Range',value:'*/0'}]);
      if(url.pathname==='/functions/v1/manage-election-removal')return fulfill(p.requestId,404,{message:'synthetic not installed'});
      if (["GET", "HEAD"].includes(method)) return fulfill(p.requestId, 200, []);
      if (url.pathname.endsWith("/kandid_server_time")) return fulfill(p.requestId, 200, new Date().toISOString());
      failures.push(`${method} ${url.pathname}`); return fulfill(p.requestId, 400, { message: "Unexpected synthetic request" });
    })().catch((error) => failures.push(error.message));
  };
  await send("Runtime.enable"); await send("Page.enable"); await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem('user',${JSON.stringify(JSON.stringify(board))});localStorage.setItem('sb-fszgdxqxonqqcrzsnkca-auth-token',${JSON.stringify(JSON.stringify(session))});` });
  const value = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (expression) => {
    for (let n = 0; n < 100; n++) { if (await value(expression)) return; await delay(100); }
    throw new Error(`Timed out: ${expression}; ${JSON.stringify(failures)}; text: ${(await value("document.body.innerText")).slice(-1200)}`);
  };
  const input = async (id, content) => {
    await value(`(()=>{const e=document.getElementById(${JSON.stringify(id)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(content))});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`);
    await delay(40);
  };
  const ready = () => wait("!!document.querySelector('.board-election-record')");
  const edit = async () => {
    await value("document.querySelector('[aria-label^=\"Edit election\"]').click()");
    await wait("!!document.querySelector('#board-election-title')");
  };
  const close = async () => {
    await value("document.querySelector('.board-election-sheet .popup-close').click()");
    await wait("!document.querySelector('.board-election-sheet.is-setup')");
  };
  const upload = async (type = "image/png", bytes = png) => {
    await value(`(()=>{const b=Uint8Array.from(atob(${JSON.stringify(bytes)}),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([b],'cover.png',{type:${JSON.stringify(type)}}));const el=document.querySelector('.board-election-setup-upload input');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  };
  const url = () => value("document.querySelector('#board-election-cover-url').value");
  for (const width of [375,390,768,1024,1440]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await send("Page.navigate", { url: origin + "/board/elections" }); await ready();
    await value("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Not Now')?.click()");
    assert.ok(await value("document.documentElement.scrollWidth<=innerWidth+1"), `${width}px page overflow`);
    await edit(); const previous = await url(); const before = mutations.length;
    await upload("image/svg+xml", Buffer.from("<svg/>").toString("base64"));
    await wait("document.body.textContent.includes('Choose a JPEG')||document.body.textContent.toLowerCase().includes('choose a supported file')");
    assert.equal(await url(), previous);
    slowUpload = true; await upload();
    await wait("document.body.textContent.includes('Uploading cover...')");
    assert.equal(await value("document.querySelector('.board-election-setup-upload input').disabled"), true);
    await wait("document.querySelector('#board-election-cover-url').value!==" + JSON.stringify(previous));
    slowUpload = false;
    const next = await url(); assert.match(next,/\/2\/elections\/[0-9]+\/.*\.png$/);
    await wait("document.querySelector('.board-election-sheet .election-cover img')?.naturalWidth>0");
    assert.equal(mutations.length,before,"Upload must not save an election");
    assert.equal(election.cover_url,previous||null,"Upload must not mutate saved cover");
    const layout = await value("(()=>{const d=document.querySelector('.board-election-sheet'),b=d.querySelector('.board-election-setup-upload');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {viewport:innerWidth,document:document.documentElement.scrollWidth,dialog:d.clientWidth,scroll:d.scrollWidth,uploadVisible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight};})()");
    assert.ok(layout.document<=width+1&&layout.scroll<=layout.dialog+1&&layout.uploadVisible,JSON.stringify(layout));
    // A replacement failure leaves the successful pending URL intact.
    uploadFailure = true; await upload(); await wait("document.body.textContent.includes('reviewed bucket repair')");
    assert.equal(await url(),next); uploadFailure=false;
    await value("document.querySelectorAll('.board-election-setup-progress button')[3].click()");
    await wait("!!document.querySelector('.board-election-sheet button[type=submit]')");
    const saveLayout=await value("(()=>{const b=document.querySelector('.board-election-sheet button[type=submit]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {visible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,disabled:b.disabled};})()");
    assert.ok(saveLayout.visible&&!saveLayout.disabled,JSON.stringify(saveLayout));
    await value("document.querySelector('.board-election-sheet button[type=submit]').click()");
    await wait("!document.querySelector('.board-election-sheet.is-setup')");
    assert.equal(mutations.length,before+1); assert.equal(mutations.at(-1).body.cover_url,next);
    await wait("!!document.querySelector('.board-election-cover img')");
    await wait("document.querySelector('.board-election-cover img').naturalWidth>0");
    // Cancel ignores any late successful response, including after re-opening.
    await edit(); slowUpload=true; await upload(); await wait("document.body.textContent.includes('Uploading cover...')");
    await close(); await edit(); await delay(1000); slowUpload=false;
    assert.equal(await url(),next); assert.equal(mutations.length,before+1); await close();
    // Create uses the organization draft namespace before any election INSERT.
    await value("document.querySelector('.board-elections-create').click()"); await wait("!!document.querySelector('#board-election-title')");
    await upload(); await wait("document.querySelector('#board-election-cover-url').value.includes('/2/drafts/')");
    assert.equal(mutations.length,before+1);
    if(width===375) {
      const draftUrl=await url(), original={...election};
      await input('board-election-title','Synthetic cover Create');
      await wait("!!document.querySelector('#board-election-academic-term option[value=\"1\"]')");
      await input('board-election-academic-term',1);
      await value("document.querySelectorAll('.board-election-setup-progress button')[1].click()");
      for(const [field,index] of [['board-election-voting-start',-2],['board-election-voting-end',-1]]) {
        await value(`document.getElementById(${JSON.stringify(field)}).click()`);
        await wait(`document.getElementById(${JSON.stringify(field)}).parentElement.querySelectorAll('.grid-cols-7 button:not(:disabled)').length>1`);
        await value(`[...document.getElementById(${JSON.stringify(field)}).parentElement.querySelectorAll('.grid-cols-7 button:not(:disabled)')].at(${index}).click()`);
      }
      await value("document.querySelectorAll('.board-election-setup-progress button')[3].click()");
      await wait("!!document.querySelector('.board-election-sheet button[type=submit]:not(:disabled)')");
      await value("document.querySelector('.board-election-sheet button[type=submit]').click()");
      await wait("!document.querySelector('.board-election-sheet.is-setup')");
      assert.equal(mutations.length,before+2); assert.equal(mutations.at(-1).method,'POST');
      assert.equal(mutations.at(-1).body[0].cover_url,draftUrl);
      await wait("!!document.querySelector('[aria-label=\"Close manage setup\"]')");
      await value("document.querySelector('[aria-label=\"Close manage setup\"]').click()");
      Object.assign(election,original);
      console.log('375px complete Create Election wizard persists draft cover URL: PASS');
    } else await close();
    results.push({...layout,editSave:true,listingImage:true,createDraftUpload:true,failureKeepsCover:true,cancelIgnoresLateResponse:true});
    console.log(`${width}px upload/preview/replacement/save/listing/create/cancel/layout: PASS`);
  }
  // Actual Student Elections route renders the saved public cover with no
  // private Storage read or changes to ballot/results authorization.
  await send("Page.addScriptToEvaluateOnNewDocument", {source:"localStorage.setItem('user',JSON.stringify({id:42,student_number:'9090909090',first_name:'Synthetic',last_name:'Student',role:'student',status:'active',program:'BSIT',year_level:2}));"});
  for(const width of [375,390,1440]) {
    await send("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await send("Page.navigate",{url:origin+'/student/elections'});
    await wait("!!document.querySelector('.election-cover img')&&document.querySelector('.election-cover img').naturalWidth>0");
    assert.equal(await value("document.querySelector('.election-cover img').getAttribute('src')"),election.cover_url);
    assert.ok(await value("document.documentElement.scrollWidth<=innerWidth+1"));
    console.log(`${width}px Student saved cover image: PASS`);
  }
  assert.deepEqual(exceptions,[]); assert.deepEqual(failures,[]); assert.deepEqual(duplicateAuthWarnings,[]);
  console.log(JSON.stringify({results,uploads:uploads.length,realBackendRequests:0,productionMutations:0}));
} finally {
  if (ws?.readyState === WebSocket.OPEN) { await send?.("Browser.close").catch(() => {}); ws.close(); }
  if (chrome.exitCode === null) chrome.kill();
}
