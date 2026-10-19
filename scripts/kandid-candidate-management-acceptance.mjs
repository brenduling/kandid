// Actual frontend + Supabase Auth/PostgREST/Edge Runtime + isolated PostgreSQL.
// Only synthetic records in the verified disposable release-validation DB.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { createWriteStream, readdirSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";

const root=resolve(import.meta.dirname,"..");
const createAcceptance=true;
const evidence=resolve(root,"deploy/candidate-management-review/evidence");
mkdirSync(evidence,{recursive:true});
const prior=JSON.parse(readFileSync(resolve(root,"deploy/election-soft-removal-review/evidence/sql-results.json"),"utf8"));
const dbContainer="supabase_db_kandid-board-e2e-20261016-8c19";
const project="kandid-board-e2e-20261016-8c19";
const network="supabase_network_"+project;
assert.equal(prior.container,dbContainer);
assert.match(prior.database,/^kandid_soft_removal_release_[a-f0-9]{12}$/);
const sourceDatabase=prior.database;
const database="kandid_soft_removal_release_"+randomBytes(6).toString("hex");
const suffix=randomBytes(4).toString("hex");
const names={auth:"kandid-removal-browser-auth-"+suffix,rest:"kandid-removal-browser-rest-"+suffix,edge:"kandid-removal-browser-edge-"+suffix,kong:"kandid-removal-browser-gateway-"+suffix};
const api="http://127.0.0.1:59421",origin="http://localhost:5173";
const manual=process.argv.includes("--manual");
const gateOffOnly=process.argv.includes("--gate-off-only")||process.argv.includes("--gate-restart-only");
const isolatedWrites=!createAcceptance&&!gateOffOnly&&(!manual||process.argv.includes("--allow-isolated-writes"));
async function hiddenSyntheticPassword(){
 assert.ok(process.stdin.isTTY,"Manual acceptance requires an interactive local console");
 process.stdout.write("Choose a synthetic account password (hidden, at least 12 characters): ");
 process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((accept,reject)=>{
  let value="";
  const finish=()=>{process.stdin.off("data",listener);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write("\n");};
  const listener=chunk=>{for(const character of chunk.toString()){
   if(character==='\u0003'){finish();reject(Error("Manual acceptance cancelled"));return;}
   if(character==='\r'||character==='\n'){finish();if(value.length<12)reject(Error("Synthetic password is too short"));else accept(value);return;}
   if(character==='\u007f'||character==='\b')value=value.slice(0,-1);else if(value.length<256)value+=character;
  }};
  process.stdin.on("data",listener);
 });
}
const temporary=mkdtempSync(join(tmpdir(),"kandid-removal-browser-"));
const docker=(args,env)=>{
 const r=spawnSync("docker",["--context","desktop-linux",...args],{env:env?{...process.env,...env}:process.env,encoding:"utf8",maxBuffer:16*1024*1024});
 if(r.status!==0)throw Error("Isolated Docker operation failed: "+args.slice(0,3).join(" ")+" "+String(r.stderr||r.error?.message||"").slice(0,500));
 return r.stdout;
};
const inspect=name=>JSON.parse(docker(["inspect",name]))[0];
const envOf=info=>Object.fromEntries(info.Config.Env.filter(value=>!value.startsWith("PATH=")).map(value=>{const at=value.indexOf("=");return [value.slice(0,at),value.slice(at+1)];}));
const db=inspect(dbContainer);
assert.equal(db.Id,"6bd024cac2ec0f8ffac8ec31b322f5fa581b51f9e8139edfdb4fd0c30d2c4676");
assert.equal(db.Config.Labels["com.supabase.cli.project"],project);
assert.equal(db.HostConfig.PortBindings["5432/tcp"][0].HostPort,"59322");
assert.equal(db.Mounts.find(item=>item.Destination==="/var/lib/postgresql/data")?.Name,dbContainer);
const sources=Object.fromEntries(["auth","rest","edge_runtime","kong"].map(key=>[key,inspect("supabase_"+key+"_"+project)]));
for(const info of Object.values(sources))assert.ok(info.NetworkSettings.Networks[network]);
const edgeEnv=envOf(sources.edge_runtime),authEnv=envOf(sources.auth),restEnv=envOf(sources.rest);
const anon=edgeEnv.SUPABASE_ANON_KEY,service=edgeEnv.SUPABASE_SERVICE_ROLE_KEY;
for(const [key,role] of [[anon,"anon"],[service,"service_role"]]){
 const claims=JSON.parse(Buffer.from(key.split(".")[1],"base64url"));
 assert.equal(claims.role,role);assert.notEqual(claims.ref,"fszgdxqxonqqcrzsnkca");assert.notEqual(claims.ref,"jkkgzhteacaafdnpeomy");
}
function sql(text,user="postgres"){
 const r=spawnSync("docker",["--context","desktop-linux","exec","-i",dbContainer,"psql","-X","-U",user,"-d",database,"-At","-v","ON_ERROR_STOP=1"],{input:text,encoding:"utf8",maxBuffer:16*1024*1024});
 assert.equal(r.status,0,r.stderr);return r.stdout.trim();
}
function dbUrl(original){const url=new URL(original);assert.ok(["postgres:","postgresql:"].includes(url.protocol));url.hostname=dbContainer;url.port="5432";url.pathname="/"+database;return url.toString();}
const stage='/tmp/'+database;
docker(['exec',dbContainer,'mkdir','-p',stage]);
docker(['exec',dbContainer,'pg_dump','-U','supabase_admin','-d',sourceDatabase,'--schema-only','--no-publications','--no-subscriptions','-f',stage+'/schema.sql']);
docker(['exec',dbContainer,'createdb','-U','supabase_admin','--owner=postgres','--template=template0',database]);
docker(['exec',dbContainer,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','--single-transaction','-f',stage+'/schema.sql']);
writeFileSync(join(evidence,'ENVIRONMENT.json'),JSON.stringify({project,database,sourceDatabase,container:dbContainer,containerId:db.Id,volume:db.Mounts.find(m=>m.Destination==='/var/lib/postgresql/data').Name,postgresPort:59322,api,origin,syntheticOnly:true,officialProjectRequests:0},null,2));
const started=[];let vite,browser,ws,send,heldGeofence=false;
const lifetime=setInterval(()=>{},1000);
const results=[],requests=[],exceptions=[],blocked=[],failureResponses=[],creationPayloads=[];
let failNextCreation=false;
function start(name,image,environment,args=[]){
 docker(["run","--rm","-d","--name",name,"--network",network,...Object.keys(environment).flatMap(key=>["--env",key]),...args,image],environment);started.push(name);
}
async function ready(url){for(let n=0;n<120;n++){try{const r=await fetch(url,{signal:AbortSignal.timeout(3000)});if(r.ok)return;}catch{/* Retry while the isolated service starts. */}await delay(250);}throw Error("Local service not ready: "+new URL(url).pathname);}
const historyTables=["students","student_term_enrollments","student_organization_terms","academic_terms","organizations","elections","positions","candidates","candidate_media","partylists","eligibility_rules","election_access_tokens","votes","vote_ballots","officers","officer_new_roster","officer_leadership_releases","election_officer_publications","election_officer_publication_entries","election_campaign_snapshots","archived_elections","audit_logs"];
const jsonSnapshot=()=>JSON.parse(sql("SELECT jsonb_build_object("+[...historyTables.map(name=>[name,"public."+name]),["frozen_electorate","private.election_eligible_voters"]].map(([name,table])=>`'${name}',(SELECT jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_data,E'\\n' ORDER BY row_data),''))) FROM (SELECT (to_jsonb(t)-'removed_at')::text row_data FROM ${table} t ${name==="audit_logs"?"WHERE action='synthetic_historical_event'":name==="elections"?"WHERE id BETWEEN 91101 AND 91103":name==="positions"?"WHERE election_id BETWEEN 91101 AND 91103":name==="candidates"?"WHERE id=91101":""}) records)`).join(",")+");"));
function startEdge(gate){
 const functionRoot=resolve(root,"deploy/election-soft-removal-review/candidate/supabase/functions");
 docker(["run","--rm","-d","--name",names.edge,"--network",network,"--mount",`type=bind,src=${functionRoot},dst=/app,readonly`,...['SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','ELECTION_SOFT_REMOVAL_ENABLED'].flatMap(key=>["--env",key]),"--entrypoint","edge-runtime",sources.edge_runtime.Config.Image,"start","--main-service=/app/manage-election-removal","--port=8081","--policy=per_worker"],{SUPABASE_URL:"http://"+names.kong+":8000",SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,ELECTION_SOFT_REMOVAL_ENABLED:gate});
 if(!started.includes(names.edge))started.push(names.edge);
}
async function waitForEdge(){
 for(let attempt=0;attempt<120;attempt++){
  try{const response=await fetch(api+"/functions/v1/manage-election-removal",{method:"OPTIONS",headers:{Origin:origin,"Access-Control-Request-Method":"POST"},signal:AbortSignal.timeout(3000)});if(response.status===200||response.status===204)return;}catch{/* Isolated worker still starting. */}
  await delay(250);
 }
 throw Error("Isolated Edge preflight did not become ready");
}
try{
 sql(`DO $$ BEGIN IF current_database()<>'${database}' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'isolation mismatch'; END IF; END $$;`);
 sql(readFileSync(resolve(root,'supabase/runtime-validation/election-soft-removal-release-records.sql'),'utf8'),'supabase_admin');
 sql(readFileSync(resolve(root,'supabase/migrations/20260928130000_harden_board_position_mutations.sql'),'utf8'));
 sql(`BEGIN; SET LOCAL session_replication_role=replica;
 INSERT INTO public.elections(id,organization_id,title,status,academic_term_id,removed_at) VALUES
 (91201,901,'Synthetic Position Election','draft',901,null),
 (91202,902,'Synthetic Foreign Position Election','draft',901,null),
 (91203,901,'Synthetic Closed Position Election','closed',901,null),
 (91204,901,'Synthetic Removed Position Election','draft',901,now());
 COMMIT;`,'supabase_admin');
 // Copy Auth's schema migration bookkeeping only, never source users/sessions.
 const authLedger=docker(["exec",dbContainer,"pg_dump","-U","supabase_admin","-d","postgres","--data-only","--table=auth.schema_migrations","--inserts"]);
 if(sql("SELECT count(*) FROM auth.schema_migrations;")==="0")sql(authLedger,"supabase_admin");
const {prepareCandidateFixtures}=await import('./candidateManagementFixtures.mjs');prepareCandidateFixtures(sql,root);
const before=jsonSnapshot();
 const kongFile=join(temporary,"kong.yml");
 writeFileSync(kongFile,`_format_version: "2.1"
services:
  - name: auth
    url: http://${names.auth}:9999/
    routes:
      - name: auth
        paths: [ /auth/v1/ ]
        strip_path: true
  - name: rest
    url: http://${names.rest}:3000/
    routes:
      - name: rest
        paths: [ /rest/v1/ ]
        strip_path: true
  - name: removal
    url: http://${names.edge}:8081/
    routes:
      - name: removal
        paths: [ /functions/v1/manage-election-removal ]
        strip_path: true
plugins:
  - name: cors
    config:
      origins: [ "${origin}" ]
      methods: [ GET, POST, PATCH, DELETE, PUT, HEAD, OPTIONS ]
      headers: [ authorization, apikey, x-client-info, content-type, x-supabase-api-version, prefer, accept-profile, content-profile, range, x-retry-count ]
      exposed_headers: [ content-range ]
      credentials: true
`);
 start(names.auth,sources.auth.Config.Image,{...authEnv,GOTRUE_DB_DATABASE_URL:dbUrl(authEnv.GOTRUE_DB_DATABASE_URL),API_EXTERNAL_URL:api,GOTRUE_JWT_ISSUER:api+"/auth/v1",GOTRUE_SITE_URL:origin,GOTRUE_URI_ALLOW_LIST:origin,GOTRUE_SMTP_HOST:"127.0.0.1",GOTRUE_SMTP_PORT:"1",GOTRUE_DISABLE_SIGNUP:"true"});
 start(names.rest,sources.rest.Config.Image,{...restEnv,PGRST_DB_URI:dbUrl(restEnv.PGRST_DB_URI)});
 // The write gate is enabled ONLY in this ephemeral isolated acceptance process.
 // Official project secrets and local development .env files are never changed.
 startEdge(isolatedWrites?"true":"false");
 start(names.kong,sources.kong.Config.Image,{KONG_DATABASE:"off",KONG_DECLARATIVE_CONFIG:"/tmp/kong.yml",KONG_DNS_ORDER:"LAST,A,CNAME",KONG_DNS_VALID_TTL:"1",KONG_DNS_STALE_TTL:"0",KONG_PLUGINS:"cors",KONG_PROXY_ACCESS_LOG:"/dev/stdout",KONG_PROXY_ERROR_LOG:"/dev/stderr",KONG_NGINX_WORKER_PROCESSES:"1"},["--publish","127.0.0.1:59421:8000","--mount",`type=bind,src=${kongFile},dst=/tmp/kong.yml,readonly`]);
 await ready(api+"/auth/v1/health");
 console.log("LOCAL_AUTH_AND_GATEWAY_READY");
 const adminClient=createClient(api,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const accounts={};
 const manualPassword=manual?await hiddenSyntheticPassword():null;
 for(const [name,id] of [["board",901],["foreign",902],["admin",903],["student",null]]){
  const email=`browser-${name}-${suffix}@example.invalid`,password=manualPassword||"Synthetic!Aa9"+randomBytes(12).toString("hex");
  const {data,error}=await adminClient.auth.admin.createUser({email,password,email_confirm:true});
  assert.equal(error,null,"isolated synthetic Auth provisioning failed");assert.match(data.user.id,/^[a-f0-9-]{36}$/);
  if(id!==null)sql(`UPDATE public.admin_users SET auth_user_id='${data.user.id}',email='${email}' WHERE id=${id};`);
  accounts[name]={email,password,id:data.user.id};
 }
 const checks=await Promise.all(["admin_users","elections","positions","candidates","partylists","election_officer_publications","votes","vote_ballots","eligibility_rules","election_access_tokens","election_campaign_snapshots","officers","officer_new_roster","officer_leadership_releases","election_officer_publication_entries","candidate_media","archived_elections","audit_logs"].map(async table=>{
  const {error,count}=await adminClient.from(table).select("id",{count:"exact",head:true});return {table,count,error:error?{code:error.code,message:error.message}:null};
 }));
 const electorate=await adminClient.rpc("kandid_get_election_removal_electorate_count",{p_election_id:91101,p_actor_auth_uid:accounts.board.id});
 checks.push({rpc:"kandid_get_election_removal_electorate_count",error:electorate.error?{code:electorate.error.code,message:electorate.error.message}:null});
 writeFileSync(join(evidence,"browser-backend-dependencies.json"),JSON.stringify(checks,null,2));
 assert.ok(checks.every(check=>!check.error),"Local dependency error: "+JSON.stringify(checks.filter(check=>check.error)));
 const probeClient=createClient(api,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const probeLogin=await probeClient.auth.signInWithPassword(accounts.board);assert.equal(probeLogin.error,null);
 for(const body of [{action:"list_removed",limit:50,offset:0},{action:"review",election_id:91101}]){
  const probe=await probeClient.functions.invoke("manage-election-removal",{body});
  if(probe.error)throw Error(`Actual local Edge read failed: ${body.action}, HTTP ${probe.error.context?.status||0}`);
 }
 console.log("ACTUAL_EDGE_READS_VERIFIED");
 if(gateOffOnly){
  if(process.argv.includes("--gate-restart-only")){docker(["stop",names.edge]);startEdge("false");docker(["restart",names.kong]);await ready(api+"/auth/v1/health");await waitForEdge();}
  const auditCount=sql("SELECT count(*) FROM public.audit_logs;");
  for(const action of ["soft_remove","restore"]){
   const result=await probeClient.functions.invoke("manage-election-removal",{body:{action}});
   assert.equal(result.error?.context?.status,403);
   const body=await result.error.context.clone().json();assert.equal(body.code,"election_removal_not_enabled");
  }
  for(const authorization of [null,"Bearer invalid"]){
   const headers={apikey:anon,"Content-Type":"application/json"};if(authorization)headers.Authorization=authorization;
   const response=await fetch(api+"/functions/v1/manage-election-removal",{method:"POST",headers,body:JSON.stringify({action:"soft_remove"})});assert.equal(response.status,401);
  }
  assert.equal(sql("SELECT count(*) FROM public.audit_logs;"),auditCount);assert.deepEqual(jsonSnapshot(),before);
  writeFileSync(join(evidence,"gate-off-runtime.json"),JSON.stringify({result:"PASS",database,real_auth:true,real_edge_runtime:true,reads:["review","list_removed"],denied_writes:["soft_remove","restore"],missing_invalid_jwt:401,preservation_groups:23,audit_unchanged:true,production_requests:0},null,2));
  console.log("PASS ACTUAL_GATE_OFF_RUNTIME_AND_AUTHORIZATION");
 }else{
 const viteEnv={...process.env,VITE_SUPABASE_URL:api,VITE_SUPABASE_KEY:anon,KANDID_SUPABASE_KEY_PROJECT_REF:"local",KANDID_BOARD_ACCEPTANCE_CACHE_DIR:join(temporary,"vite-cache"),VITE_ENABLE_ELECTION_SOFT_REMOVAL:isolatedWrites?"true":"false",VITE_ENABLE_POSITION_MANAGEMENT:"true",VITE_ENABLE_CANDIDATE_MANAGEMENT:"true"};
 const viteLog=createWriteStream(join(evidence,"browser-vite.log"));
 const fingerprint=createHash("sha256");
 const hashTree=directory=>{for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())hashTree(path);else fingerprint.update(path).update(readFileSync(path));}};
 hashTree(join(root,"src"));
 writeFileSync(join(evidence,"browser-source.json"),JSON.stringify({sourceSha256:fingerprint.digest("hex"),server:"Vite development with isolated cache and backend",mode:"isolated-board-acceptance"},null,2));
 vite=spawn(process.execPath,[resolve(root,"node_modules/vite/bin/vite.js"),"--config","scripts/vite-board-acceptance.config.mjs","--mode","isolated-board-acceptance","--host","127.0.0.1","--port","5173","--strictPort","--force"],{cwd:root,env:viteEnv,windowsHide:true,stdio:["ignore","pipe","pipe"]});vite.stdout.pipe(viteLog);vite.stderr.pipe(viteLog);
 await ready("http://127.0.0.1:5173/eb-login");
 assert.ok(!JSON.stringify(viteEnv.VITE_SUPABASE_URL).includes("supabase.co")&&viteEnv.VITE_SUPABASE_URL===api,"Frontend must use disposable API");
 console.log("ISOLATED_FRONTEND_CONFIGURATION_VERIFIED");
 if(manual){
  const environment={database,api,origin,browser_profile:join(temporary,"manual-edge-profile"),board_email:accounts.board.email,admin_email:accounts.admin.email,foreign_board_email:accounts.foreign.email,isolated_write_gate:isolatedWrites,production_requests:0};
  writeFileSync(join(evidence,"manual-environment.json"),JSON.stringify(environment,null,2));
  console.log(JSON.stringify(environment,null,2));
  console.log("Use MANUAL_ACCEPTANCE.md. The password is the hidden value you entered; it is never printed or saved.");
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  await terminal.question("Press Enter after manual testing to stop only these temporary local services. ");terminal.close();
  assert.deepEqual(jsonSnapshot(),before,"Historical records changed during manual acceptance");
  assert.equal(sql("SELECT count(*) FROM public.elections WHERE removed_at IS NOT NULL;"),"0","Restore synthetic elections before completing the manual acceptance");
  writeFileSync(join(evidence,"manual-preservation.json"),JSON.stringify({database,history_groups:23,result:"PASS",all_elections_restored:true,ui_acceptance:"Record actual observations in MANUAL_ACCEPTANCE.md; this database assertion alone is not browser acceptance."},null,2));
 }else{
 const profile=join(temporary,"edge-profile");mkdirSync(profile);
 browser=spawn("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--remote-allow-origins=*","--remote-debugging-port=0",`--user-data-dir=${profile}`,"--host-resolver-rules=MAP localhost 127.0.0.1,MAP *.supabase.co ~NOTFOUND,MAP *.supabase.com ~NOTFOUND","about:blank"],{windowsHide:true,stdio:"ignore"});
 let port;for(let n=0;n<300;n++){try{port=Number(readFileSync(join(profile,"DevToolsActivePort"),"utf8").split("\n")[0]);break;}catch{await delay(100);}}assert.ok(port,"fresh Edge debugger unavailable");
 const tab=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==="page");
 ws=new WebSocket(tab.webSocketDebuggerUrl);await new Promise((accept,reject)=>{ws.onopen=accept;ws.onerror=reject;});
 let serial=0;const pending=new Map();
 send=(method,params={})=>new Promise((accept,reject)=>{const id=++serial;pending.set(id,{accept,reject});ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(pending.delete(id))reject(Error("Browser command timed out: "+method));},method==="Page.navigate"?45000:15000).unref();});
 ws.onmessage=({data})=>{
  const m=JSON.parse(data);if(m.id&&pending.has(m.id)){const call=pending.get(m.id);pending.delete(m.id);m.error?call.reject(Error(m.error.message)):call.accept(m.result);}
  if(m.method==="Runtime.exceptionThrown")exceptions.push(m.params.exceptionDetails.text);
  if(m.method==="Network.responseReceived"&&m.params.response.status>=400){const item={path:new URL(m.params.response.url).pathname,status:m.params.response.status};failureResponses.push(item);void send("Network.getResponseBody",{requestId:m.params.requestId}).then(({body})=>{try{const value=JSON.parse(body);item.code=value.code||value.error_code;item.error=value.error||value.message;}catch{/* Non-JSON gateway errors are classified by status. */}}).catch(()=>{});}
  if(m.method==="Fetch.requestPaused")void(async()=>{const p=m.params,url=new URL(p.request.url);if(["fonts.googleapis.com","fonts.gstatic.com"].includes(url.hostname)&&p.request.method==="GET"){await send("Fetch.continueRequest",{requestId:p.requestId});return;}if(![origin,api].includes(url.origin)){blocked.push(url.origin);await send("Fetch.failRequest",{requestId:p.requestId,errorReason:"BlockedByClient"});return;}const body=p.request.postData?JSON.parse(p.request.postData):{};if(url.origin===api&&url.pathname==="/rest/v1/candidates"&&p.request.method==="POST"&&Array.isArray(body)){creationPayloads.push(body[0]);if(failNextCreation){failNextCreation=false;await send("Fetch.failRequest",{requestId:p.requestId,errorReason:"ConnectionClosed"});return;}}requests.push({path:url.pathname,method:p.request.method,action:body.action||null});await send("Fetch.continueRequest",{requestId:p.requestId});})().catch(error=>{if(!/Invalid InterceptionId/.test(error.message))exceptions.push(error.message);});
 };
 await send("Page.enable");await send("Runtime.enable");await send("Network.enable");await send("Network.setBypassServiceWorker",{bypass:true});await send("Fetch.enable",{patterns:[{urlPattern:"*",requestStage:"Request"}]});
 const evaluate=async expression=>{const r=await send("Runtime.evaluate",{expression,awaitPromise:false,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const evaluateAsync=async expression=>{await evaluate("window.__localAcceptanceResult=undefined;Promise.resolve("+expression+").then(value=>window.__localAcceptanceResult={value},()=>window.__localAcceptanceResult={error:true})");for(let n=0;n<200;n++){const result=await evaluate("window.__localAcceptanceResult");if(result){assert.ok(!result.error,"isolated async browser operation failed");return result.value;}await delay(100);}throw Error("Isolated async operation timed out");};
 const wait=async(expression)=>{for(const deadline=Date.now()+60000;Date.now()<deadline;){if(await evaluate(expression))return;await delay(100);}const text=await evaluate("document.body.innerText.slice(0,1400)");throw Error("Browser condition failed: "+expression+"; UI="+text);};
 const clickExpr=async expression=>{await wait(`!!(${expression})`);await evaluate(`(${expression}).scrollIntoView({block:'center',behavior:'instant'})`);await delay(250);const r=await evaluate(`(()=>{const b=${expression};if(!b)return null;const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,disabled:b.disabled};})()`);assert.ok(r,"click target missing: "+expression);assert.equal(r.disabled,false,"click target disabled");await send("Input.dispatchMouseEvent",{type:"mousePressed",x:r.x,y:r.y,button:"left",clickCount:1});await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:r.x,y:r.y,button:"left",clickCount:1});await delay(120);};
 const click=selector=>clickExpr(`document.querySelector(${JSON.stringify(selector)})`);
 const clickText=text=>clickExpr(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})`);
 const fill=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const navigate=async url=>{const marker=crypto.randomUUID();await evaluate("window.__acceptanceNavigation="+JSON.stringify(marker));await send("Page.navigate",{url});await wait("window.__acceptanceNavigation!=="+JSON.stringify(marker)+" && document.readyState==='complete' && location.href==="+JSON.stringify(url));};
 async function login(name){
  await navigate(origin+"/eb-login");await wait("location.origin==="+JSON.stringify(origin));await evaluate("localStorage.clear();sessionStorage.clear()");
  const isAdmin=name==="admin",account=accounts[name];await navigate(origin+(isAdmin?"/admin-login":"/eb-login"));await wait(`!!document.querySelector('#${isAdmin?"admin":"board"}-login-email')`);
  await fill(`#${isAdmin?"admin":"board"}-login-email`,account.email);await fill(`#${isAdmin?"admin":"board"}-login-password`,account.password);await click('button[type="submit"]');
  await wait(`location.pathname.startsWith(${JSON.stringify(isAdmin?"/super-admin/":"/board/")})`);
  await navigate(origin+(isAdmin?"/super-admin/elections":"/board/elections"));
  await wait("document.body.innerText.includes('Synthetic Removable Election')");
  await delay(2100);if(await evaluate("!!document.querySelector('[aria-label=\"Dismiss install prompt\"]')"))await click('[aria-label="Dismiss install prompt"]');
 }
 const {runCandidateAcceptance}=await import('./candidateManagementJourneys.mjs');
 const journeyContext={navigate,sql,api,anon,accounts,probeClient,send,evaluate,evaluateAsync,wait,click,clickExpr,clickText,fill,login,results,jsonSnapshot,before,evidence,origin,suffix,creationPayloads,failNextInsert:()=>{failNextCreation=true;}};
 if(process.argv.includes('--inline-only')){const {runCandidateInlineAcceptance}=await import('./candidateInlineJourneys.mjs');await runCandidateInlineAcceptance(journeyContext);}else await runCandidateAcceptance(journeyContext);
 assert.deepEqual(jsonSnapshot(),before,'historical rows unchanged');
 assert.deepEqual(blocked,[]);assert.deepEqual(exceptions,[]);
 const output={database,api,origin,services:started,actual_supabase_auth:true,actual_postgrest:true,actual_edge_runtime:true,synthetic_only:true,production_requests:0,results,requests,failureResponses,blocked,exceptions};
 writeFileSync(join(evidence,process.argv.includes("--tablet-only")?"browser-tablet-results.json":heldGeofence?"browser-legacy-results.json":"browser-results.json"),JSON.stringify(output,null,2));console.log(JSON.stringify({journeys:results.length,result:"PASS",database,production_requests:0}));
 }
 }
}catch(error){
 if(send)try{const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(evidence,'browser-failure.png'),Buffer.from(shot.data,'base64'));}catch{/* Preserve the original assertion failure. */}
 writeFileSync(join(evidence,"browser-failure.json"),JSON.stringify({database,error:error.message,results,requests,failureResponses,blocked,exceptions},null,2));
 console.error(error.stack||error.message);process.exitCode=1;
}finally{
 if(heldGeofence)sql("ALTER FUNCTION public.kandid_test_held_geofence(integer) RENAME TO kandid_get_admin_election_geofence;");
 if(send)await Promise.race([send("Browser.close").catch(()=>{}),delay(500)]);ws?.close();browser?.kill();vite?.kill();
 for(const name of [names.edge,names.rest,names.kong])if(started.includes(name)){
  const logs=spawnSync("docker",["--context","desktop-linux","logs","--tail","80",name],{encoding:"utf8"});
  writeFileSync(join(evidence,name===names.edge?"browser-edge-runtime.log":name===names.rest?"browser-postgrest.log":"browser-gateway.log"),(logs.stdout||"")+(logs.stderr||""));
 }
 for(const name of started.reverse())try{docker(["stop",name]);}catch{/* A failed test service may already have exited. */}
 clearInterval(lifetime);
}
// All owned services are stopped above. Windows browser/CDP handles can linger
// after Browser.close; do not leave this standalone acceptance runner alive.
process.exit(process.exitCode || 0);
