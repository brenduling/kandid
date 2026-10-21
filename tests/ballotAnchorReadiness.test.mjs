// Existing worker executed with synthetic RPC/provider/signer only. No network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import test from "node:test";
import { verifyLegacyVoteAnchorEvidence } from "../supabase/functions/_shared/legacyVoteAnchorEvidence.mjs";

function harness(options={}) {
  const calls=[];
  const ballot={ballot_id:"10000000-0000-4000-8000-000000000001",ballot_hash:"0x"+"a".repeat(64),blockchain_tx_id:"0x"+"b".repeat(64)};
  const env={ANCHOR_WORKER_TOKEN:"synthetic-token",SUPABASE_URL:"https://synthetic.invalid",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",SEPOLIA_RPC_URL:"https://synthetic.invalid/rpc",DEPLOYER_PRIVATE_KEY:"synthetic-no-private-key",VOTE_REGISTRY_ADDRESS:"0x"+"c".repeat(40),...options.env};
  const admin={rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==="claim_next_submitted_ballot_anchor")return {data:options.submitted?[ballot]:[],error:null};
    if(name==="acquire_ballot_anchor_signer_lease")return {data:options.busy!==true,error:null};
    if(name==="claim_next_ballot_anchor")return {data:options.pending===false?[]:[ballot],error:null};
    if(["mark_ballot_anchor_submitted","mark_ballot_anchor_success","mark_ballot_manual_review","mark_ballot_anchor_failure","release_ballot_anchor_signer_lease"].includes(name))return {data:null,error:options.persistError&&name==="mark_ballot_anchor_submitted"?{message:"synthetic failure"}:null};
    throw Error("Unexpected RPC "+name);
  }};
  let hasHash=options.submitted===true||options.recorded===true;
  const receipt=options.waiting?null:{status:options.failed?0:1,blockNumber:123,blockHash:"0x"+"e".repeat(64),hash:ballot.blockchain_tx_id,to:env.VOTE_REGISTRY_ADDRESS,logs:[{address:env.VOTE_REGISTRY_ADDRESS,name:"VoteHashRecorded",args:{voteHash:ballot.ballot_hash}}]};
  if(options.wrongContract&&receipt){receipt.to="0x"+"f".repeat(40);receipt.logs[0].address="0x"+"f".repeat(40);}
  if(options.missingEvent&&receipt)receipt.logs=[];
  if(options.wrongHash&&receipt)receipt.logs[0].args.voteHash="0x"+"9".repeat(64);
  if(options.failed&&receipt)receipt.status=0;
  if(options.submitted&&receipt&&options.failed)receipt.status=0;
  const provider={getNetwork:async()=>({chainId:options.wrongChain?1n:11155111n}),getBalance:async()=>10n**18n,getFeeData:async()=>({gasPrice:1n}),getTransactionReceipt:async()=>receipt,getBlock:async number=>({number,hash:"0x"+"e".repeat(64),timestamp:1792539000})};
  const signerAddress="0x"+"d".repeat(40);
  const record=async hash=>{calls.push({name:"send_transaction",hash});hasHash=true;return {hash:ballot.blockchain_tx_id,wait:async()=>receipt};};
  record.estimateGas=async()=>100000n;
  const registry={owner:async()=>options.wrongOwner?env.VOTE_REGISTRY_ADDRESS:signerAddress,isVoteHashRecorded:async()=>hasHash,recordVoteHash:record};
  class Interface { parseLog(log){if(!log||!log.name)return null;return {name:log.name,args:log.args};} }
  const ethers={Interface,JsonRpcProvider:class {constructor(){return provider;}},Wallet:class {async getAddress(){return signerAddress;}},Contract:class {constructor(){return registry;}}};
  let handler;
  const bindings={ethers,createClient:()=>admin,verifyLegacyVoteAnchorEvidence,Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn;}},console:{log(){},error(){},warn(){}}};
  const code=transformSync(readFileSync("supabase/functions/anchor-ballot-hashes/index.ts","utf8"),{loader:"ts",format:"esm",target:"es2022"}).code.replace(/^import\s[\s\S]*?;\n/gm,"");
  new Function(...Object.keys(bindings),code)(...Object.values(bindings));
  return {calls,async request(method="POST",token="synthetic-token"){
    const response=await handler(new Request("https://synthetic.invalid/anchor",{method,headers:{"x-anchor-worker-token":token}}));
    return {status:response.status,body:await response.json()};
  }};
}

