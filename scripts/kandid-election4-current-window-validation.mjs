// Disposable LOCAL PostgreSQL + actual frontend/Edge handlers. Auth and HTTP
// transport are synthetic; there is no production connection or real JWT.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { transformSync } from "esbuild";
import { ethers } from "ethers";
import * as security from "../supabase/functions/_shared/kandidProductionSecurity.mjs";
import * as accessContracts from "../supabase/functions/_shared/voteAccessContracts.mjs";
import { hasDuplicateCandidateSelection } from "../supabase/functions/_shared/ballotSelection.js";
import { hasCurrentTermEnrollment } from "../supabase/functions/_shared/currentTermEnrollment.js";
import { isWithinGeofence, parseCoordinates } from "../supabase/functions/_shared/geofence.js";
import { isAllowedDevelopmentProductionRequest } from "../src/utils/developmentProductionWriteGuard.js";

const root=resolve(import.meta.dirname,"..");
const evidence=resolve(root,".tmp/election4-current-window");mkdirSync(evidence,{recursive:true});
const prefix=["--config",resolve(root,".tmp/election-3-rule-validation/docker"),"--host","npipe:////./pipe/dockerDesktopLinuxEngine"];
const container="supabase_db_kandid-board-e2e-20261016-8c19";
const database="kandid_e4_recovery_"+randomBytes(6).toString("hex");
const docker=(args,input)=>spawnSync("docker",[...prefix,...args],{input,encoding:"utf8",windowsHide:true,maxBuffer:10*1024*1024});
const inspected=docker(["inspect",container]);assert.equal(inspected.status,0,inspected.stderr);
const info=JSON.parse(inspected.stdout)[0];
assert.equal(info.Config.Labels["com.supabase.cli.project"],"kandid-board-e2e-20261016-8c19");
assert.equal(info.HostConfig.PortBindings["5432/tcp"][0].HostPort,"59322");
assert.match(database,/^kandid_e4_recovery_[a-f0-9]{12}$/);
assert.equal(docker(["exec",container,"createdb","-U","postgres","--template=template0",database]).status,0);
const psql=["exec","-i",container,"psql","-X","-q","-At","-U","postgres","-d",database,"-v","ON_ERROR_STOP=1"];
const run=(query,ok=true)=>{const r=docker(psql,query);if(ok)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0,"Expected rejection");return r;};
const last=r=>r.stdout.trim().split("\n").at(-1);
const json=query=>JSON.parse(last(run(query)));
const literal=value=>value==null?"null":"'"+String(value).replaceAll("'","''")+"'";
const uid=n=>"10000000-0000-4000-8000-"+String(n).padStart(12,"0");
const actor=n=>`set local role authenticated;select set_config('request.jwt.claim.sub','${uid(n)}',true);`;
const service=query=>"begin;set local role service_role;select set_config('request.jwt.claim.role','service_role',true);"+query+";commit;";
const recover="select public.kandid_recover_election4_electorate()";
const counts=()=>json("select jsonb_build_array((select count(*) from private.election_eligible_voters where election_id=4),(select count(*) from public.vote_ballots where election_id=4),(select count(*) from public.votes where election_id=4));");
const preserved=()=>last(run(`select md5(jsonb_build_object(
 'elections',(select jsonb_agg(to_jsonb(t) order by id) from public.elections t where id<>4),
 'students',(select jsonb_agg(to_jsonb(t) order by id) from public.students t),
 'enrollment',(select jsonb_agg(to_jsonb(t) order by student_id) from public.student_term_enrollments t),
 'rules',(select jsonb_agg(to_jsonb(t) order by id) from public.eligibility_rules t),
 'ballots',(select jsonb_agg(to_jsonb(t) order by id) from public.vote_ballots t where election_id<>4),
 'votes',(select jsonb_agg(to_jsonb(t) order by id) from public.votes t where election_id<>4))::text);`));
