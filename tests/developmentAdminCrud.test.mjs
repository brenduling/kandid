import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { fetchDevelopmentProductionRequest, isAllowedDevelopmentProductionRequest } from "../src/utils/developmentProductionWriteGuard.js";
import { isBoardStudentRegistrationEnabled } from "../src/utils/boardStudentRegistrationFeatureGate.js";
import { isBoardStudentManagementEnabled } from "../src/utils/boardStudentManagementFeatureGate.js";

const api = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const permit = (path, method, payload, extra = {}) => isAllowedDevelopmentProductionRequest({
  input: api + path, method, body: payload == null ? null : JSON.stringify(payload), allowBackendAuthorizedAdminCrud: true, ...extra,
});
for (const [label,path,method,payload] of [
  ["Board election title", "/rest/v1/elections?id=eq.92001&organization_id=eq.92001&select=id", "PATCH", { title:"Synthetic title" }],
  ["Super Admin election", "/rest/v1/elections?id=eq.92001", "PATCH", { title:"Synthetic title" }],
  ["election creation", "/rest/v1/elections?select=id", "POST", [{ organization_id:92001, academic_term_id:92001, title:"Synthetic draft",status:"draft" }]],
  ["position creation", "/rest/v1/positions", "POST", [{ election_id:92001,name:"Synthetic position",max_votes:1,display_order:1 }]],
  ["position edit", "/rest/v1/positions?id=eq.92001", "PATCH", { name:"Synthetic position" }],
  ["position deletion", "/rest/v1/positions?id=eq.92001", "DELETE", null],
  ["partylist creation", "/rest/v1/partylists", "POST", [{ organization_id:92001,name:"Synthetic party" }]],
  ["partylist edit", "/rest/v1/partylists?id=eq.92001", "PATCH", { name:"Synthetic party" }],
  ["partylist deletion", "/rest/v1/partylists?id=eq.92001", "DELETE", null],
  ["access token creation", "/rest/v1/election_access_tokens", "POST", [{ election_id:92001,token:"synthetic",scope_type:"general",scope_value:null,expires_at:null,is_active:true }]],
  ["access token deactivation", "/rest/v1/election_access_tokens?id=eq.92001", "PATCH", { is_active:false }],
  ["admin list", "/functions/v1/admin-user-management", "POST", { action:"list" }],
  ["admin creation", "/functions/v1/admin-user-management", "POST", { action:"create",admin:{ role:"electoral_board",organization_id:92001 } }],
  ["self profile", "/functions/v1/admin-user-management", "POST", { action:"update_self_profile",profile:{ photo_url:null } }],
  ["officer update", "/functions/v1/officers-contract", "POST", { action:"update_service",officer_id:92001,changes:{ status:"active" } }],
  ["officer delete", "/functions/v1/officers-contract", "POST", { action:"delete",officer_id:92001 }],
  ["officer result finalizer", "/functions/v1/officers-contract", "POST", { action:"finalize_results",election_id:92001 }],
  ["organization save", "/rest/v1/rpc/kandid_save_organization_configuration", "POST", { p_organization_id:null,p_name:"Synthetic",p_description:"",p_logo_url:null,p_organization_type:"non_departmental",p_program_ids:[] }],
  ["organization delete", "/rest/v1/rpc/kandid_delete_organization", "POST", { p_organization_id:92001 }],
  ["program catalog", "/rest/v1/rpc/kandid_ensure_program_catalog_entry", "POST", { p_code:"TEST" }],
  ["Board name edit", "/functions/v1/board-manual-enrollment", "POST", { action:"update_student_names",student_id:92001,changes:{ first_name:"Synthetic",last_name:"Student" } }],
  ["trusted soft removal", "/functions/v1/manage-election-removal", "POST", { action:"soft_remove",election_id:92001,password:"synthetic-test-only" }],
]) test(`normal development admits ${label} to its backend contract without temporary flags`, () => assert.equal(permit(path,method,payload),true));

for (const [path,method,payload] of [
  ["/rest/v1/votes","POST",{student_id:92001}],
  ["/rest/v1/vote_ballots?id=eq.92001","PATCH",{blockchain_anchor_status:"anchored"}],
  ["/functions/v1/submit-vote","POST",{election_id:92001}],
  ["/functions/v1/anchor-ballot-hashes","POST",{}],
  ["/functions/v1/anchor-vote-hashes","POST",{}],
  ["/rest/v1/rpc/insert_v2_vote_rows","POST",{}],
  ["/rest/v1/elections?id=eq.92001","PATCH",{electorate_frozen_at:"2099-01-01"}],
  ["/rest/v1/elections?id=eq.92001","PATCH",{electorate_policy_version:0}],
  ["/rest/v1/elections?id=eq.92001","PATCH",{academic_term_id:92002}],
  ["/rest/v1/elections?id=eq.92001","PATCH",{results_released_at:"2099-01-01"}],
  ["/rest/v1/elections?id=eq.92001","DELETE",null],
  ["/rest/v1/students?id=eq.92001","PATCH",{status:"active"}],
  ["/rest/v1/admin_users?id=eq.92001","PATCH",{role:"super_admin"}],
  ["/rest/v1/positions","PATCH",{name:"unscoped"}],
  ["/rest/v1/positions?or=(id.eq.92001,id.eq.92002)","DELETE",null],
  ["/functions/v1/officers-contract","POST",{action:"delete",officer_id:92001,actor_role:"super_admin"}],
  ["/rest/v1/rpc/kandid_super_admin_update_student","POST",{p_actor_admin_id:92001}],
  ["/rest/v1/__proto__","POST",{}],
  ["/rest/v1/rpc/constructor","POST",{}],
]) test(`protected/unsupported request remains blocked: ${method} ${path} ${JSON.stringify(payload)}`, () => assert.equal(permit(path,method,payload),false));

