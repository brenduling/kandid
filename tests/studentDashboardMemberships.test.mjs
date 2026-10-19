import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {stripTypeScriptTypes} from "node:module";
import {runInNewContext} from "node:vm";
import {handleCorsPreflight,rejectDisallowedOrigin,withKandidCors} from "../supabase/functions/_shared/kandidProductionSecurity.mjs";
import {isAllowedDevelopmentProductionRequest} from "../src/utils/developmentProductionWriteGuard.js";
const source=stripTypeScriptTypes(readFileSync(new URL("../supabase/functions/student-profile-readonly-deploy/index.ts",import.meta.url),"utf8")).replace(/^import .*;\r?\n/gm,"");
const student={id:42,auth_user_id:"synthetic-auth",student_number:"700001",email:"synthetic@example.invalid",status:"active"};
const term={id:1,academic_year:"2026-2027",semester:"1st Semester",status:"active"};
const organizations=[
 {id:1,name:"WITSG",description:"Synthetic institution",organization_type:"departmental",membership_scope:"institution"},
 {id:2,name:"PSITS",description:"Synthetic program",organization_type:"departmental",membership_scope:"program"},
 {id:3,name:"Foreign Manual",organization_type:"non_departmental",membership_scope:"manual"},
 {id:4,name:"Historical Organization",organization_type:"departmental",membership_scope:"program"}
];
const memberRows=organizations.slice(0,2).map(organization=>({organization_id:organization.id,academic_term_id:1,membership_status:"active",source:"activation",organization}));
const envelope={student_id:42,academic_term:term,enrollment:{academic_term_id:1,enrollment_status:"enrolled",program:"BSIT",year_level:4},memberships:memberRows,count:2};
function backend(options={}){
 const events=[];let handler,termReads=0;
 const db={
  students:structuredClone(options.students||[student,{...student,id:99,auth_user_id:"foreign-auth",email:"foreign@example.invalid"}]),
  academic_terms:structuredClone(options.terms||[term,{...term,id:2,status:"closed"}]),
  student_term_enrollments:structuredClone(options.enrollments||[{student_id:42,academic_term_id:1,enrollment_status:"enrolled",program:"BSIT",year_level:4},{student_id:42,academic_term_id:2,enrollment_status:"enrolled",program:"BSHM",year_level:2}]),
  student_organization_terms:structuredClone(options.participation||[
   {student_id:42,organization_id:1,academic_term_id:1,status:"active",source:"activation"},
   {student_id:42,organization_id:2,academic_term_id:1,status:"active",source:"activation"},
   {student_id:42,organization_id:3,academic_term_id:1,status:"removed"},
   {student_id:42,organization_id:4,academic_term_id:2,status:"active"},
   {student_id:99,organization_id:3,academic_term_id:1,status:"active"}]),
  organizations:structuredClone(organizations)
 };
 const before=JSON.stringify(db);
 function query(table){
  const filters=[];let limit=Infinity,columns,start=0;
  async function execute(){
   events.push({kind:"read",table,filters:structuredClone(filters)});
   if(options.failTable===table)return {data:null,error:{message:"Synthetic unavailable"}};
  let rows=db[table];
   if(table==="academic_terms"&&options.termChanged&&++termReads>1)rows=[{...term,id:3}];
   rows=rows.filter(row=>filters.every(([key,value])=>Array.isArray(value)?value.includes(row[key]):row[key]===value)).slice(start,start+limit);
   return {data:rows.map(row=>Object.fromEntries(columns.split(",").map(key=>key.trim()).map(key=>[key,row[key]]))),error:null};
  }
  const q={select(value){columns=value;return q;},eq(key,value){filters.push([key,value]);return q;},in(key,values){filters.push([key,values]);return q;},limit(value){limit=value;return q;},range(offset,end){start=offset;limit=end-offset+1;return q;},order(){return q;},then(a,b){return execute().then(a,b);}};
  return q;
 }
 const admin={from:query,async rpc(name,args){
  events.push({kind:"rpc",name,args:structuredClone(args)});
  assert.equal(name,"resolve_student_organization_participation");
  assert.equal(args.target_academic_term_id,1);
  if(options.rpcThrows)throw Error("Synthetic RPC failure");
  const enrolled=db.student_term_enrollments.some(e=>e.student_id===args.target_student_id&&e.academic_term_id===1&&e.enrollment_status==='enrolled');
  const active=db.student_organization_terms.some(row=>row.student_id===args.target_student_id&&row.organization_id===args.target_organization_id&&row.academic_term_id===1&&row.status==='active');
  return {data:[{allowed:enrolled&&active&&options.denyOrganization!==args.target_organization_id,status:"active",source:"activation"}],error:options.rpcError?{message:"Synthetic RPC failure"}:null};
 }};
 const auth={auth:{async getUser(){return {data:{user:{id:options.foreign?"foreign-auth":"synthetic-auth",email:student.email,email_confirmed_at:"2026-10-17"}},error:options.expired?{}:null};}}};
 runInNewContext(source,{
  Request,Response,Headers,Object,Number,Set,Array,String,Promise,
  createClient(_url,key){return key==="synthetic-service"?admin:auth;},
  handleCorsPreflight,rejectDisallowedOrigin,
  serveWithKandidCors(fn){handler=request=>fn(request).then(response=>withKandidCors(request,response));},
  Deno:{env:{get(name){return {SUPABASE_URL:"https://synthetic.invalid",SUPABASE_ANON_KEY:"synthetic-anon",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service"}[name];}}}
 });
 return {events,unchanged:()=>JSON.stringify(db)===before,async invoke(body={action:"organization_memberships"},authenticated=true){
  const response=await handler(new Request("https://synthetic.invalid",{method:"POST",headers:{Origin:"http://localhost:5174","Content-Type":"application/json",...(authenticated?{Authorization:"Bearer synthetic-session"}:{})},body:JSON.stringify(body)}));
  return {status:response.status,body:await response.json()};
 }};
}
test("canonical self read returns WITSG/PSITS only, with verified term enrollment and no writes",async()=>{
 const h=backend(),result=await h.invoke();
 assert.equal(result.status,200);assert.equal(result.body.data.count,2);
 assert.deepEqual(result.body.data.memberships.map(m=>m.organization.name),["WITSG","PSITS"]);
 assert.ok(!JSON.stringify(result.body).includes("foreign@example.invalid"));
 assert.ok(h.unchanged());
 for(const table of ["student_organization_terms","student_term_enrollments"]){
  const read=h.events.find(e=>e.table===table);
  assert.ok(read.filters.some(([key,value])=>key==="student_id"&&value===42));
  assert.ok(read.filters.some(([key,value])=>key==="academic_term_id"&&value===1));
 }
});
test("missing or non-enrolled current enrollment is a verified zero, not legacy membership fallback",async()=>{
 for(const enrollments of [[],[{student_id:42,academic_term_id:1,enrollment_status:"not_enrolled"}]]){
  const h=backend({enrollments}),result=await h.invoke();
  assert.equal(result.status,200);assert.equal(result.body.data.count,0);assert.equal(result.body.data.enrollment,null);
  assert.ok(!h.events.some(e=>e.table==="student_organization_terms"));assert.ok(h.unchanged());
 }
});
test("historical/removed/foreign participation never appears; canonical denial is respected",async()=>{
 const result=await backend({denyOrganization:2}).invoke();
 assert.equal(result.status,200);assert.equal(result.body.data.count,1);
 assert.equal(result.body.data.memberships[0].organization.name,"WITSG");
});
test("term ambiguity, missing term, duplicate enrollment and duplicate participation fail closed",async()=>{
 for(const options of [
  {terms:[]},{terms:[term,{...term,id:3}]},
  {enrollments:[{student_id:42,academic_term_id:1,enrollment_status:"enrolled"},{student_id:42,academic_term_id:1,enrollment_status:"enrolled"}]},
  {participation:[{student_id:42,organization_id:1,academic_term_id:1,status:"active"},{student_id:42,organization_id:1,academic_term_id:1,status:"active"}]},
  {termChanged:true}
 ]){
  const h=backend(options);assert.equal((await h.invoke()).status,409);assert.ok(h.unchanged());
 }
});
test("table and RPC failures never become a success with zero members",async()=>{
 for(const options of [{failTable:"academic_terms"},{failTable:"student_term_enrollments"},{failTable:"student_organization_terms"},{failTable:"organizations"},{rpcError:true},{rpcThrows:true}]){
  const h=backend(options),result=await h.invoke();assert.equal(result.status,503);assert.equal(result.body.data,undefined);assert.ok(h.unchanged());
 }
});
test("missing/invalid/foreign/inactive/duplicate profiles and forged IDs are denied",async()=>{
 assert.equal((await backend().invoke(undefined,false)).status,401);
 for(const options of [{expired:true},{foreign:true},{students:[{...student,status:"pending"}]},{students:[student,{...student,id:43}]}]){
  const h=backend(options);assert.ok([401,403].includes((await h.invoke()).status));assert.ok(!h.events.some(e=>e.table==="student_organization_terms"));
 }
 for(const body of [{action:"organization_memberships",student_id:99},{action:"organization_memberships",academic_term_id:2},{action:"organization_memberships",organization_id:3}]){
  const h=backend();assert.equal((await h.invoke(body)).status,400);assert.equal(h.events.length,0);
 }
});
test("existing profile action remains backward-compatible and never reads memberships",async()=>{
 const h=backend(),result=await h.invoke({action:"profile"});
 assert.equal(result.status,200);assert.equal(result.body.data.student_number,student.student_number);
 assert.ok(!h.events.some(e=>e.table==="student_organization_terms"||e.table==="academic_terms"));
});
const access=readFileSync(new URL("../src/utils/organizationAccess.js",import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"");
function client(options={}){
 const calls=[];
 const supabase={functions:{async invoke(name,{body}){calls.push({name,body});return {data:{data:options.data||envelope},error:options.error||null};}},from(){throw Error("Protected table reads are forbidden");}};
 const context={supabase,getCachedValue(){return organizations.slice(0,2);},setCachedValue(_key,value){return value;},clearCachedValue(){},console:{warn(){},error(){}}};
 runInNewContext(access+"\nglobalThis.api={getStudentDashboardMemberships,getStudentOrganizationDirectory,getCurrentOrganizationMemberCount,getStudentElectionOrganizationIds};",context);
 return {api:context.api,calls};
}

test("election membership scope uses the installed self-scoped endpoint and propagates unavailable data", async()=>{
 const h=client();
 assert.deepEqual([...await h.api.getStudentElectionOrganizationIds({id:42})],[1,2]);
 assert.equal(JSON.stringify(h.calls),JSON.stringify([{name:"student-profile",body:{action:"organization_memberships"}}]));
 const failed=client({error:{context:{status:403}}});
 await assert.rejects(()=>failed.api.getStudentElectionOrganizationIds({id:42}),error=>error.status===403);
 await assert.rejects(()=>h.api.getStudentElectionOrganizationIds({id:99}),/could not be loaded/);
});

test("kiosk membership lookup uses the verified student's isolated client, never the operator session",async()=>{
 const operator=client({error:new Error("operator must not be queried")});
 let invoked=0;
 const isolated={functions:{invoke:async(name,{body})=>{
  invoked++;assert.equal(name,"student-profile");assert.equal(JSON.stringify(body),JSON.stringify({action:"organization_memberships"}));
  return {data:{data:envelope},error:null};
 }}};
 assert.deepEqual([...await operator.api.getStudentElectionOrganizationIds({id:42},isolated)],[1,2]);
 assert.equal(invoked,1);assert.equal(operator.calls.length,0);
});
test("dashboard derives two cards from the authorized response with an action-only payload",async()=>{
 const h=client();const result=await h.api.getStudentOrganizationDirectory({id:42});
 assert.equal(result.memberOrganizations.length,2);
 assert.deepEqual([...result.memberIds],[1,2]);
 assert.equal(result.otherOrganizations.length,0);
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].name,"student-profile");
 assert.equal(JSON.stringify(h.calls[0].body),JSON.stringify({action:"organization_memberships"}));
});
test("failed or malformed membership responses throw instead of returning empty arrays",async()=>{
 const invalid=[
  {error:{context:{status:404}}},{error:{context:{status:503}}},
  {data:{...envelope,count:0}},{data:{...envelope,student_id:99}},
  {data:{...envelope,academic_term:{...term,status:"closed"}}},
  {data:{...envelope,memberships:[memberRows[0],memberRows[0]]}},
  {data:{...envelope,enrollment:null}},
  {data:{...envelope,memberships:[{...memberRows[0],academic_term_id:2}],count:1}}
 ];
 for(const options of invalid)await assert.rejects(()=>client(options).api.getStudentDashboardMemberships({id:42}));
});
test("an authoritative successful zero is distinct from request failure",async()=>{
 const h=client({data:{...envelope,enrollment:null,memberships:[],count:0}});
 assert.equal((await h.api.getStudentOrganizationDirectory({id:42})).memberOrganizations.length,0);
});
test("development guard permits only the two read actions without extra identity/scope fields",()=>{
 const base={input:"https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/student-profile",method:"POST"};
 assert.equal(isAllowedDevelopmentProductionRequest({...base,body:JSON.stringify({action:"organization_memberships"})}),true);
 for(const body of [{action:"organization_memberships",student_id:99},{action:"organization_memberships",academic_term_id:2},{action:"update_photo"},{action:"sync_memberships"}])assert.equal(isAllowedDevelopmentProductionRequest({...base,body:JSON.stringify(body)}),false);
});

test("Student count is exactly distinct active-term membership IDs, independent of enrollment and election data",async()=>{
 const enrollments=[42,99].map(student_id=>({student_id,academic_term_id:1,enrollment_status:'enrolled'}));
 const participation=[42,99,99,100].map((student_id,id)=>({id,student_id,organization_id:1,academic_term_id:1,status:'active'}));
 // Duplicated participation of another member cannot inflate the aggregate.
 participation.push({id:9,student_id:101,organization_id:1,academic_term_id:2,status:'active'},{id:10,student_id:102,organization_id:1,academic_term_id:1,status:'removed'});
 const h=backend({enrollments,participation});const result=await h.invoke({action:'organization_member_count',organization_id:1});
 assert.equal(result.status,200);assert.equal(result.body.data.count,3);assert.equal(result.body.data.academic_term.id,1);
 assert.equal(result.body.data.organization_id,1);assert.equal(result.body.data.member_student_ids,undefined);
 assert.equal(result.body.data.student_id,undefined);assert.ok(h.unchanged());
 const rpcCalls=h.events.filter(e=>e.kind==='rpc');
 assert.equal(rpcCalls.length,1,'Only the requesting Student requires canonical access authorization');
 assert.equal(rpcCalls[0].args.target_student_id,42);
 assert.ok(!h.events.some(e=>['elections','votes','candidates','student_term_enrollments'].includes(e.table)));
});

test("Student count denies foreign organizations, forged identities, invalid requests and missing sessions",async()=>{
 for(const id of [3,4])assert.equal((await backend().invoke({action:'organization_member_count',organization_id:id})).status,403);
 for(const body of [{action:'organization_member_count',organization_id:1,student_id:99},{action:'organization_member_count',organization_id:1,include_member_ids:true},{action:'organization_member_count',organization_id:0},{action:'organization_member_count',organization_id:'1'}])assert.equal((await backend().invoke(body)).status,400);
 assert.equal((await backend().invoke({action:'organization_member_count',organization_id:1},false)).status,401);
 for(const options of [{rpcError:true},{failTable:'student_organization_terms'},{termChanged:true}])assert.ok([409,503].includes((await backend(options).invoke({action:'organization_member_count',organization_id:1})).status));
});

test("Student count pages beyond the Data API default cap without counting historical or duplicate rows",async()=>{
 const participation=Array.from({length:1001},(_,id)=>({id,student_id:id===0?42:99,organization_id:1,academic_term_id:1,status:'active'}));
 const enrollments=[42,99].map(student_id=>({student_id,academic_term_id:1,enrollment_status:'enrolled'}));
 const h=backend({participation,enrollments});const result=await h.invoke({action:'organization_member_count',organization_id:1});
 assert.equal(result.status,200);assert.equal(result.body.data.count,2);
 assert.equal(h.events.filter(e=>e.table==='student_organization_terms'&&e.filters.some(([key])=>key==='organization_id')).length,3);
});

test("Student count client keeps verified zero distinct from errors and sends no identity override",async()=>{
 const data={organization_id:1,academic_term:term,count:0};const h=client({data});
 assert.equal((await h.api.getCurrentOrganizationMemberCount(1,{studentView:true})).data.count,0);
 assert.equal(JSON.stringify(h.calls[0]),JSON.stringify({name:'student-profile',body:{action:'organization_member_count',organization_id:1}}));
 for(const bad of [{...data,count:-1},{...data,organization_id:2},{...data,academic_term:{...term,status:'closed'}}])assert.ok((await client({data:bad}).api.getCurrentOrganizationMemberCount(1,{studentView:true})).error);
 assert.ok((await client({error:{message:'unavailable'}}).api.getCurrentOrganizationMemberCount(1,{studentView:true})).error);
});

test("guard allows bounded notification lists and aggregate reads only",()=>{
 const invoke=(slug,body)=>isAllowedDevelopmentProductionRequest({input:`https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/${slug}`,method:'POST',body:JSON.stringify(body)});
 assert.equal(invoke('student-profile',{action:'organization_member_count',organization_id:1}),true);
 assert.equal(invoke('student-profile',{action:'organization_member_count',organization_id:1,student_id:99}),false);
 assert.equal(invoke('student-notifications',{action:'list',limit:20,offset:20}),true);
 for(const body of [{action:'list',student_id:99},{action:'list',limit:51},{action:'list',offset:-1},{action:'mark_read',notification_id:1},{action:'create'}])assert.equal(invoke('student-notifications',body),false);
});
