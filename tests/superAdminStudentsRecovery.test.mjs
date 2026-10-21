import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import test from 'node:test';
import {validateStudentCsv,STUDENT_CSV_REQUIRED_COLUMNS} from '../src/utils/studentCsvValidation.js';
import {invokeStudentManagement,studentManagementErrorMessage} from '../src/utils/studentManagementRequest.js';
import {loadSuperAdminStudentDirectory} from '../src/utils/superAdminStudentDirectory.js';
import * as cors from '../supabase/functions/_shared/kandidProductionSecurity.mjs';
import * as admission from '../supabase/functions/_shared/membershipAdmission.js';
const row={student_number:'90001',first_name:'Synthetic',last_name:'Student',program:'BSIT',year_level:'1',email:'test@example.invalid'};
const csv=(data=[row],more={})=>({data,meta:{fields:[...STUDENT_CSV_REQUIRED_COLUMNS,'email']},errors:[],...more});
test('CSV uses existing student columns and normalizes safe staged values only',()=>{const r=validateStudentCsv(csv([{...row,program:' bsit ',password:'must-not-forward',auth_user_id:'foreign'}]));assert.equal(r.validRows.length,1);assert.equal(r.validRows[0].program,'BSIT');assert.equal(Object.hasOwn(r.validRows[0],'password'),false);assert.equal(Object.hasOwn(r.validRows[0],'auth_user_id'),false);});
test('CSV blocks missing/duplicate headers, parsing errors and empty files',()=>{
  for(const options of [{meta:{fields:[]}}, {meta:{fields:STUDENT_CSV_REQUIRED_COLUMNS,renamedHeaders:{student_number_1:'student_number'}}},{errors:[{row:0,message:'Too many fields'}]}]){const r=validateStudentCsv(csv([row],options));assert.equal(r.validRows.length,0);assert.ok(r.errors.length);}
  assert.ok(validateStudentCsv(csv([])).errors.length);
});
test('CSV duplicate IDs reject every duplicate without choosing an overwrite winner',()=>{const r=validateStudentCsv(csv([row,{...row,first_name:'Other'}]));assert.equal(r.validRows.length,0);assert.equal(r.invalidRows.length,2);assert.match(r.invalidRows[0].reason,/rows 2, 3/);});
for(const [name,fields] of [['invalid ID',{student_number:'x'}],['invalid year',{year_level:'1.5'}],['out of range',{year_level:'7'}],['bad email',{email:'person@'}],['blank name',{first_name:'  '}]])test('CSV rejects '+name,()=>assert.equal(validateStudentCsv(csv([{...row,...fields}])).invalidRows.length,1));
test('CSV mixed files preserve valid/invalid counts and cap file size',()=>{const r=validateStudentCsv(csv([row,{...row,student_number:'90002',email:'bad'}]));assert.equal(r.validRows.length,1);assert.equal(r.invalidRows.length,1);assert.ok(validateStudentCsv(csv(Array.from({length:5001},()=>row))).errors.length);});
for(const [name,response,error,expected] of [
  ['success',{data:{outcome:'NEW_STUDENT_CREATED'}},null,null],
  ['explicit rejection',null,{context:new Response(JSON.stringify({error:'Validation rejected',code:'invalid_student'}),{status:400})},400],
  ['authorization',null,{context:new Response('{}',{status:403})},403],
  ['missing endpoint',null,{context:new Response('{}',{status:404})},404],
  ['interrupted body',null,{context:{status:200,json(){},clone(){return {json:async()=>{throw TypeError('interrupted');}};}}},200],
])test('student request '+name+' preserves outcome and never retries',async()=>{
  let calls=0;const r=await invokeStudentManagement({functions:{invoke:async()=>{calls++;return {data:response,error};}}},'synthetic-service',{action:'create_new_student_for_term'});
  assert.equal(calls,1);if(expected===null)assert.equal(r.error,null);else assert.equal(r.error.status,expected);
  if(name==='interrupted body')assert.equal(r.error.unconfirmed,true);
});
test('transport failure is unconfirmed and warns against repeating a possible write',async()=>{
  const r=await invokeStudentManagement({functions:{invoke:async()=>{throw TypeError('network');}}},'synthetic-service',{});
  assert.equal(r.error.unconfirmed,true);assert.match(studentManagementErrorMessage(r.error,{write:true}),/Refresh.*before retrying/);
  assert.match(studentManagementErrorMessage({status:403}),/Super Admin authorization/);
  assert.match(studentManagementErrorMessage({status:404}),/not deployed/);
});
test('empty or malformed success bodies never produce a false saved/imported result',async()=>{
  for(const data of [null,{}, {data:null}]){let calls=0;const r=await invokeStudentManagement({functions:{invoke:async()=>{calls++;return {data,error:null};}}},'synthetic-service',{});assert.equal(calls,1);assert.equal(r.error.unconfirmed,true);assert.match(studentManagementErrorMessage(r.error,{write:true}),/before retrying/);}
});
test('directory composes trusted listing, organization filter and visible membership enrichment',async()=>{
  let args;const result=await loadSuperAdminStudentDirectory({organizationMembers:async id=>{assert.equal(id,2);return {data:[{student_id:1}]};},listStudents:async input=>{args=input;return {data:{data:[{id:1}],total_count:1}};},memberships:async rows=>({data:rows.map(r=>({...r,student_organizations:[{organization_id:2}]}))})},{organization:'2',search:'test',status:'pending',sort:'id_desc',page:2,pageSize:10});
  assert.deepEqual(args.studentIds,[1]);assert.equal(args.sort,'id_desc');assert.equal(result.total,1);assert.equal(result.students[0].student_organizations.length,1);
});
test('directory empty organization avoids broadening to all students',async()=>{
  const result=await loadSuperAdminStudentDirectory({organizationMembers:async()=>({data:[]}),listStudents:async()=>{throw Error('Must not list all');}},{organization:'2'});assert.deepEqual(result,{students:[],total:0});
});
test('directory rejects malformed or failed records instead of showing mock success',async()=>{
  for(const result of [{error:Error('denied')},{data:{total_count:2,data:null}},{data:{data:[],total_count:-1}}])await assert.rejects(loadSuperAdminStudentDirectory({listStudents:async()=>result},{organization:'all'}));
});