test("no localhost origin or stored-role claim is authorization; backend errors and JWT are untouched", async () => {
  for (const status of [401,403,409,422,500]) {
    const headers={Authorization:"Bearer synthetic-test-jwt",apikey:"synthetic-public-key"};
    const init={method:"PATCH",headers,body:'{"title":"Synthetic"}'};
    const response=await fetchDevelopmentProductionRequest(api+"/rest/v1/elections?id=eq.92001",init,async (url,received)=>{
      assert.equal(received,init);assert.equal(received.headers.Authorization,headers.Authorization);
      return new Response(JSON.stringify({message:"Backend rejected this request"}),{status});
    },{allowBackendAuthorizedAdminCrud:true});
    assert.equal(response.status,status);
  }
  assert.equal(permit('/rest/v1/elections?id=eq.92001','PATCH',{title:'Synthetic'},{input:'http://localhost:5174/rest/v1/elections?id=eq.92001'}),false);
  assert.equal(permit('/rest/v1/elections?id=eq.92001','PATCH',{title:'Synthetic'},{input:'https://jkkgzhteacaafdnpeomy.supabase.co/rest/v1/elections?id=eq.92001'}),false);
});

test("development UI gates defer to server permissions; production retains its explicit feature gates", () => {
  for (const feature of [isBoardStudentRegistrationEnabled,isBoardStudentManagementEnabled]) {
    assert.equal(feature({MODE:"development"}),true);
    assert.equal(feature({MODE:"production"}),false);
    assert.equal(feature({MODE:"localhost-production-readonly"}),false);
  }
});

test("alternate schemas and merge-upserts cannot fall through to the legacy allow-list", () => {
  const path='/rest/v1/positions?id=eq.92001&election_id=eq.92001&select=id';
  for(const headers of [{'content-profile':'private'},{'accept-profile':'private'},{prefer:'resolution=merge-duplicates'}]) {
    assert.equal(permit(path,'PATCH',{name:'Synthetic'},{headers}),false);
  }
});

function transportForMode(mode) {
  const source=readFileSync('src/lib/supabaseClient.js','utf8');
  const code=transformSync(source,{format:'cjs',define:{'import.meta.env':JSON.stringify({MODE:mode,VITE_SUPABASE_URL:api,VITE_SUPABASE_KEY:'synthetic-public-key'}),'import.meta.hot':'undefined'}}).code;
  const module={exports:{}};
  const imports={
    '@supabase/supabase-js':{createClient:()=>({})},
    '../utils/supabaseProfiler':{shouldProfileSupabase:()=>false},
    '../utils/localProductionReadOnly':{READ_ONLY_DASHBOARD_MODE:'localhost-production-readonly',isAllowedLocalProductionDashboardRequest:()=>false},
    '../utils/developmentProductionWriteGuard':{fetchDevelopmentProductionRequest},
  };
  new Function('require','module','exports',code)(name=>imports[name]||new Proxy({},{get:()=>()=>false}),module,module.exports);
  return module.exports.guardedSupabaseFetch;
}
test("actual Supabase client transport enables normal development, and inspection still blocks writes", async () => {
  const original=globalThis.fetch, originalWindow=globalThis.window;let calls=0;
  try {
    globalThis.window={localStorage:{getItem:()=>JSON.stringify({role:'super_admin',organization_id:92001})}};
    globalThis.fetch=async()=>{calls++;return new Response(null,{status:403});};
    const init={method:'PATCH',body:'{"title":"Synthetic"}'};
    assert.equal((await transportForMode('development')(api+'/rest/v1/elections?id=eq.92001',init)).status,403);
    await assert.rejects(transportForMode('localhost-production-readonly')(api+'/rest/v1/elections?id=eq.92001',init),/read-only/);
    await assert.rejects(transportForMode('development')(api+'/functions/v1/anchor-ballot-hashes',{method:'POST',body:'{}'}),/safeguard/);
    assert.equal(calls,1);
  } finally {globalThis.fetch=original;if(originalWindow===undefined)delete globalThis.window;else globalThis.window=originalWindow;}
});
