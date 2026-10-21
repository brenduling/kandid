import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import test from "node:test";

// Exercise existing UI receipt helpers without a browser, session or network.
const module={exports:{}};
const code=transformSync(readFileSync("src/pages/student/receiptData.js","utf8"),{loader:"js",format:"cjs",target:"es2022"}).code;
new Function("require","module","exports",code)(name=>{
  if(name.includes("supabaseClient"))return {supabase:{}};
  if(name.includes("voteAccess"))return {callVoteAccess:()=>{throw Error("No network allowed");}};
  if(name.includes("positionOrder"))return {sortVotesByPositionOrder:rows=>rows};
  if(name.includes("time"))return {formatAbsoluteTimestampAsManilaDateTime:()=>"synthetic time",parseUtcTimestamp:value=>new Date(value)};
  throw Error("Unexpected import "+name);
},module,module.exports);
const helpers=module.exports;

test("a recorded unanchored ballot remains pending and never displays blockchain completion",()=>{
  const ballot={id:"synthetic-ballot",hash_version:"KANDID_BALLOT_V1",ballot_hash:"0x"+"a".repeat(64),blockchain_anchor_status:"pending",blockchain_tx_id:null};
  const receipt={ballot,votes:[{ballot_id:ballot.id,blockchain_anchor_status:"ballot_grouped"}]};
  assert.equal(helpers.getReceiptBlockchainRecord(receipt),ballot);
  assert.equal(helpers.getNormalizedBlockchainStatus(ballot),"pending");
  assert.equal(helpers.getReceiptBlockchainStatusMeta(receipt).className,"pending");
  assert.match(helpers.getReceiptBlockchainStatusMeta(receipt).detail,/still processing/);
  assert.deepEqual(helpers.getVerificationCounts([ballot]),{anchored:0,total:1});
});

test("missing ballot enrichment is unavailable rather than inferred from grouped row hashes",()=>{
  const receipt={votes:[{ballot_id:"synthetic-ballot",vote_hash:"synthetic-row-hash",blockchain_anchor_status:"ballot_grouped"}]};
  assert.equal(helpers.getReceiptBlockchainRecord(receipt),null);
  assert.match(helpers.getReceiptBlockchainStatusMeta(receipt).label,/unavailable/);
});