const asyncSql=query=>new Promise((accept,reject)=>{
  const p=spawn("docker",[...prefix,...psql],{windowsHide:true});let stdout="",stderr="";
  p.stdout.on("data",x=>stdout+=x);p.stderr.on("data",x=>stderr+=x);p.on("error",reject);
  p.on("close",status=>accept({status,stdout,stderr}));p.stdin.end(query);
});
const checks=[];const pass=name=>{checks.push(name);console.log("PASS "+name);};
const contract=JSON.parse(readFileSync(resolve(root,"tests/fixtures/election3ElectorateProductionContract.json"),"utf8"));
const integrity=JSON.parse(readFileSync(resolve(root,"tests/fixtures/submitVoteIntegrityProductionContract.json"),"utf8"));
const proposal=readFileSync(resolve(root,"supabase/proposals/election-4-current-window-recovery.sql"),"utf8");
const originalLock=contract.functions.find(f=>f.name==="kandid_lock_board_electorate").definition;
try {
  assert.equal(last(run("select current_database();")),database);
  assert.match(last(run("show server_version;")),/^17\./);
  let fixture=readFileSync(resolve(root,"tests/fixtures/election3ElectorateRules.sql"),"utf8")
    .replace("(3,'Prac Elec'","(4,'Prac Elec'").replace("(4,'Untouched election'","(3,'Untouched election'")
    .replace("values(3,'BSIT',2,4,false),(4,'BSIT',2,4,false)","values(4,'BSIT',2,4,false),(3,'BSIT',2,4,false)")
    .replace("select 4,id from public.students","select 3,id from public.students")
    .replace("values(1,3,'active',1),(2,4,'active',1)","values(1,4,'active',1),(2,3,'active',1)")
    .replace("values(1,2,3,'Synthetic Party'","values(1,2,4,'Synthetic Party'")
    .replace(/^create table public\.(vote_ballots|votes)\(.*\);\r?\n/gm,"")
    .replace(/^insert into public\.(vote_ballots|votes)\(.*\);\r?\n/gm,"");
  run(fixture);
  run(`create schema extensions;create extension pgcrypto with schema extensions;create sequence public.votes_id_seq;
    alter table public.students add column student_number text,add column precinct_code text,add column batch_code text;
    alter table public.elections add column voting_access_mode text default 'anywhere',add column geo_lat numeric,add column geo_lng numeric,add column geo_radius_meters numeric;
    alter table public.positions add column name text default 'Chairman',add column max_votes integer default 1;
    alter table public.candidates add column campaign_status text default 'published';
    update public.student_organization_terms set status='removed' where student_id>2;
    delete from public.eligibility_rules where election_id=4;
    update public.elections set start_date='2026-10-21 01:00:00',end_date='2026-10-21 22:00:00' where id=4;
    insert into public.elections(id,title,organization_id,academic_term_id,status,start_date,end_date,electorate_policy_version,electorate_frozen_at,electorate_frozen_by)
      values(5,'Expired synthetic',2,1,'active',timezone('Asia/Manila',now())-interval '2 hours',timezone('Asia/Manila',now())-interval '1 hour',1,now(),1);
    insert into private.election_eligible_voters values(5,1,now());`);
  for(const t of integrity.tables)run(`create table public.${t.table}(${t.columns.map(c=>`"${c.name}" ${c.type}${c.default?" default "+c.default:""}${c.not_null?" not null":""}`).join(",")});`);
  for(const c of integrity.constraints)run(`alter table public.${c.table} add constraint "${c.name}" ${c.definition};`);
  for(const f of contract.functions)run(f.definition);
  run(integrity.insertion);
  run(`create trigger elections_guard_frozen_electorate before insert or update on public.elections for each row execute function private.kandid_guard_frozen_electorate();
    create trigger election_eligible_voters_immutable before insert or update or delete on private.election_eligible_voters for each row execute function private.kandid_guard_frozen_electorate_member();
    create trigger vote_ballots_require_locked_electorate before insert on public.vote_ballots for each row execute function private.kandid_require_locked_electorate_for_ballot();
    revoke all on all functions in schema private from public,anon,authenticated,service_role;
    revoke all on function public.kandid_lock_board_electorate(integer),public.kandid_get_board_electorate_preview(integer),public.kandid_get_student_ballot_candidates(integer),public.kandid_is_locked_electorate_member(integer,integer),public.insert_v2_vote_rows(integer,integer,jsonb),public.resolve_student_organization_participation(integer,integer,integer) from public,anon,authenticated,service_role;
    grant execute on function public.kandid_lock_board_electorate(integer),public.kandid_get_board_electorate_preview(integer),public.kandid_get_student_ballot_candidates(integer) to authenticated;
    grant execute on function public.insert_v2_vote_rows(integer,integer,jsonb),public.kandid_is_locked_electorate_member(integer,integer),public.resolve_student_organization_participation(integer,integer,integer) to service_role;
    alter table public.vote_ballots enable row level security;alter table public.votes enable row level security;
    alter table private.election_eligible_voters enable row level security;
    revoke all on private.election_eligible_voters,public.vote_ballots,public.votes from public,anon,authenticated,service_role;
    grant select on public.vote_ballots,public.votes,public.students,public.elections,public.academic_terms,public.student_term_enrollments,public.student_organization_terms,public.organizations,public.positions,public.candidates,public.admin_users to service_role;`);
  run(service("select * from public.insert_v2_vote_rows(1,3,'[{\"position_id\":2,\"candidate_id\":3,\"is_abstain\":false}]'::jsonb)"));
  const untouched=preserved();
  run(proposal);
  assert.deepEqual(counts(),[0,0,0]);
  pass("install creates only the authenticated recovery RPC; records remain unchanged");
  for(const role of ["anon","service_role"])assert.match(run(`begin;set local role ${role};${recover};`,false).stderr,/permission denied/);
  for(const n of [2,3,101])assert.match(run("begin;"+actor(n)+recover+";",false).stderr,/assignment|unavailable/);
  assert.match(run("begin;set local role authenticated;"+recover+";",false).stderr,/Authentication required/);
  pass("anonymous, service, Student, disabled Board and foreign Board cannot recover");
  for(const mutation of [
    "update public.student_term_enrollments set enrollment_status='not_enrolled' where student_id=2 and academic_term_id=1",
    "update public.student_organization_terms set status='pending' where student_id=2 and organization_id=2 and academic_term_id=1",
    "update public.student_organization_terms set status='active' where student_id=3 and organization_id=2 and academic_term_id=1",
    "update public.elections set status='closed' where id=4",
    "update public.elections set end_date=timezone('Asia/Manila',now())-interval '1 hour' where id=4",
    "insert into private.election_eligible_voters(election_id,student_id) values(4,1)",
    "update public.vote_ballots set election_id=4 where election_id=3",
    "update public.votes set election_id=4 where election_id=3",
    "insert into public.eligibility_rules(election_id,program) values(4,'BSIT')",
  ]) {run("begin;"+mutation+";"+actor(1)+recover+";",false);assert.deepEqual(counts(),[0,0,0]);}
  pass("changed eligibility/count, rules, expired/closed state, partial snapshot and any ballot/vote history abort atomically");
  assert.match(run("begin;create function private.fail_recovery_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure';end;$$;create trigger fail_recovery_audit before insert on public.audit_logs for each row execute function private.fail_recovery_audit();"+actor(1)+recover+";",false).stderr,/synthetic audit failure/);
  assert.deepEqual(counts(),[0,0,0]);pass("audit failure rolls snapshot and freeze back together");
  assert.match(run("begin;"+actor(1)+"select public.kandid_lock_board_electorate(4);",false).stderr,/Voting start has passed/);
  const pending=asyncSql("begin;set application_name='kandid_e4_uncommitted';"+actor(1)+recover+";select pg_sleep(5);rollback;");
  let sleeping=false;for(let n=0;n<20;n++){
    sleeping=last(run("select exists(select 1 from pg_stat_activity where application_name='kandid_e4_uncommitted' and wait_event='PgSleep');"))==="t";
    if(sleeping)break;await delay(50);
  }
  assert.ok(sleeping,"Uncommitted recovery must be observed");assert.deepEqual(counts(),[0,0,0]);
  assert.match(run(service("select * from public.insert_v2_vote_rows(1,4,'[{\"position_id\":1,\"candidate_id\":1,\"is_abstain\":false}]')"),false).stderr,/electorate is not locked/);
  assert.equal((await pending).status,0);assert.deepEqual(counts(),[0,0,0]);
  pass("concurrent ballot cannot see or submit against an uncommitted electorate");
  const parallel=await Promise.all([asyncSql("begin;"+actor(1)+recover+";commit;"),asyncSql("begin;"+actor(1)+recover+";commit;")]);
  assert.equal(parallel.filter(r=>r.status===0).length,1);
  assert.match(parallel.find(r=>r.status!==0).stderr,/already finalized/);
  assert.deepEqual(counts(),[2,0,0]);assert.equal(last(run("select count(*) from public.audit_logs where election_id=4;")),"1");
  assert.equal(last(run("select md5(pg_get_functiondef('public.kandid_lock_board_electorate(integer)'::regprocedure));")),"0fe4a3556ac668b31b25f86af1a04cbf");
  pass("concurrent recovery commits exactly two members and one audit without changing normal finalization");
  const choiceRows=json("begin;"+actor(101)+"select public.kandid_get_student_ballot_candidates(4);commit;");
  assert.equal(choiceRows.length,2);writeFileSync(resolve(evidence,"candidates.json"),JSON.stringify(choiceRows,null,2));
  assert.match(run("begin;"+actor(103)+"select public.kandid_get_student_ballot_candidates(4);",false).stderr,/Ballot choices are unavailable/);
  assert.deepEqual(json("begin;"+actor(101)+"select public.kandid_get_student_ballot_candidates(5);commit;"),[]);
  assert.match(run("delete from private.election_eligible_voters where election_id=4;",false).stderr,/locked electorate/);
  assert.match(run("update public.elections set start_date=start_date+interval '1 hour' where id=4;",false).stderr,/immutable/);
  pass("eligible candidates load; ineligible/expired access fails and frozen roster/schedule stay immutable");

  // Execute unchanged handlers. Only Auth lookup and Supabase HTTP transport
  // are replaced; every persisted row and insertion RPC uses real local PG.
  class Query {
    constructor(table){assert.match(table,/^[a-z_]+$/);this.table=table;this.filters=[];this.singleRow=false;this.offset=0;}
    select(fields,options={}){this.fields=fields;this.options=options;return this;}
    eq(k,v){assert.match(k,/^[a-z_]+$/);this.filters.push(k+"="+literal(v));return this;}
    in(k,v){this.filters.push(k+" in ("+v.map(literal).join(",")+")");return this;}
    limit(n){this.n=n;return this;}
    range(a,b){this.offset=a;this.n=b-a+1;return this;}
    order(){return this;}
    single(){this.singleRow=true;return this;}
    maybeSingle(){this.singleRow=true;return this;}
    then(yes,no){return Promise.resolve().then(()=>{
      const where=this.filters.length?" where "+this.filters.join(" and "):"";
      const rows=json(service("select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from(select * from public."+this.table+where+(this.n?" limit "+this.n:"")+" offset "+this.offset+") t"));
      if(this.options.head)return {data:null,count:rows.length,error:null};
      const data=rows.map(row=>{
        const result=Object.fromEntries(this.fields.split(",").map(k=>k.trim()).filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
        if(this.table==="votes"&&this.fields.includes("elections(")){
          result.elections={title:"Synthetic Election",organizations:{name:"Synthetic Organization",description:"",logo_url:null}};
          result.positions={id:row.position_id,name:"Chairman",display_order:1};
        }
        return result;
      });return {data:this.singleRow?data[0]??null:data,error:null};
    }).then(yes,no);}
  }
  const admin={from:table=>new Query(table),rpc:async(name,args)=>{
    let query;
    if(name==="resolve_student_organization_participation")query=`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.${name}(${args.target_student_id},${args.target_organization_id},${args.target_academic_term_id}) t`;
    else if(name==="kandid_is_locked_electorate_member")query=`select to_jsonb(public.${name}(${args.p_election_id},${args.p_student_id}))`;
    else if(name==="insert_v2_vote_rows")query=`select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.${name}(${args.p_student_id},${args.p_election_id},${literal(JSON.stringify(args.p_votes))}::jsonb) t`;
    else throw Error("Unexpected RPC "+name);
    const r=docker(psql,service(query));return r.status===0?{data:JSON.parse(last(r)),error:null}:{data:null,error:{message:r.stderr}};
  }};
  let nudges=0;
  function loadHandler(path){
    let handler;const bindings={...security,...accessContracts,ethers,hasDuplicateCandidateSelection,hasCurrentTermEnrollment,isWithinGeofence,parseCoordinates,
      verifyLegacyVoteAnchorEvidence(){throw Error("Unrelated blockchain action prohibited");},
      createClient:(_url,key,options)=>key==="synthetic-service"?admin:{auth:{getUser:async()=>{
        const token=options?.global?.headers?.Authorization?.replace("Bearer ","");
        const n=Number(token?.replace("synthetic-",""));return n?{data:{user:{id:uid(100+n)}},error:null}:{data:{user:null},error:Error("Invalid synthetic JWT")};
      }}},
      Deno:{env:{get:k=>({SUPABASE_URL:"https://synthetic.invalid",SUPABASE_ANON_KEY:"synthetic-anon",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"})[k]}},
      fetch(){nudges++;throw Error("No external requests allowed");},
      console:{warn(){},error(){},log(){}},serveWithKandidCors:fn=>{handler=fn;},
    };
    const code=transformSync(readFileSync(path,"utf8"),{loader:"ts",format:"esm",target:"es2022"}).code.replace(/^import\s[\s\S]*?;\n/gm,"");
    new Function(...Object.keys(bindings),code)(...Object.values(bindings));return handler;
  }
  const handlers={"submit-vote":loadHandler(resolve(root,"supabase/functions/submit-vote/index.ts")),
    "get-student-ballot-receipt":loadHandler(resolve(root,"supabase/functions/get-student-ballot-receipt/index.ts")),
    "vote-access":loadHandler(resolve(evidence,"deployed-functions-vote-access-index.ts"))};
  let student=1;
  const request=async(name,body,token="synthetic-"+student)=>{
    assert.ok(handlers[name]);return handlers[name](new Request("https://synthetic.invalid/"+name,{method:"POST",headers:{Origin:"http://localhost:5174",Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(body)}));
  };
  const fakeClient={auth:{getSession:async()=>({data:{session:{access_token:"synthetic-"+student}},error:null})},functions:{invoke:async(name,options)=>{
    // Match SDK error propagation when the scoped transport denies enrichment
    // for an unrelated historical election returned by the owned receipt list.
    if(!isAllowedDevelopmentProductionRequest({input:"https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/"+name,method:"POST",headers:options.headers,body:JSON.stringify(options.body),allowElection4Recovery:true})) {
      return {data:null,error:Error("Scoped development transport denied this request")};
    }
    const r=await request(name,options.body,options.headers.Authorization.replace("Bearer ",""));
    const body=await r.json();return {data:body,error:r.ok?null:Error(body.error)};
  }}};
  const transport=async(input,init)=>{
    assert.equal(isAllowedDevelopmentProductionRequest({input,method:init.method,headers:init.headers,body:init.body,allowElection4Recovery:true}),true);
    assert.equal(new URL(input).pathname,"/functions/v1/submit-vote");
    return request("submit-vote",JSON.parse(init.body),init.headers.Authorization.replace("Bearer ",""));
  };
  const loadFrontend=(path,extra={},enabled=true)=>{
    const module={exports:{}};
    const code=transformSync(readFileSync(resolve(root,path),"utf8"),{loader:"js",format:"cjs",target:"es2022",define:{
      "import.meta.env.MODE":JSON.stringify("development"),"import.meta.env.VITE_ENABLE_ELECTION_4_RECOVERY":JSON.stringify(String(enabled)),
      "import.meta.env.VITE_SUPABASE_URL":JSON.stringify("https://fszgdxqxonqqcrzsnkca.supabase.co"),"import.meta.env.VITE_SUPABASE_KEY":JSON.stringify("synthetic-public")}}).code;
    new Function("require","module","exports",code)(name=>{
      if(name.includes("supabaseClient"))return {supabase:fakeClient,guardedSupabaseFetch:transport};
      if(name.includes("localProductionReadOnly"))return {READ_ONLY_DASHBOARD_MODE:"localhost-production-readonly"};
      if(name.includes("positionOrder"))return {sortVotesByPositionOrder:rows=>rows};
      if(name.includes("/time"))return {parseUtcTimestamp:v=>new Date(v),formatAbsoluteTimestampAsManilaDateTime:v=>v};
      if(name.includes("voteAccess"))return extra;
      throw Error("Unexpected import "+name);
    },module,module.exports);return module.exports;
  };
  const access=loadFrontend("src/utils/voteAccess.js");
  const frontend=loadFrontend("src/utils/voting.js",access);
  const receiptUI=loadFrontend("src/pages/student/receiptData.js",access);
  const candidateSelection={1:{position_id:1,candidate_id:choiceRows[0].id,is_abstain:false}};
  assert.ok((await loadFrontend("src/utils/voting.js",access,false).submitBallot({electionId:4,selectedVotes:candidateSelection})).error);
  assert.ok((await frontend.submitBallot({electionId:3,selectedVotes:candidateSelection})).error);
  pass("localhost remains blocked by default; explicit activation is limited to Election 4");
  const selected=await frontend.submitBallot({electionId:4,selectedVotes:candidateSelection,location:null});
  assert.equal(selected.error,null);assert.match(selected.ballotId,/^[0-9a-f-]{36}$/);assert.deepEqual(counts(),[2,1,1]);
  const receipts=await receiptUI.fetchStudentVotes(9999);assert.equal(receipts.error,null);
  const own=receipts.data.find(r=>r.election_id===4);
  assert.equal(own.ballot.ballot_id,selected.ballotId);assert.equal(own.ballot.blockchain_anchor_status,"pending");
  assert.match(own.ballot.ballot_hash,/^0x[a-f0-9]{64}$/);assert.equal(own.ballot.blockchain_tx_id,null);
  assert.equal(receiptUI.getNormalizedBlockchainStatus(own.ballot),"pending");
  assert.notEqual(receiptUI.getReceiptBlockchainStatusMeta({ballot:own.ballot,votes:[own]}).label,"Blockchain verification complete");
  for(const key of ["student_id","candidate_id","vote_nonce","ballot_nonce"])assert.equal(Object.hasOwn(own.ballot,key),false);
  pass("candidate selection passes actual frontend, submission handler, atomic SQL and owned receipt retrieval with pending anchoring");
  const duplicate=await frontend.submitBallot({electionId:4,selectedVotes:candidateSelection});
  assert.equal(duplicate.alreadyVoted,true);assert.ok(duplicate.error);assert.deepEqual(counts(),[2,1,1]);
  assert.equal((await frontend.hasStudentVotedInElection(9999,4,fakeClient)).hasVoted,true);
  pass("duplicate submission rejected by persisted SQL state and subsequent voted check");
  student=2;
  const foreign=await request("get-student-ballot-receipt",{election_id:4,ballot_id:selected.ballotId});
  assert.equal((await foreign.json()).data.ballot,null);
  const abstained=await frontend.submitBallot({electionId:4,selectedVotes:{1:{position_id:1,is_abstain:true}}});
  assert.equal(abstained.error,null);assert.deepEqual(counts(),[2,2,2]);
  assert.equal(last(run("select is_abstain and candidate_id is null from public.votes where election_id=4 and student_id=2;")),"t");
  const abstainReceipt=await receiptUI.fetchStudentVotes(1);assert.equal(abstainReceipt.data[0].ballot.ballot_id,abstained.ballotId);
  pass("abstention commits its null candidate and owned receipt; foreign receipt cannot be retrieved");
  student=3;assert.equal((await request("submit-vote",{election_id:4,selected_votes:candidateSelection})).status,403);
  assert.equal((await request("submit-vote",{election_id:4,selected_votes:candidateSelection},"invalid")).status,401);
  assert.equal((await request("submit-vote",{election_id:5,selected_votes:candidateSelection})).status,409);
  assert.equal(nudges,0);assert.equal(preserved(),untouched);
  assert.equal(last(run("select start_date='2026-10-21 01:00:00'::timestamp and end_date='2026-10-21 22:00:00'::timestamp from public.elections where id=4;")),"t");
  pass("ineligible/expired/unauthenticated attempts fail; no worker requests, schedule changes or unrelated record changes");
  const sources=["supabase/proposals/election-4-current-window-recovery.sql","supabase/functions/submit-vote/index.ts","supabase/functions/get-student-ballot-receipt/index.ts","src/lib/supabaseClient.js","src/utils/voting.js","src/utils/developmentProductionWriteGuard.js"];
  writeFileSync(resolve(evidence,"results.json"),JSON.stringify({result:"PASS",checks:checks.length,details:checks,postgres:"17",syntheticAuthAndHttp:true,productionRequests:0,blockchainRequests:nudges,
    files:sources.map(path=>({path,sha256:createHash("sha256").update(readFileSync(resolve(root,path))).digest("hex")}))},null,2)+"\n");
  console.log(JSON.stringify({checks:checks.length,productionRequests:0,blockchainRequests:nudges}));
} finally {
  assert.match(database,/^kandid_e4_recovery_[a-f0-9]{12}$/);
  const cleanup=docker(["exec",container,"dropdb","-U","postgres","--force",database]);assert.equal(cleanup.status,0,cleanup.stderr);
}
