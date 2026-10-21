// Synthetic LOCAL PostgreSQL/PostgREST mutations and an isolated browser profile.
// Replays inspected contracts; never connects to a production mutation endpoint.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createServer as httpServer } from "node:http";
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { loadElectionForEdit, saveElectionEdit } from "../src/utils/electionEditContract.js";

const root = resolve(import.meta.dirname, "..");
const evidence = resolve(root, ".tmp/voting-backend-runtime/election-edit-acceptance");
mkdirSync(evidence, { recursive: true });
const dockerPrefix = ["--config", resolve(root, ".tmp/election-3-rule-validation/docker"), "--host", "npipe:////./pipe/dockerDesktopLinuxEngine"];
const container = "supabase_db_kandid-board-e2e-20261016-8c19";
const sourceRest = "supabase_rest_kandid-board-e2e-20261016-8c19";
const suffix = randomBytes(6).toString("hex");
const database = "kandid_election_edit_" + suffix;
const restName = "kandid-election-edit-rest-" + suffix;
const api = "http://127.0.0.1:59431", rest = "http://127.0.0.1:59432", origin = "http://localhost:5175";
const secret = randomBytes(32).toString("hex"); // Ephemeral local JWT signing key, never logged.
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { id: uid(1), aud: "authenticated", role: "authenticated", email: "synthetic@example.invalid", app_metadata: {}, user_metadata: {}, identities: [] };
const board = { id: 92001, auth_user_id: uid(1), role: "electoral_board", status: "active", organization_id: 92001, full_name: "Synthetic Board", organizations: { name: "Synthetic Test Organization" } };
const jwt = (sub, role = "authenticated") => {
  const encoded = [ { alg: "HS256", typ: "JWT" }, { sub, role, aud: "authenticated", exp: Math.floor(Date.now()/1000) + 3600 } ].map(v => Buffer.from(JSON.stringify(v)).toString("base64url")).join(".");
  return encoded + "." + createHmac("sha256", secret).update(encoded).digest("base64url");
};
const token = jwt(uid(1)), anon = jwt(null, "anon");
const docker = (args, input, env) => {
  const r = spawnSync("docker", [...dockerPrefix, ...args], { input, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 8*1024*1024, windowsHide: true });
  assert.equal(r.status, 0, String(r.stderr || r.error?.message || "Local Docker operation failed").slice(0, 700));
  return r.stdout.trim();
};
const info = JSON.parse(docker(["inspect", container]))[0];
assert.equal(info.Config.Labels["com.supabase.cli.project"], "kandid-board-e2e-20261016-8c19");
assert.equal(info.HostConfig.PortBindings["5432/tcp"][0].HostPort, "59322");
assert.match(database, /^kandid_election_edit_[a-f0-9]{12}$/);
const restInfo = JSON.parse(docker(["inspect", sourceRest]))[0];
const restEnv = Object.fromEntries(restInfo.Config.Env.map(v => { const i = v.indexOf("="); return [v.slice(0,i),v.slice(i+1)]; }));
const sql = text => docker(["exec", "-i", container, "psql", "-X", "-q", "-At", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"], text);
const contract = JSON.parse(readFileSync(resolve(root, "tests/fixtures/electionEditProductionContract.json"), "utf8"));
assert.equal(contract.project_ref, "fszgdxqxonqqcrzsnkca");
const checks = [], mutations = [], exceptions = [], unexpected = [], mockedDevelopmentWrites = [];
let vite, gateway, chrome, ws, send, started = false, created = false, phase = "local";
const pass = name => { checks.push(name); console.log("PASS " + name); };
try {
  docker(["exec", container, "createdb", "-U", "postgres", "--template=template0", database]); created = true;
  assert.equal(sql("select current_database();"), database);
  assert.match(sql("show server_version;"), /^17\./);
  sql(`create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    create table public.organizations(id integer primary key,name text,logo_url text,organization_type text default 'department',membership_scope text default 'department',eligible_programs text[] default '{BSIT}');
    create table public.academic_terms(id integer primary key,academic_year text,semester text,status text,is_current boolean,created_at timestamptz default now(),activated_at timestamptz,closed_at timestamptz);
    create table public.admin_users(id bigint primary key,auth_user_id uuid,role text,status text,organization_id integer references public.organizations,full_name text,email text,photo_url text,created_at timestamptz default now());
    create sequence public.elections_id_seq;
    create table public.elections(${contract.columns.map(c => `"${c.name}" ${c.type}${c.default ? " default " + c.default : ""}${c.not_null ? " not null" : ""}`).join(",")});
    alter table public.elections add primary key(id);
    alter table public.elections add foreign key(organization_id) references public.organizations;
    alter table public.elections add foreign key(academic_term_id) references public.academic_terms;
    insert into public.organizations(id,name) values(92001,'Synthetic Test Organization'),(92002,'Synthetic Foreign Organization');
    insert into public.academic_terms(id,academic_year,semester,status,is_current) values(92001,'2099–2100','1st Semester','active',true),(92002,'2100–2101','2nd Semester','planned',false);
    insert into public.admin_users(id,auth_user_id,role,status,organization_id,full_name) values(92001,'${uid(1)}','electoral_board','active',92001,'Synthetic Board'),(92002,'${uid(2)}','electoral_board','active',92002,'Synthetic Foreign'),(92003,'${uid(3)}','electoral_board','disabled',92001,'Synthetic Disabled'),(92004,'${uid(4)}','super_admin','active',null,'Synthetic Admin');
    insert into public.elections(id,organization_id,academic_term_id,title,status,campaign_start,campaign_end,start_date,end_date,voting_access_mode,location_label,geo_lat,geo_lng,geo_radius_meters,electorate_frozen_at,electorate_frozen_by)
    values (92001,92001,92001,'Synthetic Editable Election','draft','2099-10-01 08:00:17.123456','2099-10-02 08:00:18.123456','2099-10-03 08:00:37.123456','2099-10-03 17:00:42.56789','location_range','Synthetic site',10.71,122.56,150,null,null),
    (92002,92001,92001,'Synthetic Locked Election','active','2099-10-01','2099-10-02','2099-10-03 08:00','2099-10-03 17:00','location_range','Synthetic locked site',10.72,122.57,200,'2099-09-30',92001),
    (92003,92002,92001,'Synthetic Foreign Election','draft','2099-10-01','2099-10-02','2099-10-03','2099-10-04','anywhere',null,null,null,null,null,null);`);
  for (const c of contract.constraints) sql(`alter table public.elections add constraint "${c.name}" ${c.definition};`);
  for (const f of contract.functions) sql(f.definition);
  sql(`create trigger elections_assign_academic_term before insert or update of academic_term_id on public.elections for each row execute function private.kandid_assign_election_academic_term();
    create trigger elections_guard_frozen_electorate before insert or update on public.elections for each row execute function private.kandid_guard_frozen_electorate();
    create trigger elections_guard_result_release_fields before insert or update of results_released_at,results_released_by on public.elections for each row execute function public.kandid_guard_result_release_fields();
    create trigger trg_sync_election_fields before insert or update on public.elections for each row execute function public.sync_election_fields();
    alter table public.elections enable row level security;
    alter table public.admin_users enable row level security;
    create policy admin_users_own_auth_profile on public.admin_users for select to authenticated using (auth_user_id=auth.uid());
    grant usage on schema public to anon,authenticated;
    grant select on public.organizations,public.academic_terms to authenticated;
    grant select on public.admin_users to authenticated;
    grant select,insert,update,delete on public.elections to authenticated;`);
  for (const p of contract.policies) sql(`create policy "${p.name}" on public.elections for ${p.cmd} to ${p.roles.join(",")}${p.qual ? " using (" + p.qual + ")" : ""}${p.with_check ? " with check (" + p.with_check + ")" : ""};`);
  const uri = new URL(restEnv.PGRST_DB_URI); uri.hostname = container; uri.port = "5432"; uri.pathname = "/" + database;
  docker(["run","--rm","-d","--name",restName,"--network","supabase_network_kandid-board-e2e-20261016-8c19","--publish","127.0.0.1:59432:3000",...['PGRST_DB_URI','PGRST_JWT_SECRET','PGRST_DB_ANON_ROLE','PGRST_DB_SCHEMAS'].flatMap(k=>['--env',k]),restInfo.Config.Image],undefined,{PGRST_DB_URI:uri.toString(),PGRST_JWT_SECRET:secret,PGRST_DB_ANON_ROLE:'anon',PGRST_DB_SCHEMAS:'public'}); started = true;
  for(let i=0;i<100;i++){try{const r=await fetch(rest);if(r.status<500)break;}catch{}await delay(100);}
  gateway = httpServer(async (req,res) => {
    try {
      const url = new URL(req.url, api);
      res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Access-Control-Allow-Headers','authorization,apikey,x-client-info,content-type,accept,accept-profile,content-profile,prefer,range,range-unit,x-retry-count,x-supabase-api-version');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS,HEAD');res.setHeader('Access-Control-Expose-Headers','Content-Range');
      if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
      if(url.pathname==='/auth/v1/user'){res.setHeader('Content-Type','application/json');res.writeHead(req.headers.authorization===`Bearer ${token}`?200:401);res.end(JSON.stringify(req.headers.authorization===`Bearer ${token}`?identity:{error:'invalid synthetic identity'}));return;}
      const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
      if(url.pathname==='/rest/v1/rpc/kandid_get_board_electorate_preview'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({eligible_voters:0,is_locked:false,locking_allowed:false,academic_term_id:92001}));return;}
      if(url.pathname.startsWith('/functions/')||url.pathname==='/rest/v1/positions'||url.pathname==='/rest/v1/election_access_tokens'||url.pathname==='/rest/v1/audit_logs'){
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(url.pathname.includes('notifications')?{data:{notifications:[]}}:[]));return;
      }
      if(!url.pathname.startsWith('/rest/v1/')){res.writeHead(404);res.end();return;}
      const headers={...req.headers};delete headers.host;delete headers['content-length'];
      const response=await fetch(rest+url.pathname.slice('/rest/v1'.length)+url.search,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body})});
      if(req.method==='PATCH')mutations.push({url:url.pathname+url.search,payload:JSON.parse(body),status:response.status});
      for(const key of ['content-type','content-range'])if(response.headers.has(key))res.setHeader(key,response.headers.get(key));
      res.writeHead(response.status);res.end(Buffer.from(await response.arrayBuffer()));
    }catch{res.writeHead(500);res.end('{"error":"isolated test gateway failed"}');}
  });
  await new Promise((accept,reject)=>{gateway.once('error',reject);gateway.listen(59431,'127.0.0.1',accept);});
  const apiClient = createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
  const authProjection=readFileSync(resolve(root,'src/utils/auth.js'),'utf8').match(/const ADMIN_PROFILE_SELECT = `([\s\S]*?)`;/)[1];
  const profileProbe=await apiClient.from('admin_users').select(authProjection).eq('auth_user_id',uid(1)).maybeSingle();
  assert.equal(profileProbe.error,null);assert.equal(profileProbe.data.auth_user_id,uid(1));
  pass('existing route administrator profile contract resolves under own-profile RLS');
  const before=JSON.parse(sql("select to_jsonb(e) from public.elections e where id=92001;"));
  const saved=await loadElectionForEdit(apiClient,92001);assert.equal(saved.geo_radius_meters,150);
  pass('missing privacy RPC falls back through real local PostgREST under JWT RLS');
  const clientFor=sub=>createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${jwt(sub)}`}}});
  for(const [label,sub] of [['foreign Board',uid(2)],['disabled Board',uid(3)],['student',uid(5)]]){
    const r=await saveElectionEdit(clientFor(sub),saved,{title:'Synthetic forbidden edit'});assert.ok(r.error);assert.equal(sql('select title from public.elections where id=92001;'),before.title);pass(label+' cannot update another election');
  }
  const request=(id,payload,access=token)=>fetch(api+'/rest/v1/elections?id=eq.'+id+'&select=id',{method:'PATCH',headers:{apikey:anon,Authorization:'Bearer '+access,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify(payload)});
  for(const [label,id,patch] of [['organization reassignment',92001,{organization_id:92002}],['academic term',92001,{academic_term_id:92002}],['manual electorate freeze',92001,{electorate_frozen_at:new Date().toISOString(),electorate_frozen_by:92001}],['policy downgrade',92001,{electorate_policy_version:0}],['locked schedule',92002,{start_date:'2099-10-04'}],['released result fields',92001,{results_released_at:new Date().toISOString()}]]){
    const response=await request(id,patch);assert.equal(response.status,403,label);pass('database rejects '+label);
  }
  assert.equal((await request(92001,{title:'bad'},'invalid')).status,401);pass('invalid JWT rejected');
  const changed=await saveElectionEdit(apiClient,saved,{title:'Synthetic SQL correction'});assert.equal(changed.error,null);
  const stale=await saveElectionEdit(apiClient,saved,{title:'Synthetic stale correction'});assert.equal(stale.error?.code,'PGRST116');pass('snapshot conflict cannot overwrite a concurrent change');
  const frozen=await loadElectionForEdit(apiClient,92002);assert.equal((await saveElectionEdit(apiClient,frozen,{title:'Synthetic locked title correction'})).error,null);pass('permitted locked title edit preserves frozen settings');
  Object.assign(process.env,{VITE_SUPABASE_URL:api,VITE_SUPABASE_KEY:anon,VITE_ENABLE_ELECTION_MANAGEMENT:'false'});
  // Keep Vite's dependency compilation off the browser-controller event loop.
  const viteLog=createWriteStream(join(evidence,'vite-local.log'));
  const isolatedConfig=join(evidence,'vite.config.mjs');
  writeFileSync(isolatedConfig,`import {mergeConfig} from 'vite';\nimport base from ${JSON.stringify(pathToFileURL(resolve(root,'vite.config.js')).href)};\nexport default async env=>mergeConfig(await base(env),{cacheDir:${JSON.stringify(join(evidence,'vite-cache'))}});\n`);
  vite=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'--config',isolatedConfig,'--mode','local-election-editor','--host','localhost','--port','5175','--strictPort'],{cwd:root,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  vite.stdout.pipe(viteLog);vite.stderr.pipe(viteLog);
  let ready=false;
  for(let n=0;n<150;n++){assert.equal(vite.exitCode,null,'Local Vite exited before readiness');try{if((await fetch(origin,{signal:AbortSignal.timeout(5000)})).ok){ready=true;break;}}catch{}await delay(100);}
  assert.ok(ready,'Local Vite did not become ready');
  const profile=mkdtempSync(join(tmpdir(),'kandid-election-edit-'));
  chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--disable-gpu','--disable-extensions','--no-first-run','--no-default-browser-check','--host-resolver-rules=MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;for(let n=0;n<100;n++){try{port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);break;}catch{}await delay(100);}assert.ok(port);
  const tab=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();
  ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((a,r)=>{ws.onopen=a;ws.onerror=r;});let serial=0;const pending=new Map();
  send=(method,params={})=>new Promise((accept,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timeout'));},120000);pending.set(id,{accept,reject,timer});ws.send(JSON.stringify({id,method,params}));});
  const fulfill=(id,status,body)=>send('Fetch.fulfillRequest',{requestId:id,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'http://localhost:5174'},{name:'Access-Control-Allow-Headers',value:'authorization,apikey,x-client-info,content-type,accept,accept-profile,content-profile,prefer,range,range-unit,x-retry-count,x-supabase-api-version'},{name:'Access-Control-Allow-Methods',value:'GET,HEAD,POST,PATCH,OPTIONS'}],body:Buffer.from(JSON.stringify(body)).toString('base64')});
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.accept(m.result);}if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.text);if(m.method!=='Fetch.requestPaused')return;void(async()=>{
    const p=m.params,u=new URL(p.request.url);
    if([origin,api,'http://localhost:5174'].includes(u.origin))return send('Fetch.continueRequest',{requestId:p.requestId});
    // Keep optional web fonts offline without classifying them as a backend
    // escape. Local fallback fonts make the layout check deterministic.
    if(['fonts.googleapis.com','fonts.gstatic.com'].includes(u.hostname))return send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/css'}],body:''});
    if(phase==='production-guard'&&u.origin==='https://fszgdxqxonqqcrzsnkca.supabase.co'){
      if(p.request.method==='OPTIONS')return fulfill(p.requestId,200,{});
      if(u.pathname==='/functions/v1/manage-election-removal')return fulfill(p.requestId,404,{message:'Synthetic backend capability unavailable'});
      if(u.pathname==='/auth/v1/user')return fulfill(p.requestId,200,identity);
      if(u.pathname==='/rest/v1/admin_users')return fulfill(p.requestId,200,[board]);
      if(u.pathname==='/rest/v1/rpc/kandid_get_admin_election_geofence')return fulfill(p.requestId,404,{code:'PGRST202'});
      if(u.pathname==='/rest/v1/elections'){
        if(p.request.method==='PATCH'){
          assert.equal(u.searchParams.get('id'),'eq.92001');
          const patch=JSON.parse(p.request.postData);assert.deepEqual(Object.keys(patch),['title']);
          mockedDevelopmentWrites.push(patch);Object.assign(productionFixture,patch);
          return fulfill(p.requestId,200,{id:92001});
        }
        const accepts=Object.entries(p.request.headers).find(([k])=>k.toLowerCase()==='accept')?.[1]||'';return fulfill(p.requestId,200,accepts.includes('vnd.pgrst.object')?productionFixture:[productionFixture]);
      }
      if(!['GET','HEAD'].includes(p.request.method)&&!u.pathname.startsWith('/auth/')&&!u.pathname.includes('/rpc/'))unexpected.push('unexpected production mutation attempted');
      if(u.pathname.includes('/rpc/'))return fulfill(p.requestId,200,{});
      return fulfill(p.requestId,200,[]);
    }
    unexpected.push('blocked external request '+u.hostname);return send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'});
  })().catch(e=>unexpected.push(e.message));};
  await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
  const session={user:identity,access_token:token,refresh_token:'synthetic-local-refresh',expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer'};
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('user',${JSON.stringify(JSON.stringify(board))});localStorage.setItem('sb-127-auth-token',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('sb-fszgdxqxonqqcrzsnkca-auth-token',${JSON.stringify(JSON.stringify(session))});`});
  const value=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const wait=async expression=>{for(let n=0;n<1200;n++){if(await value(expression))return;await delay(100);}throw Error('Browser timeout: '+expression+' '+JSON.stringify({exceptions,unexpected})+' '+(await value("document.querySelector('vite-error-overlay')?.shadowRoot?.textContent||document.body.innerText")).slice(-1000));};
  const navigate=async url=>{await send('Page.navigate',{url});await wait("!!document.querySelector('[aria-label=\"Edit election Synthetic SQL correction\"]')");await value("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Not Now')?.click()");};
  const edit=async()=>{await value("document.querySelector('[aria-label^=\"Edit election Synthetic SQL\"]').click()");await wait("!!document.querySelector('#board-election-title')");};
  const input=async text=>value(`(()=>{const e=document.querySelector('#board-election-title');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(text)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  for(const width of [1280,375]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width===375});
    await navigate(origin+'/board/elections');await edit();
    assert.equal(await value("document.querySelector('#board-election-title').value"),'Synthetic SQL correction');
    const title='Synthetic browser correction '+width;await input(title);
    await value("document.querySelectorAll('.board-election-setup-progress button')[3].click()");await wait("!!document.querySelector('.board-election-sheet button[type=submit]')");
    const layout=await value("(()=>{const d=document.querySelector('.board-election-sheet'),b=d.querySelector('button[type=submit]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {viewport:innerWidth,page:document.documentElement.scrollWidth,dialog:d.clientWidth,scroll:d.scrollWidth,saveVisible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,disabled:b.disabled};})()");
    assert.ok(layout.page<=width+1&&layout.scroll<=layout.dialog+1&&layout.saveVisible&&!layout.disabled,JSON.stringify(layout));
    await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(join(evidence,`review-${width}.png`),Buffer.from(r.data,'base64')));
    await value("document.querySelector('.board-election-sheet button[type=submit]').click()");await wait("!document.querySelector('.board-election-sheet.is-setup')");
    assert.equal(sql('select title from public.elections where id=92001;'),title);
    const after=JSON.parse(sql('select to_jsonb(e) from public.elections e where id=92001;'));assert.deepEqual({...after,title:before.title},before);
    await send('Page.reload',{ignoreCache:true});await wait(`!!document.querySelector('[aria-label="Edit election ${title}"]')`);
    await value(`document.querySelector('[aria-label="Edit election ${title}"]').click()`);await wait("!!document.querySelector('#board-election-title')");assert.equal(await value("document.querySelector('#board-election-title').value"),title);
    await value("document.querySelector('.board-election-sheet .popup-close').click()");
    assert.equal((await saveElectionEdit(apiClient,await loadElectionForEdit(apiClient,92001),{title:'Synthetic SQL correction'})).error,null);
    await send('Page.captureScreenshot',{format:'png'}).then(r=>writeFileSync(join(evidence,`editor-${width}.png`),Buffer.from(r.data,'base64')));
    pass(width+'px Edit → Review → Save → Refresh uses real PostgREST/RLS; dates, geofence, lock and record fields unchanged');
  }
  const productionFixture={...await loadElectionForEdit(apiClient,92001),organizations:{name:'Synthetic Test Organization'}};
  phase='production-guard';await send('Page.navigate',{url:'http://localhost:5174/board/elections'});await wait("!!document.querySelector('[aria-label^=\"Edit election Synthetic SQL\"]')");await edit();
  assert.equal(await value("!!document.querySelector('#board-election-edit-restriction')"),false);
  await value("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Not Now')?.click()");
  await input('Synthetic normal development correction');
  await value("document.querySelectorAll('.board-election-setup-progress button')[3].click()");await wait("!!document.querySelector('.board-election-sheet button[type=submit]')");
  assert.equal(await value("document.querySelector('.board-election-sheet button[type=submit]').disabled"),false);
  await value("document.querySelector('.board-election-sheet button[type=submit]').click()");await wait("!document.querySelector('.board-election-sheet.is-setup')");
  assert.deepEqual(mockedDevelopmentWrites,[{title:'Synthetic normal development correction'}]);
  await send('Page.reload',{ignoreCache:true});await wait("!!document.querySelector('[aria-label=\"Edit election Synthetic normal development correction\"]')");
  pass('normal localhost:5174 development Save and Refresh work with no activation flag; every official-project backend request is intercepted');
  assert.deepEqual(exceptions,[]);assert.deepEqual(unexpected,[]);
  const summary={result:'PASS',database,postgres:'17',restImage:restInfo.Config.Image,checks,mutations:mutations.length,mockedDevelopmentWrites:mockedDevelopmentWrites.length,auth:'Synthetic signed local JWT and Auth fixture; real PostgREST JWT verification and PostgreSQL RLS',productionBackendRequests:0,productionMutations:0,productionSettingsChanged:false};
  writeFileSync(join(evidence,'results.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
} finally {
  if(ws?.readyState===WebSocket.OPEN){await send?.('Browser.close').catch(()=>{});ws.close();}if(chrome?.exitCode===null)chrome.kill();
  if(vite?.exitCode===null){const closed=new Promise(accept=>vite.once('close',accept));vite.kill();await closed;}
  if(gateway)await new Promise(accept=>gateway.close(accept));
  if(started)docker(['stop',restName]);
  if(created)docker(['exec',container,'dropdb','-U','postgres','--force',database]);
}