test("worker rejects method, missing token configuration and invalid token before any queue access",async()=>{
  for(const [options,method,token,status] of [[{},"GET","synthetic-token",405],[{env:{ANCHOR_WORKER_TOKEN:undefined}},"POST","synthetic-token",500],[{},"POST","wrong",401]]){
    const h=harness(options);assert.equal((await h.request(method,token)).status,status);assert.deepEqual(h.calls,[]);
  }
});
test("missing blockchain settings, wrong chain and wrong owner fail before claiming work",async()=>{
  for(const options of [{env:{SEPOLIA_RPC_URL:undefined}},{wrongChain:true},{wrongOwner:true}]){
    const h=harness(options);assert.equal((await h.request()).status,500);assert.deepEqual(h.calls,[]);
  }
});
test("successful worker persists submitted transaction before confirming Ballot V1",async()=>{
  const h=harness();const r=await h.request();assert.equal(r.status,200);assert.equal(r.body.anchored,1);
  const names=h.calls.map(call=>call.name);
  assert.equal(names.filter(name=>name==="send_transaction").length,1);
  assert.ok(names.indexOf("acquire_ballot_anchor_signer_lease")<names.indexOf("claim_next_ballot_anchor"));
  assert.ok(names.indexOf("send_transaction")<names.indexOf("mark_ballot_anchor_submitted"));
  assert.ok(names.indexOf("mark_ballot_anchor_submitted")<names.indexOf("mark_ballot_anchor_success"));
  assert.equal(names.filter(name=>name==="release_ballot_anchor_signer_lease").length,1);
  assert.equal(h.calls.find(call=>call.name==="mark_ballot_anchor_submitted").args.p_network,"sepolia");
});
test("new and reconciled successful transactions require matching registry event and ballot hash",async()=>{
  for(const submitted of [false,true]){
    const h=harness({submitted,pending:!submitted});const r=await h.request();
    assert.equal(r.status,200);assert.equal(r.body.anchored,1);
    assert.ok(h.calls.some(call=>call.name==="mark_ballot_anchor_success"));
  }
});
test("wrong contract, absent event, and wrong event hash go to manual review without anchoring",async()=>{
  for(const submitted of [false,true])for(const evidence of [{wrongContract:true},{missingEvent:true},{wrongHash:true}]){
    const h=harness({submitted,pending:!submitted,...evidence});const r=await h.request();
    assert.equal(r.status,200);assert.equal(r.body.results.at(-1).status,"manual_review_required");
    assert.ok(h.calls.some(call=>call.name==="mark_ballot_manual_review"));
    assert.equal(h.calls.some(call=>call.name==="mark_ballot_anchor_success"),false);
  }
});
test("failed transaction receipts are failed, never marked anchored",async()=>{
  for(const submitted of [false,true]){
    const h=harness({submitted,pending:!submitted,failed:true});const r=await h.request();
    assert.equal(r.status,200);assert.equal(h.calls.some(call=>call.name==="mark_ballot_anchor_success"),false);
    assert.ok(h.calls.some(call=>call.name==="mark_ballot_anchor_failure"));
  }
});
test("confirmation timeout retains submitted status for reconciliation",async()=>{
  const h=harness({waiting:true});const r=await h.request();assert.equal(r.body.results[0].status,"submitted");
  assert.ok(h.calls.some(call=>call.name==="mark_ballot_anchor_submitted"));
  assert.equal(h.calls.some(call=>call.name==="mark_ballot_anchor_success"),false);
});
test("existing on-chain hash is sent to manual review without a duplicate transaction",async()=>{
  const h=harness({recorded:true});const r=await h.request();assert.equal(r.body.results[0].status,"manual_review_required");
  assert.ok(h.calls.some(call=>call.name==="mark_ballot_manual_review"));
  assert.equal(h.calls.some(call=>call.name==="send_transaction"),false);
});
test("failed transaction-hash persistence requires manual review and cannot claim anchoring success",async()=>{
  const h=harness({persistError:true});const r=await h.request();assert.equal(r.body.results[0].status,"blockchain_submitted_db_persist_failed");
  assert.ok(h.calls.some(call=>call.name==="mark_ballot_manual_review"));
  assert.equal(h.calls.some(call=>call.name==="mark_ballot_anchor_success"),false);
});
test("submitted transactions reconcile without resending and signer contention prevents a new claim",async()=>{
  const h=harness({submitted:true,pending:false});const r=await h.request();assert.equal(r.body.anchored,1);
  assert.equal(h.calls.some(call=>call.name==="send_transaction"),false);
  const busy=harness({busy:true});assert.equal((await busy.request()).body.results[0].status,"signer_busy");
  assert.equal(busy.calls.some(call=>call.name==="claim_next_ballot_anchor"),false);
});
