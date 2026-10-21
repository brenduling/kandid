import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { electorateLockBlock, finalizeElectorate } from "../src/utils/electorateFinalization.js";
import { loadStudentBallotCandidates } from "../src/utils/studentBallotReadiness.js";
import { fetchOrderedPositions } from "../src/utils/positionOrder.js";
import { isAllowedDevelopmentProductionRequest } from "../src/utils/developmentProductionWriteGuard.js";

const preview = { election_id:4,eligibility_contract:"declared-rules-v1",rule_count:1,eligible_voters:2,locking_allowed:true,is_locked:false };
const lock = { election_id:4,is_locked:true,eligible_voters:2,locked_at:"2026-10-21T00:00:00Z" };
function clientFor(results) {
  const calls=[];
  return { calls, rpc(name,args) { calls.push({name,args}); return {retry(value) { assert.equal(value,false); return Promise.resolve(results.shift()); }}; } };
}
test("legacy and missing-capability previews cannot finalize even when they report locking_allowed", async()=>{
  for(const value of [null,{...preview,eligibility_contract:undefined},{...preview,election_id:3},{...preview,rule_count:0},{...preview,eligible_voters:0},{...preview,locking_allowed:false,blocking_reason:"Voting start has passed."}]) {
    assert.ok(electorateLockBlock(value,4));
    const client=clientFor([{data:value}]);
    await assert.rejects(finalizeElectorate(client,4));assert.equal(client.calls.length,1);
  }
});
test("finalization refreshes capability then sends only election ID to the official lock RPC",async()=>{
  const client=clientFor([{data:preview},{data:lock}]);
  assert.deepEqual(await finalizeElectorate(client,4),lock);
  assert.deepEqual(client.calls,[{name:"kandid_get_board_electorate_preview",args:{p_election_id:4}},{name:"kandid_lock_board_electorate",args:{p_election_id:4}}]);
});
test("backend denials and uncertain finalization results never retry a mutation",async()=>{
  for(const result of [{error:{code:"42501",message:"denied"}},{data:{...lock,election_id:9}},{data:{...lock,is_locked:false}},{data:{...lock,eligible_voters:0}}]) {
    const client=clientFor([{data:preview},result]);
    await assert.rejects(finalizeElectorate(client,4));assert.equal(client.calls.length,2);
  }
});
test("unfrozen policy-v1 metadata gives actionable unavailable state without retrieving choices",async()=>{
  const client=clientFor([]);
  const result=await loadStudentBallotCandidates(client,{id:4,electorate_policy_version:1,electorate_frozen_at:null});
  assert.equal(result.error.code,"BALLOT_UNFINALIZED");assert.match(result.error.message,/Electoral Board.*not finalized/);assert.equal(client.calls.length,0);
});
test("a frozen timestamp still requires the authorized candidate RPC; denials expose no candidates",async()=>{
  const client=clientFor([{data:[{id:1}],error:{code:"42501",message:"Ballot choices are unavailable."},status:403}]);
  const result=await loadStudentBallotCandidates(client,{id:4,electorate_policy_version:1,electorate_frozen_at:"2026-10-21"});
  assert.deepEqual(result.data,[]);assert.match(result.error.message,/not available.*student account/);
  assert.deepEqual(client.calls[0].args,{p_election_id:4});
});
test("eligible published candidate display payload is preserved; expired RPC empty result stays empty",async()=>{
  for(const data of [[{id:1,position_id:4,students:{first_name:"Synthetic",last_name:"Candidate"},partylists:null}],[]]) {
    const result=await loadStudentBallotCandidates(clientFor([{data}]),{id:4,electorate_policy_version:1,electorate_frozen_at:"2026-10-21"});
    assert.equal(result.error,null);assert.deepEqual(result.data,data);
  }
});
test("malformed candidate responses fail closed",async()=>{
  const result=await loadStudentBallotCandidates(clientFor([{data:{candidates:[]}}]),{id:4});
  assert.ok(result.error);assert.deepEqual(result.data,[]);
});
test("active-only positions applies to ordered and legacy queries without affecting management defaults",async()=>{
  for(const activeOnly of [true,false]) for(const legacy of [true,false]) {
    const filters=[];let attempts=0;
    const client={from:()=>{const chain={select:()=>chain,order:()=>chain,eq:(...args)=>{filters.push(args);return chain;},then(resolve){resolve(legacy&&attempts++===0?{error:{message:'column display_order does not exist'}}:{data:[{id:4,display_order:1}]});}};return chain;}};
    assert.equal((await fetchOrderedPositions(client,4,{activeOnly})).error,undefined);
    assert.equal(filters.filter(([key])=>key==='status').length,activeOnly?(legacy?2:1):0);
  }
});
test("normal development admits only the trusted lock request, never manual snapshot or caller identity",()=>{
  const permit=(path,body,normal=true)=>isAllowedDevelopmentProductionRequest({input:'https://fszgdxqxonqqcrzsnkca.supabase.co'+path,method:'POST',body:JSON.stringify(body),allowBackendAuthorizedAdminCrud:normal});
  assert.equal(permit('/rest/v1/rpc/kandid_lock_board_electorate',{p_election_id:4}),true);
  assert.equal(permit('/rest/v1/rpc/kandid_lock_board_electorate',{p_election_id:4},false),false);
  for(const body of [{p_election_id:4,p_student_id:1},{p_election_id:4,p_actor_id:1},{p_election_id:0}]) assert.equal(permit('/rest/v1/rpc/kandid_lock_board_electorate',body),false);
  assert.equal(permit('/rest/v1/election_eligible_voters',{election_id:4,student_id:1}),false);
});
test("UI and backend preserve active positions, retry control and nonwriting unfinalized state",()=>{
  const page=readFileSync('src/pages/student/VotePage.jsx','utf8');
  assert.match(page,/activeOnly: true/);assert.match(page,/setSelectedVotes\(\{\}\)/);
  assert.match(page,/!voteCheck\?\.hasVoted/);assert.match(page,/if \(candidateError\) return/);
  const sql=readFileSync('supabase/proposals/election-4-ballot-finalization.sql','utf8');
  assert.match(sql,/p_election_id=4/);assert.match(sql,/eligibility_contract/);
  assert.match(sql,/for update/);assert.match(sql,/Existing voting history requires/);
  assert.match(sql,/Current|clock_timestamp/);
});
