// Read-only JSON-RPC methods only. Never loads a signer, key or worker token.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Interface, getAddress } from 'ethers';
const project='fszgdxqxonqqcrzsnkca';
const registry='0x91fB285801A80017Db3A5a75F0b797a2B4c4198A';
const input=JSON.parse(readFileSync('.tmp/academic-term-cleanup-investigation/inventory.json','utf8'));
assert.equal(input.project,project);
const records=input.rows.filter(r=>['public.votes','public.vote_ballots'].includes(r.relation)).flatMap(r=>r.records);
const retained=JSON.parse(readFileSync('.tmp/academic-term-cleanup-investigation/evidence.json','utf8')).rows[0].evidence.all_anchor_evidence
  .filter(r=>r.anchor_status==='anchored'&&r.election_id!==2&&r.election_id!==1);
const targetHashes=records.map(r=>r.vote_hash||r.ballot_hash);
const hashes=[...new Set([...targetHashes,...retained.map(r=>r.hash)])];
assert.ok(hashes.length>0&&hashes.every(h=>/^0x[0-9a-f]{64}$/.test(h)));
// Read only the public contract address from the local frontend configuration.
// Never print env values, including RPC URLs that could contain credentials.
const config=readFileSync('.env','utf8').match(/^VITE_VOTE_REGISTRY_ADDRESS\s*=\s*["']?([^\s"']+)/m)?.[1];
if(config)assert.equal(getAddress(config),getAddress(registry),'Public frontend registry differs from the reviewed registry');
const abi=new Interface(['function isVoteHashRecorded(bytes32) view returns(bool)','function getVoteRecord(bytes32) view returns(bytes32 voteHash,uint256 recordedAt,address recorder)']);
const endpoints=['https://ethereum-sepolia-rpc.publicnode.com','https://sepolia.drpc.org'];
let rpcId=0;
async function rpc(endpoint,method,params){
  assert.ok(['eth_chainId','eth_blockNumber','eth_getCode','eth_call'].includes(method));
  let response;
  try{response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++rpcId,method,params}),signal:AbortSignal.timeout(12000),redirect:'error'});}
  catch{throw Error('READ_ONLY_RPC_UNAVAILABLE');}
  if(!response.ok)throw Error('READ_ONLY_RPC_HTTP_'+response.status);
  let data;try{data=await response.json();}catch{throw Error('READ_ONLY_RPC_INVALID_RESPONSE');}
  if(data.error||data.result===undefined)throw Error('READ_ONLY_RPC_REJECTED');
  return data.result;
}
const observations=[];
for(const endpoint of endpoints){
  try{
    assert.equal(BigInt(await rpc(endpoint,'eth_chainId',[])),11155111n);
    const block=await rpc(endpoint,'eth_blockNumber',[]);
    const code=await rpc(endpoint,'eth_getCode',[registry,block]);assert.notEqual(code,'0x','No deployed registry code');
    const results=[];
    for(const hash of hashes){
      const response=await rpc(endpoint,'eth_call',[{to:registry,data:abi.encodeFunctionData('isVoteHashRecorded',[hash])},block]);
      const recorded=abi.decodeFunctionResult('isVoteHashRecorded',response)[0];
      let record=null;
      if(recorded){const r=abi.decodeFunctionResult('getVoteRecord',await rpc(endpoint,'eth_call',[{to:registry,data:abi.encodeFunctionData('getVoteRecord',[hash])},block]));record={hash:r[0],recordedAt:r[1].toString(),recorder:r[2]};}
      results.push({hash,scope:targetHashes.includes(hash)?'target_term':'retained_outside_term',recorded,record});
    }
    observations.push({providerHost:new URL(endpoint).hostname,success:true,block:BigInt(block).toString(),results});
  }catch(error){observations.push({providerHost:new URL(endpoint).hostname,success:false,reason:/^[A-Z0-9_]+$/.test(error.message)?error.message:'READ_ONLY_RPC_VERIFICATION_FAILED'});}
}
const report={project,checkedAt:new Date().toISOString(),readOnly:true,chainId:11155111,registry,frontendRegistryMatched:!!config,observations,
  limitation:'Only the reviewed registry and these exact hashes are checked. No claim about unknown contracts or historical reorgs. On-chain evidence cannot be removed by SQL.'};
writeFileSync('.tmp/academic-term-cleanup-investigation/chain.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!observations.some(o=>o.success))process.exitCode=1;
