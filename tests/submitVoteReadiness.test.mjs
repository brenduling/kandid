// Executes the existing Edge Function handlers with synthetic clients only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import test from "node:test";
import * as security from "../supabase/functions/_shared/kandidProductionSecurity.mjs";
import { hasDuplicateCandidateSelection } from "../supabase/functions/_shared/ballotSelection.js";
import { hasCurrentTermEnrollment } from "../supabase/functions/_shared/currentTermEnrollment.js";
import { isWithinGeofence, parseCoordinates } from "../supabase/functions/_shared/geofence.js";

const hours = n => new Date(Date.now() + (8+n)*3600000).toISOString().slice(0,19);
const validBody = () => ({ election_id: 3, selected_votes: { 11: { position_id: 11, candidate_id: 201, is_abstain: false } } });
function harness(options={}) {
  const calls=[], writes=[], nudges=[];
  const env={ SUPABASE_URL:"https://synthetic.invalid",SUPABASE_ANON_KEY:"synthetic-anon",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",...options.env };
  const tables={
    students:[{id:101,auth_user_id:"trusted-student",status:"active",precinct_code:"A",batch_code:"B",...options.student}],
    elections:[{id:3,organization_id:2,academic_term_id:1,electorate_policy_version:1,electorate_frozen_at:new Date().toISOString(),status:"active",campaign_start:hours(-72),campaign_end:hours(-48),start_date:hours(-1),end_date:hours(1),voting_access_mode:"anywhere",...options.election}],
    academic_terms:options.terms||[{id:1,status:"active"}],
    student_term_enrollments:options.enrollments||[{student_id:101,academic_term_id:1,enrollment_status:"enrolled"}],
    positions:options.positions||[{id:11,election_id:3,max_votes:1,status:"active"}],
    candidates:options.candidates||[{id:201,position_id:11}],
    election_access_tokens:[],
    vote_ballots:options.ballots||[],
  };
  class Query {
    constructor(table){this.table=table;this.filters=[];this.one=false;}
    select(fields){calls.push({table:this.table,fields});return this;}
    eq(key,value){this.filters.push(row=>row[key]===value);return this;}
    in(key,values){this.filters.push(row=>values.includes(row[key]));return this;}
    single(){this.one=true;return this;}
    maybeSingle(){this.one=true;return this;}
    limit(n){this.n=n;return this;}
    order(){return this;}
    insert(){throw Error("Unexpected direct insert");}
    update(){throw Error("Unexpected direct update");}
    delete(){throw Error("Unexpected direct delete");}
    then(accept,reject){
      const filtered=(tables[this.table]||[]).filter(row=>this.filters.every(fn=>fn(row)));
      const rows=this.n?filtered.slice(0,this.n):filtered;
      return Promise.resolve({data:this.one?rows[0]??null:rows,error:null}).then(accept,reject);
    }
  }
  const admin={
    from:table=>new Query(table),
    rpc:async(name,args)=>{
      calls.push({rpc:name,args});
      if(name==="resolve_student_organization_participation") return {data:[{allowed:options.participation!==false}],error:null};
      if(name==="kandid_is_locked_electorate_member") return {data:options.member!==false,error:null};
      if(name==="insert_v2_vote_rows"){
        if(options.duplicate) return {data:null,error:{message:"This student has already voted in this election."}};
        if(options.insertError) return {data:null,error:{message:"Synthetic insertion failure"}};
        if(options.emptyInsert) return {data:[],error:null};
        writes.push(structuredClone(args));
        return {data:[{vote_id:1,ballot_id:"10000000-0000-4000-8000-000000000001",canonical_vote_timestamp:"2026-10-21T00:00:00.000Z"}],error:null};
      }
      throw Error("Unexpected RPC "+name);
    },
  };
  const auth={auth:{getUser:async()=>options.invalidAuth?{data:{user:null},error:new Error("invalid")}:{data:{user:{id:"trusted-student"}},error:null}},
    rpc:async(name,args)=>{
      assert.equal(name,"kandid_check_student_ballot_eligibility");
      assert.deepEqual(args,{p_election_id:3}); calls.push({rpc:name,args,client:"student-jwt"});
      return {data:options.eligible!==false && options.participation!==false && tables.academic_terms.length===1 &&
        tables.academic_terms[0].id===tables.elections[0].academic_term_id &&
        tables.student_term_enrollments.some(row=>row.student_id===101 && row.academic_term_id===tables.elections[0].academic_term_id && row.enrollment_status==="enrolled"),
        error:options.eligibilityError?{code:"42501"}:null};
    }};
  let handler;
  const bindings={
    createClient:(_url,key)=>key==="synthetic-service"?admin:auth,
    ...security,
    serveWithKandidCors:fn=>{handler=req=>Promise.resolve(fn(req)).then(response=>security.withKandidCors(req,response));},
    hasDuplicateCandidateSelection,hasCurrentTermEnrollment,isWithinGeofence,parseCoordinates,
    Deno:{env:{get:key=>env[key]}},
    console:{error(){},warn(){},log(){}},
    fetch:async(url,init)=>{
      assert.ok(url.startsWith("https://synthetic.invalid/"));nudges.push({url,init});
      if(options.nudgeThrows)throw Error("Synthetic worker unavailable");
      return new Response("{}",{status:options.nudgeStatus||202});
    },
    EdgeRuntime:{waitUntil:promise=>promise.catch(()=>{})},
  };
  const source=readFileSync(options.receipt?"supabase/functions/get-student-ballot-receipt/index.ts":"supabase/functions/submit-vote/index.ts","utf8");
  const code=transformSync(source,{loader:"ts",format:"esm",target:"es2022"}).code.replace(/^import\s[\s\S]*?;\n/gm,"");
  new Function(...Object.keys(bindings),code)(...Object.values(bindings));
  return {calls,writes,nudges,tables,async request(body=validBody(),headers={}){
    const response=await handler(new Request("https://synthetic.invalid/function",{method:"POST",headers:{Authorization:"Bearer synthetic-student",Origin:"https://witkandid.vercel.app","Content-Type":"application/json",...headers},body:JSON.stringify(body)}));
    return {status:response.status,body:await response.json()};
  }};
}
test("submission derives Student identity from Auth and returns only the canonical receipt reference",async()=>{
  const h=harness();
  const response=await h.request({...validBody(),student_id:999,ballot_hash:"client-hash",nonce:"client-nonce"});
  assert.equal(response.status,200);assert.equal(h.writes.length,1);
  assert.equal(h.writes[0].p_student_id,101);
  assert.deepEqual(Object.keys(h.writes[0]).sort(),["p_election_id","p_student_id","p_votes"]);
  assert.deepEqual(h.writes[0].p_votes,[{position_id:11,candidate_id:201,is_abstain:false}]);
  assert.deepEqual(response.body,{data:{submitted_at:"2026-10-21T00:00:00.000Z",vote_count:1,ballot_id:"10000000-0000-4000-8000-000000000001"}});
  assert.equal(h.nudges.length,0);
});
for(const [label,options,status] of [
  ["invalid JWT",{invalidAuth:true},401],
  ["disabled Student",{student:{status:"disabled"}},403],
  ["identity mismatch",{student:{auth_user_id:"other"}},403],
  ["no current enrollment",{enrollments:[]},403],
  ["wrong term",{terms:[{id:2,status:"active"}]},403],
  ["ambiguous current terms",{terms:[{id:1,status:"active"},{id:2,status:"active"}]},403],
  ["revoked organization",{participation:false},403],
  ["canonical eligibility denial",{eligible:false},403],
  ["canonical eligibility unavailable",{eligibilityError:true},503],
  ["closed election",{election:{status:"closed"}},409],
  ["future voting",{election:{start_date:hours(1),end_date:hours(2)}},409],
  ["ended voting",{election:{start_date:hours(-2),end_date:hours(-1)}},409],
  ["unsupported access mode",{election:{voting_access_mode:"unknown"}},409],
  ["missing onsite QR",{election:{voting_access_mode:"onsite_qr"}},403],
  ["location required",{election:{voting_access_mode:"location_range"}},403],
]) test(label+" fails before ballot insertion",async()=>{
  const h=harness(options);assert.equal((await h.request()).status,status);assert.equal(h.writes.length,0);assert.equal(h.nudges.length,0);
});

test("unfrozen elections submit through live JWT eligibility without consulting a snapshot",async()=>{
  const h=harness({election:{electorate_frozen_at:null},member:false});
  assert.equal((await h.request()).status,200);assert.equal(h.writes.length,1);
  assert.ok(h.calls.some(call=>call.rpc==="kandid_check_student_ballot_eligibility" && call.client==="student-jwt"));
  assert.equal(h.calls.some(call=>call.rpc==="kandid_is_locked_electorate_member"),false);
});
test("foreign candidate and duplicate selections are rejected",async()=>{
  for(const [options,body] of [
    [{candidates:[{id:201,position_id:99}]},validBody()],
    [{}, {election_id:3,selected_votes:{11:{position_id:11,candidate_ids:[201,201],is_abstain:false}}}],
  ]){const h=harness(options);assert.equal((await h.request(body)).status,400);assert.equal(h.writes.length,0);}
});
test("abstain retains its null-candidate representation",async()=>{
  const h=harness();assert.equal((await h.request({election_id:3,selected_votes:{11:{position_id:11,is_abstain:true}}})).status,200);
  assert.deepEqual(h.writes[0].p_votes,[{position_id:11,candidate_id:null,is_abstain:true}]);
});
test("duplicate election vote and insertion errors never report success or nudge the worker",async()=>{
  for(const [options,status] of [[{duplicate:true},409],[{insertError:true},500],[{emptyInsert:true},500]]){
    const h=harness(options);const r=await h.request();assert.equal(r.status,status);assert.equal(h.writes.length,0);assert.equal(h.nudges.length,0);
    if(options.duplicate)assert.equal(r.body.already_voted,true);
  }
});
test("worker nudge happens only after successful insertion and never needs a blockchain key in the submitter",async()=>{
  const h=harness({env:{ANCHOR_WORKER_TOKEN:"synthetic-worker-only"}});
  assert.equal((await h.request()).status,200);assert.equal(h.writes.length,1);assert.equal(h.nudges.length,1);
  assert.equal(h.nudges[0].url,"https://synthetic.invalid/functions/v1/anchor-ballot-hashes");
  assert.equal(h.nudges[0].init.headers["x-anchor-worker-token"],"synthetic-worker-only");
});

test("missing or failing worker cannot invalidate a committed ballot or its receipt reference",async()=>{
  for(const options of [{},{env:{ANCHOR_WORKER_TOKEN:"synthetic-worker-only"},nudgeStatus:404},{env:{ANCHOR_WORKER_TOKEN:"synthetic-worker-only"},nudgeThrows:true}]){
    const h=harness(options);const r=await h.request();
    assert.equal(r.status,200);assert.equal(h.writes.length,1);
    assert.equal(r.body.data.ballot_id,"10000000-0000-4000-8000-000000000001");
    assert.equal(Object.hasOwn(r.body.data,"blockchain_tx_id"),false);
    assert.equal(h.nudges.length,options.env?1:0);
  }
});
test("receipt reader returns the caller's Ballot V1 verification fields without nonces, identity or choices",async()=>{
  const ballot={id:"10000000-0000-4000-8000-000000000001",election_id:3,student_id:101,ballot_hash:"synthetic-hash",hash_version:"KANDID_BALLOT_V1",canonical_submitted_at:"2026-10-21T00:00:00.000Z",blockchain_anchor_status:"pending",ballot_nonce:"must-not-return"};
  const h=harness({receipt:true,ballots:[ballot]});
  const r=await h.request({election_id:3,ballot_id:ballot.id,student_id:999});
  assert.equal(r.status,200);assert.equal(r.body.data.ballot.ballot_hash,"synthetic-hash");
  assert.equal(r.body.data.ballot.blockchain_anchor_status,"pending");
  for(const key of ["student_id","ballot_nonce","candidate_id"])assert.equal(Object.hasOwn(r.body.data.ballot,key),false);
  assert.equal(h.writes.length,0);
});
test("receipt ownership rejects a foreign ballot and disabled account",async()=>{
  const id="10000000-0000-4000-8000-000000000001";
  const foreign=harness({receipt:true,ballots:[{id,election_id:3,student_id:999}]});
  assert.deepEqual((await foreign.request({election_id:3,ballot_id:id})).body,{data:{ballot:null}});
  assert.equal((await harness({receipt:true,student:{status:"disabled"}}).request({election_id:3})).status,403);
});
for(const policy of [0,1])for(const status of ["done","closed","archived","draft","paused","voting","unknown",null])test(`policy ${policy}: ${status} cannot reopen through in-window dates`,async()=>{
  const h=harness({election:{status,electorate_policy_version:policy}});
  assert.equal((await h.request()).status,409);assert.equal(h.writes.length,0);assert.equal(h.nudges.length,0);
  assert.equal(h.calls.some(call=>call.rpc==="insert_v2_vote_rows"),false);
});

test("active legacy elections retain the authorized in-window submission contract",async()=>{
  const h=harness({election:{electorate_policy_version:0}});
  assert.equal((await h.request()).status,200);assert.equal(h.writes.length,1);
});
test("inactive positions do not make a complete active ballot appear incomplete",async()=>{
  const h=harness({positions:[{id:11,election_id:3,max_votes:1,status:"active"},{id:12,election_id:3,max_votes:1,status:"retired"}]});
  assert.equal((await h.request()).status,200);assert.equal(h.writes.length,1);
  assert.deepEqual(h.writes[0].p_votes,[{position_id:11,candidate_id:201,is_abstain:false}]);
});

test("inactive positions cannot replace or extend the active ballot",async()=>{
  const positions=[{id:11,election_id:3,max_votes:1,status:"active"},{id:12,election_id:3,max_votes:1,status:"retired"}];
  for(const selected_votes of [
    {12:{position_id:12,candidate_id:202,is_abstain:false}},
    {11:validBody().selected_votes[11],12:{position_id:12,is_abstain:true}},
    {11:{position_id:11,candidate_id:202,is_abstain:false}},
  ]){
    const h=harness({positions,candidates:[{id:201,position_id:11},{id:202,position_id:12}]});
    assert.equal((await h.request({election_id:3,selected_votes})).status,400);
    assert.equal(h.writes.length,0);assert.equal(h.nudges.length,0);
  }
});

test("empty active ballots and omitted active positions are denied",async()=>{
  for(const positions of [[],[{id:11,election_id:3,status:"retired"}],[{id:11,election_id:3,max_votes:1,status:"active"},{id:12,election_id:3,max_votes:1,status:"active"}]]){
    const h=harness({positions});assert.equal((await h.request()).status,400);assert.equal(h.writes.length,0);
  }
});
