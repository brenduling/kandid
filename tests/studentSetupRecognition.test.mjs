import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { harness } from "./studentAuthCaptchaFree.test.mjs";
import { readStudentSetupRecognition, readStudentSetupVerification } from "../src/utils/studentSetupRecognition.js";
import { isVerifiedStudentSetupEnabled } from "../src/utils/studentAccountSetupFeatureGate.js";

const artifact = "resolve-student-login-recognition-deploy";
const record = { id:42, student_number:"700001", status:"pending", auth_user_id:null,
  first_name:"Synthetic", last_name:"Student", email:"synthetic.student@example.invalid", program:"BSIT", year_level:1,
  private_notes:"Must never leave the server" };
const user = { id:"synthetic-auth", email:record.email, email_confirmed_at:"2026-10-17T00:00:00Z" };
const inspect={action:"inspect_setup",student_number:record.student_number};
const verify={action:"verify_access",student_number:record.student_number,verification_code:"012345"};
const make=options=>harness(artifact,{students:[record],...options});
const noWrites=h=>assert.ok(!h.events.some(e=>["createUser","passwordUpdate","sendOtp"].includes(e.kind)||e.data?.operation==="update"));
const noAcademicReads=h=>assert.ok(!h.events.some(e=>["academic_terms","student_term_enrollments","student_organization_terms","organizations"].includes(e.data?.table)));

test("historical v9 disclosure stays frozen but the hardened frontend rejects it",async()=>{
  const h=make(),before=structuredClone(h.db);const r=await h.invoke(inspect);
  assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"no-store");
  assert.deepEqual(r.body,{data:{recognition_version:2,student_number:record.student_number,student_details:{full_name:"Synthetic Student",program:"BSIT",year_level:1}}});
  assert.equal(readStudentSetupRecognition(r.body.data,record.student_number),null);
  assert.equal(JSON.stringify(r.body).includes(record.email),false);assert.equal(JSON.stringify(r.body).includes("private_notes"),false);
  assert.deepEqual(h.db,before);noWrites(h);noAcademicReads(h);assert.ok(!h.events.some(e=>e.kind==="verifyOtp"));
});

test("unknown, disabled, ambiguous, invalid-email and pending-linked records have one generic lookup rejection",async()=>{
  let baseline;
  for(const students of [[],[{...record,status:"disabled"}],[record,{...record,id:43}],[{...record,email:null}],[{...record,status:"pending",auth_user_id:user.id}]]){
    const h=make({students});const r=await h.invoke(inspect);assert.equal(r.status,404);
    if(baseline)assert.deepEqual(r.body,baseline);baseline=r.body;
    assert.equal(r.body.data,undefined);noWrites(h);noAcademicReads(h);
  }
});

test("a bearer session alone cannot broaden the recognition allowlist or verify another Student ID",async()=>{
  const h=make();assert.equal((await h.invoke(inspect,{Authorization:"Bearer another-student"})).status,200);
  const bad=make({invalidOtp:true});const r=await bad.invoke(verify,{Authorization:"Bearer another-student"});
  assert.equal(r.status,401);assert.deepEqual(r.body,{data:{authenticated:false}});noWrites(bad);
});

test("inspection rejects caller-selected email, identity or fields before any rate-limit/database operation",async()=>{
  for(const extra of [{email:record.email},{registered_email:record.email},{auth_user_id:user.id},{include_enrollment:true}]){
    const h=make();assert.equal((await h.invoke({...inspect,...extra})).status,401);assert.equal(h.events.length,0);
  }
});

test("lookup rate limits apply before identifying known or unknown records",async()=>{
  for(const students of [[record],[]]){
    const h=make({students,rateAllowed:false});const r=await h.invoke(inspect);assert.equal(r.status,429);
    assert.deepEqual(h.events.map(e=>e.kind),["rate"]);assert.equal(h.events[0].data.args.p_operation,"verify");
  }
});