function edge(file,state={}){
  const calls=[],writes=[];let handler;
  const authId='00000000-0000-4000-8000-000000000001';
  const profile={id:1,auth_user_id:authId,full_name:'Synthetic SA',role:'super_admin',status:'active',...state.profile};
  const admin=state.admin || {from(table){
    const q={select(){return q;},eq(){return q;},limit(){return q;},in(){return q;},order(){return q;},
      insert(value){writes.push({table,value});throw Error('Unexpected synthetic write');},
      maybeSingle:async()=>({data:table==='admin_users'?profile:null,error:null}),
    };return q;
  },rpc:async(name,args)=>{calls.push({name,args});return {data:{total_count:1,data:[{id:1,student_number:'90001',first_name:'Synthetic',last_name:'Student',status:'pending'}]},error:null};}};
  const code=transformSync(readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code;
  const module={exports:{}};
  new Function('require','module','exports','Deno','Request','Response','console',code)(specifier=>{
    if(specifier.includes('kandidProductionSecurity'))return {...cors,serveWithKandidCors:fn=>{handler=req=>Promise.resolve(fn(req)).then(res=>cors.withKandidCors(req,res));}};
    if(specifier.includes('membershipAdmission'))return admission;
    return {createClient:(_url,key)=>key==='anon'?{auth:{getUser:async()=>state.invalidAuth?{data:{user:null},error:Error('invalid')}:{data:{user:{id:authId}},error:null}}}:admin};
  },module,module.exports,{env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service'})[key]}},Request,Response,{error(){},warn(){},log(){}});
  return {calls,writes,request:(body={},options={})=>handler(new Request('https://synthetic.invalid/function',{method:options.method||'POST',headers:{Origin:options.origin||'http://localhost:5174',...(options.auth===false?{}:{Authorization:'Bearer synthetic'}),...(options.method==='OPTIONS'?{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,apikey,content-type,x-client-info'}:{'Content-Type':'application/json'})},...(options.method==='OPTIONS'?{}:{body:JSON.stringify(body)})}))};
}
for(const file of ['supabase/functions/super-admin-manual-enrollment/index.ts','supabase/functions/super-admin-masterlist-import/index.ts']){
  test(file+' permits trusted localhost preflight without DB clients/writes',async()=>{const h=edge(file);const r=await h.request({}, {method:'OPTIONS'});assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),'http://localhost:5174');assert.equal(h.calls.length+h.writes.length,0);});
  for(const [name,state,auth,status] of [['no JWT',{},false,401],['invalid session',{invalidAuth:true},true,401],['Board',{profile:{role:'electoral_board'}},true,403],['Student',{profile:{role:'student'}},true,403],['disabled SA',{profile:{status:'disabled'}},true,403]])test(file+' denies '+name,async()=>{const h=edge(file,state);const r=await h.request({action:'list_students'},{auth});assert.equal(r.status,status);assert.equal(h.calls.length+h.writes.length,0);});
  test(file+' rejects hostile origin before any data access',async()=>{const h=edge(file);assert.equal((await h.request({action:'list_students'},{origin:'https://untrusted.invalid'})).status,403);assert.equal(h.calls.length+h.writes.length,0);});
}
test('read-only directory action uses server actor and cannot perform any write',async()=>{const h=edge('supabase/functions/super-admin-manual-enrollment/index.ts');const r=await h.request({action:'list_students',search:'Synthetic',status:'pending',sort:'newest',page:1,page_size:10});assert.equal(r.status,200);assert.equal(h.calls[0].name,'kandid_super_admin_list_students');assert.equal(h.calls[0].args.p_actor_admin_id,1);assert.equal(h.writes.length,0);});
test('caller-supplied actors and unsupported legacy actions cannot reach mutations',async()=>{for(const body of [{action:'list_students',actor_admin_id:99},{action:'unknown',student:row},{student:row}]){const h=edge('supabase/functions/super-admin-manual-enrollment/index.ts');assert.equal((await h.request(body)).status,400);assert.equal(h.calls.length+h.writes.length,0);}});
test('masterlist invalid inputs fail before staging or account writes',async()=>{for(const rows of [[{...row,student_number:'bad'}],[{...row,year_level:20}]]){const h=edge('supabase/functions/super-admin-masterlist-import/index.ts');assert.equal((await h.request({action:'create_import',academic_term_id:1,rows})).status,400);assert.equal(h.writes.length,0);}});

// In-memory database adapter; these handlers never receive production clients.
function workflowFixture({alreadyEnrolled=false,denyAdmission=false,failFinalization=false}={}){
  const term={id:1,academic_year:'2026-2027',semester:'1st Semester',status:'active'};
  const db={admin_users:[{id:1,auth_user_id:'00000000-0000-4000-8000-000000000001',full_name:'Synthetic SA',role:'super_admin',status:'active'}],academic_terms:[term],organizations:[{id:3,name:'Synthetic Club',membership_scope:'manual',organization_type:'non_departmental'}],students:alreadyEnrolled?[{id:7,...row,status:'active',auth_user_id:'preserved',password:'synthetic-credential-marker'}]:[],student_term_enrollments:alreadyEnrolled?[{student_id:7,academic_term_id:1,program:'BSIT',year_level:1,enrollment_status:'enrolled'}]:[],masterlist_imports:[],masterlist_import_rows:[],audit_logs:[],student_organizations:[],organization_programs:[]};
  const calls=[];
  const admin={from(table){
    assert.ok(Object.hasOwn(db,table),'allowlisted synthetic table '+table);
    const filters=[];let operation,values,executed;
    const execute=()=>{if(executed)return executed;let data=db[table].filter(r=>filters.every(f=>f(r)));
      if(operation==='insert'){data=(Array.isArray(values)?values:[values]).map((r,i)=>({id:db[table].length+i+1,...r}));db[table].push(...data);}
      if(operation==='upsert'){for(const r of values)if(!db[table].some(v=>v.student_id===r.student_id&&v.organization_id===r.organization_id))db[table].push({...r});}
      return executed={data,error:null};};
    const q={select(){return q;},order(){return q;},limit(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,vs){filters.push(r=>vs.includes(r[k]));return q;},insert(v){operation='insert';values=v;return q;},upsert(v){operation='upsert';values=v;return q;},maybeSingle:async()=>{const r=execute();return {...r,data:r.data[0]||null};},single:async()=>{const r=execute();return {...r,data:r.data[0]||null};},then(resolve,reject){return Promise.resolve(execute()).then(resolve,reject);}};return q;
  },async rpc(name,args){calls.push({name,args});
    if(name==='create_manual_student_for_term_v1'){db.students.push({id:7,...row,status:'pending'});db.student_term_enrollments.push({student_id:7,academic_term_id:1,enrollment_status:'enrolled',program:'BSIT',year_level:1});return {data:[{outcome:'NEW_STUDENT_CREATED',student_id:7,student_status:'pending'}],error:null};}
    if(name==='enroll_existing_student_for_term_v1')return {data:[{outcome:'ALREADY_ENROLLED_CURRENT_TERM',student_id:7}],error:null};
    if(name==='kandid_check_student_organization_admission')return {data:{allowed:!denyAdmission,reason:denyAdmission?'NOT_CURRENTLY_ENROLLED':null},error:null};
    if(name==='kandid_ensure_program_catalog_entry_for_server_actor')return {data:[{id:1}],error:null};
    if(name==='ensure_student_organization_term_participation')return {data:[{status:'active',created:true}],error:null};
    if(name==='reconcile_masterlist_import'){db.masterlist_imports[0].import_status='review';for(const r of db.masterlist_import_rows)r.reconciliation_status=alreadyEnrolled?'continuing':'new';}
    if(name==='kandid_finalize_masterlist_import_with_membership_sync'){
      if(failFinalization)return {data:null,error:{message:'synthetic rollback'}};
      db.masterlist_imports[0].import_status='finalized';return {data:{membership_synced_count:1},error:null};
    }
    assert.ok(['kandid_super_admin_sync_current_term_memberships','reconcile_masterlist_import','kandid_review_current_term_program_changes'].includes(name),'expected RPC '+name);return {data:null,error:null};
  }};return {admin,db,calls};
}
test('manual create uses term RPC, membership sync and audit without creating an Auth account',async()=>{
  const f=workflowFixture(),h=edge('supabase/functions/super-admin-manual-enrollment/index.ts',f);
  const r=await h.request({action:'create_new_student_for_term',student:row});assert.equal(r.status,200);assert.equal((await r.json()).data.outcome,'NEW_STUDENT_CREATED');assert.equal(f.db.students.length,1);assert.equal(f.db.student_term_enrollments.length,1);assert.equal(f.db.audit_logs.length,1);assert.equal(f.calls[0].name,'create_manual_student_for_term_v1');
});
test('manual organization admission preserves an existing enrolled linked identity',async()=>{
  const f=workflowFixture({alreadyEnrolled:true}),before=JSON.stringify(f.db.students),h=edge('supabase/functions/super-admin-manual-enrollment/index.ts',f);
  const r=await h.request({action:'enroll_existing_student_for_term',student:{...row,organization_id:3}});assert.equal(r.status,200);assert.equal((await r.json()).data.outcome,'EXISTING_STUDENT_ORGANIZATION_ENROLLED');assert.equal(JSON.stringify(f.db.students),before);assert.equal(f.db.student_organizations.length,1);assert.equal(f.db.student_term_enrollments.length,1);
});
test('denied manual organization membership cannot enter enrollment or mutation RPCs',async()=>{
  const f=workflowFixture({alreadyEnrolled:true,denyAdmission:true}),h=edge('supabase/functions/super-admin-manual-enrollment/index.ts',f);const r=await h.request({action:'enroll_existing_student_for_term',student:{...row,organization_id:3}});assert.equal(r.status,409);assert.deepEqual(f.calls.map(c=>c.name),['kandid_check_student_organization_admission']);assert.equal(f.db.audit_logs.length,0);
});
for(const alreadyEnrolled of [false,true])test('CSV stages and finalizes '+(alreadyEnrolled?'existing linked':'new')+' records through the existing trusted workflow',async()=>{
  const f=workflowFixture({alreadyEnrolled}),before=JSON.stringify(f.db.students),h=edge('supabase/functions/super-admin-masterlist-import/index.ts',f);
  const staged=await h.request({action:'create_import',academic_term_id:1,rows:[row],file_name:'synthetic.csv'});assert.equal(staged.status,201);assert.equal(f.db.masterlist_imports[0].import_scope,'incremental');assert.equal(JSON.stringify(f.db.students),before,'staging changes no identities');
  const finalized=await h.request({action:'finalize_import',import_id:1});assert.equal(finalized.status,200);const body=await finalized.json();assert.equal(body.data.import_summary.processed,1);assert.equal(body.data.import_summary.created,alreadyEnrolled?0:1);assert.equal(body.data.import_summary.failed,0);assert.equal(JSON.stringify(f.db.students),before);assert.equal(f.db.audit_logs.length,1);assert.ok(f.calls.some(c=>c.name==='kandid_finalize_masterlist_import_with_membership_sync'&&c.args.p_actor_admin_id===1));
});
test('failed finalizer does not report success or create a completion audit',async()=>{
  const f=workflowFixture({failFinalization:true}),h=edge('supabase/functions/super-admin-masterlist-import/index.ts',f);await h.request({action:'create_import',academic_term_id:1,rows:[row]});const r=await h.request({action:'finalize_import',import_id:1});assert.equal(r.status,500);assert.equal(f.db.masterlist_imports[0].import_status,'review');assert.equal(f.db.audit_logs.length,0);
});
test('pending and unknown reconciliation states block UI and service readiness',()=>{
  for(const file of ['src/pages/superadmin/MasterlistReview.jsx','supabase/functions/super-admin-masterlist-import/index.ts'])assert.match(readFileSync(file,'utf8'),/!\["new", "continuing", "returnee", "shifted_program"\]\.includes\(row\.reconciliation_status\)/);
});
