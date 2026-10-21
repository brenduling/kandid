import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedDevelopmentProductionRequest as allowed } from "../src/utils/developmentProductionWriteGuard.js";

const request=(path,body,overrides={})=>allowed({input:"https://fszgdxqxonqqcrzsnkca.supabase.co"+path,
  method:"POST",headers:{Authorization:"Bearer synthetic-test"},body:JSON.stringify(body),
  allowElection4Recovery:true,...overrides});
const selection={election_id:4,selected_votes:{1:{position_id:1,candidate_id:2,is_abstain:false}},location:null};

test("Election 4 rollout stays off by default and admits only exact submission scope",()=>{
  assert.equal(request("/functions/v1/submit-vote",selection,{allowElection4Recovery:false}),false);
  assert.equal(request("/functions/v1/submit-vote",selection),true);
  for(const body of [{...selection,election_id:3},{...selection,student_id:7},{...selection,selected_votes:[]},
    {...selection,selected_votes:null},{...selection,selected_votes:{}}]) {
    assert.equal(request("/functions/v1/submit-vote",body),false);
  }
});

test("a rollout flag never admits missing bearer headers, foreign hosts or alternate request paths",()=>{
  assert.equal(request("/functions/v1/submit-vote",selection,{headers:{}}),false);
  assert.equal(request("/functions/v1/submit-vote?override=true",selection),false);
  assert.equal(request("/functions/v1/submit-vote",selection,{input:"https://foreign.invalid/functions/v1/submit-vote"}),false);
  assert.equal(request("/functions/v1/submit-vote",selection,{method:"PUT"}),false);
});

test("receipt lookup stays Election 4 scoped and ownership cannot be supplied by the client",()=>{
  const body={election_id:4,ballot_id:"10000000-0000-4000-8000-000000000001"};
  assert.equal(request("/functions/v1/get-student-ballot-receipt",body),true);
  for(const denied of [{...body,election_id:2},{...body,student_id:1},{...body,ballot_id:"not-a-uuid"}]) {
    assert.equal(request("/functions/v1/get-student-ballot-receipt",denied),false);
  }
  assert.equal(request("/functions/v1/vote-access",{action:"student_receipts"}),true);
  assert.equal(request("/functions/v1/vote-access",{action:"student_receipts",student_id:1}),false);
});

test("one-time recovery accepts no arguments and retains the separate normal admin opt-in",()=>{
  const path="/rest/v1/rpc/kandid_recover_election4_electorate";
  assert.equal(request(path,{}),false);
  assert.equal(request(path,{},{allowBackendAuthorizedAdminCrud:true}),true);
  assert.equal(request(path,{p_election_id:4},{allowBackendAuthorizedAdminCrud:true}),false);
});

test("recovery rollout cannot insert votes/snapshots directly or activate a worker",()=>{
  for(const path of ["/rest/v1/votes","/rest/v1/vote_ballots","/rest/v1/election_eligible_voters",
    "/rest/v1/rpc/insert_v2_vote_rows","/functions/v1/anchor-ballot-hashes"]) {
    assert.equal(request(path,{election_id:4,student_id:1},{allowBackendAuthorizedAdminCrud:true}),false);
  }
});