test("privileged auth/email, foreign Student links and duplicate active/pending emails prevent disclosure and setup admission",async()=>{
  for(const options of [
    {admins:[{id:1,auth_user_id:user.id,email:"admin@example.invalid"}]},
    {admins:[{id:1,email:" "+record.email.toUpperCase()+" ",auth_user_id:"another-auth"}]},
    {students:[record,{...record,id:43,student_number:"700002",email:"other@example.invalid",auth_user_id:user.id}]},
    ...["active","pending"].map(status=>({students:[record,{...record,id:43,student_number:"700002",status,email:" "+record.email.toUpperCase()+" "}]})),
  ]){
    for(const payload of [inspect,verify]){
      const h=make(options);const r=await h.invoke(payload);assert.equal(r.status,payload===inspect?404:401);assert.equal(r.body.data?.setup_verification,undefined);assert.equal(r.body.data?.student_details,undefined);noWrites(h);
    }
  }
});

test("collision scans cannot silently miss later pages or accept truncated data",async()=>{
  const students=[record,...Array.from({length:1100},(_,i)=>({...record,id:i+100,student_number:String(i+800000),email:"other"+i+"@example.invalid"}))];
  students.push({...record,id:9999,student_number:"999999",email:record.email});
  for(const payload of [inspect,verify]){
    const h=make({students});assert.equal((await h.invoke(payload)).status,payload===inspect?404:401);noWrites(h);
    const partial=make({students,rowCap:100});assert.equal((await partial.invoke(payload)).status,503);
  }
});

test("read failures return unavailable instead of fabricated recognition fields",async()=>{
  for(const readErrorTable of ["students","admin_users"]){
    const h=make({readErrorTable});const r=await h.invoke(inspect);assert.equal(r.status,503);assert.equal(r.body.data,undefined);noWrites(h);
  }
});

test("central setup eligibility remains independent of term enrollment and organization participation",async()=>{
  for(const payload of [inspect,verify]){
    const h=make({tables:{academic_terms:[],student_term_enrollments:[],student_organization_terms:[],organizations:[]}});
    assert.equal((await h.invoke(payload)).status,200);noAcademicReads(h);noWrites(h);
  }
});

test("valid OTP returns an exact Student/Auth admission binding, not more recognition data",async()=>{
  const h=make(),before=structuredClone(h.db);const r=await h.invoke(verify);
  assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"no-store");
  assert.deepEqual(r.body.data.setup_verification,{contract_version:2,student_number:record.student_number,auth_user_id:user.id,account_state:"pending"});
  assert.deepEqual(Object.keys(r.body.data).sort(),["authenticated","session","setup_verification"]);
  assert.equal(readStudentSetupVerification(r.body.data.setup_verification,record.student_number,user),null);
  assert.equal(h.events.find(e=>e.kind==="verifyOtp").data.email,record.email);
  assert.deepEqual(h.db,before);noWrites(h);noAcademicReads(h);
});

test("incorrect/expired, unconfirmed, wrong-email and foreign-linked OTP identities cannot complete setup",async()=>{
  for(const options of [{invalidOtp:true},{otpUser:{...user,email:"foreign@example.invalid"}},{otpUser:{...user,email_confirmed_at:null}},
    {students:[{...record,status:"active",auth_user_id:"foreign-auth"}]},{students:[]},{students:[{...record,status:"disabled"}]}]){
    const h=make(options);const r=await h.invoke(verify);assert.equal(r.status,401);assert.deepEqual(r.body,{data:{authenticated:false}});noWrites(h);
  }
});

test("OTP admission rechecks identity/collisions rather than trusting the earlier lookup",async()=>{
  const h=make();assert.equal((await h.invoke(inspect)).status,200);
  h.db.admin_users.push({id:99,email:record.email});assert.equal((await h.invoke(verify)).status,401);noWrites(h);
  const changed=make({beforeRead(table,db,events){if(table==="students" && events.filter(e=>e.data?.table==="students").length===2)db.students[0].email="changed@example.invalid";}});
  assert.equal((await changed.invoke(verify)).status,401);
});

test("already-active linked accounts return the login path and never reset passwords or create duplicates",async()=>{
  const h=make({students:[{...record,status:"active",auth_user_id:user.id}]});const r=await h.invoke(verify);
  assert.equal(r.status,200);assert.equal(r.body.data.setup_verification.account_state,"active");noWrites(h);
});

test("OTP targeting ignores substituted email and never receives or commits the configured password",async()=>{
  const h=make();const r=await h.invoke({action:"begin_access",student_number:record.student_number,email:"attacker@example.invalid",password:"Ignored!123"});
  assert.equal(r.status,202);assert.deepEqual(h.events.find(e=>e.kind==="sendOtp").data,{email:record.email,options:{shouldCreateUser:false}});
  assert.equal(h.events.some(e=>e.kind==="passwordUpdate"),false);
  const rejected=make();assert.equal((await rejected.invoke({...verify,registered_email:"attacker@example.invalid"})).status,401);noWrites(rejected);
});

test("login and begin_access retain v8 behavior including provisioning, rejections and rate limits",async()=>{
  for(const payload of [{action:"login",student_number:record.student_number,password:"Synthetic!123"},{action:"begin_access",student_number:record.student_number}]){
    for(const options of [{},{students:[]},{rateAllowed:false},{badPassword:true},{students:[{...record,status:"active",auth_user_id:user.id}]},{authUsers:[]}]){
      const a=make(options),b=harness("resolve-student-login-inspect-deploy",{students:[record],...options});
      const ar=await a.invoke(payload),br=await b.invoke(payload);assert.equal(ar.status,br.status);assert.deepEqual(ar.body,br.body);
      assert.deepEqual(a.events.map(e=>e.kind==="delay"?{kind:e.kind}:e),b.events.map(e=>e.kind==="delay"?{kind:e.kind}:e));
    }
  }
});

test("client accepts only the new three-field lookup contract and no overbroad or mismatched response",async()=>{
  const d=(await make().invoke(inspect)).body.data;
  for(const payload of [undefined,{...d,recognition_version:1},{...d,student_number:"700002"},
    {...d,student_details:{...d.student_details,email:record.email}},{...d,student_details:{...d.student_details,enrollment:{}}},
    {...d,student_details:{...d.student_details,year_level:99}}])assert.equal(readStudentSetupRecognition(payload,record.student_number),null);
});

test("OTP proof must match the exact requested ID, confirmed Auth user and supported contract",()=>{
  const p={contract_version:2,student_number:record.student_number,auth_user_id:user.id,account_state:"pending"};
  for(const [proof,identity] of [[undefined,user],[{...p,student_number:"700002"},user],[{...p,auth_user_id:"foreign"},user],
    [p,{...user,email_confirmed_at:null}],[{...p,contract_version:1},user],[{...p,account_state:"disabled"},user]])assert.equal(readStudentSetupVerification(proof,record.student_number,identity),null);
});

test("release gate stays default-off and only the three approved fields are rendered",()=>{
  for(const e of [{},{VITE_ENABLE_STUDENT_ACCOUNT_SETUP:"true"},{VITE_ENABLE_STUDENT_ACCOUNT_SETUP:"true",VITE_ENABLE_VERIFIED_STUDENT_SETUP:"false"}])assert.equal(isVerifiedStudentSetupEnabled(e),false);
  assert.equal(isVerifiedStudentSetupEnabled({VITE_ENABLE_STUDENT_ACCOUNT_SETUP:"true",VITE_ENABLE_VERIFIED_STUDENT_SETUP:"true"}),true);
  const page=readFileSync("src/pages/auth/StudentSetup.jsx","utf8");const panel=page.slice(page.indexOf("function renderIdentityPanel"),page.indexOf("function continueToPassword"));
  assert.match(panel,/Student full name/);assert.match(panel,/Program/);assert.match(panel,/Year level/);
  assert.doesNotMatch(panel,/email|enrollment|organization|student_number|<input|<select/);
  assert.match(page,/onAuthStateChange/);assert.match(page,/subscription.unsubscribe/);
});
