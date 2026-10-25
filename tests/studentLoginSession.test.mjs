import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {runInNewContext} from "node:vm";
import {isAllowedDevelopmentProductionRequest} from "../src/utils/developmentProductionWriteGuard.js";
import {readStudentSetupRecognition} from "../src/utils/studentSetupRecognition.js";
const source=(await readFile(new URL("../src/utils/auth.js",import.meta.url),"utf8")).replace(/^import .*;\r?\n/gm,"").replace(/import\.meta\.env/g,"testEnvironment").replace(/^export /gm,"");
function harness(options={}) {
 const events=[], storage=options.storage || new Map();
 let user=options.user || {id:"synthetic-student-auth",email_confirmed_at:"2026-10-17",email:"synthetic@example.invalid"};
 let signedIn=options.signedIn !== false, listener, recoveryPending=options.recoverDuringGetUser;
 const profile={id:42,student_number:"700001",status:"active",role:"student"};
 const supabase={
 auth:{
  onAuthStateChange(fn){listener=fn;},
  async getUser(){if(recoveryPending){recoveryPending=false;listener?.('SIGNED_IN');}return {data:{user:signedIn?user:null},error:signedIn?null:new Error("No synthetic session")};},
  async setSession(){events.push("setSession");signedIn=true;listener?.("SIGNED_IN");return {data:{session:{access_token:"synthetic",refresh_token:"synthetic"}},error:null};},
  async signOut(args){events.push(["logout",args.scope]);signedIn=false;listener?.("SIGNED_OUT");return {error:null};}
 },
 functions:{async invoke(name,{body}){
  events.push([name,body.action]);
  if(name==="resolve-student-login") {
   if(options.badCredentials) return {data:null,error:{context:{status:401}}};
   if(body.action==="inspect_setup") return {data:{data:{recognition_version:4,student_number:body.student_number,verification_required:true,masked_first_name:"Sy"+"•".repeat(7),masked_last_name:"S"+"•".repeat(6),program:"BSIT",year_level:1}},error:null};
   return {data:{data:{authenticated:true,session:{access_token:"synthetic",refresh_token:"synthetic"}}},error:null};
  }
  assert.equal(name,"student-profile");
  if(options.profileWait) await options.profileWait;
  if(options.profileError) return {data:null,error:options.profileError};
  return {data:{data:{...profile,id:user.id==="other-auth"?43:42}},error:null};
 }}
 };
 const local={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const context={supabase,readStudentSetupRecognition,testEnvironment:{},clearSessionCache(){},localStorage:local,sessionStorage:local,window:{dispatchEvent(){}},CustomEvent:class{}};
 runInNewContext(source+"\nglobalThis.api={authenticateStudentByNumber,requireStudentSession,signOutStudentSession,inspectStudentSetup};",context);
 return {api:context.api,events,storage,supabase,switchUser(){user={...user,id:"other-auth"};},profile};
}
test("successful authentication establishes session and verified profile without logout",async()=>{
 const h=harness({signedIn:false});
 assert.equal((await h.api.authenticateStudentByNumber({studentNumber:"700001",password:"Synthetic!123"})).error,null);
 const result=await h.api.requireStudentSession({force:true});
 assert.equal(result.data.student_number,"700001");
 assert.equal(JSON.parse(h.storage.get("user")).role,"student");
 assert.ok(!h.events.some(e=>Array.isArray(e)&&e[0]==="logout"));
});
test("missing profile endpoint preserves the valid session and reports a profile failure",async()=>{
 const h=harness({profileError:{context:{status:404}}});
 const result=await h.api.requireStudentSession();
 assert.equal(result.error.code,"STUDENT_PROFILE_UNAVAILABLE");
 assert.ok(!h.events.some(e=>Array.isArray(e)&&e[0]==="logout"));
 assert.ok((await h.supabase.auth.getUser()).data.user);
});
test("refresh verifies identity; local stored profile never authorizes an expired session",async()=>{
 const storage=new Map([["user",JSON.stringify({id:999,role:"student"})]]);
 const h=harness({storage});
 assert.equal((await h.api.requireStudentSession()).data.id,42);
 const refreshed=harness({storage});
 assert.equal((await refreshed.api.requireStudentSession()).data.id,42);
 assert.equal((await harness({storage,signedIn:false}).api.requireStudentSession()).data,null);
});

test("persisted Auth recovery during getUser revalidates once and retains the authorized deep link session",async()=>{
 const h=harness({recoverDuringGetUser:true});
 const result=await h.api.requireStudentSession();
 assert.equal(result.error,null);assert.equal(result.data.id,42);
 assert.equal(JSON.parse(h.storage.get('user')).id,42);
 assert.ok(!h.events.some(e=>Array.isArray(e)&&e[0]==='logout'));
});
test("cached profile is scoped to the current Auth identity",async()=>{
 const h=harness();
 assert.equal((await h.api.requireStudentSession()).data.id,42);
 h.switchUser();
 assert.equal((await h.api.requireStudentSession()).data.id,43);
});
test("logout clears local session and a delayed profile cannot restore it",async()=>{
 let release;const wait=new Promise(r=>release=r);
 const h=harness({profileWait:wait});
 const request=h.api.requireStudentSession();
 await new Promise(r=>setTimeout(r,0));
 assert.equal((await h.api.signOutStudentSession()).error,null);
 release();
 assert.equal((await request).data,null);
 assert.equal(h.storage.get("user"),undefined);
 assert.equal((await h.api.requireStudentSession()).data,null);
 assert.ok(h.events.some(e=>Array.isArray(e)&&e[0]==="logout"&&e[1]==="local"));
});
test("simultaneous route/profile checks share a current-identity request",async()=>{
 let release;const wait=new Promise(r=>release=r);
 const h=harness({profileWait:wait});
 const one=h.api.requireStudentSession(),two=h.api.requireStudentSession({force:true});
 await new Promise(r=>setTimeout(r,0));release();
 assert.equal((await one).data.id,42);assert.equal((await two).data.id,42);
 assert.equal(h.events.filter(e=>Array.isArray(e)&&e[0]==="student-profile").length,1);
});
test("incorrect credentials never establish a session or load a profile",async()=>{
 const h=harness({badCredentials:true,signedIn:false});
 assert.ok((await h.api.authenticateStudentByNumber({studentNumber:"700001",password:"Synthetic-wrong"})).error);
 assert.ok(!h.events.includes("setSession"));
 assert.ok(!h.events.some(e=>Array.isArray(e)&&e[0]==="student-profile"));
});
test("development guard allows exact authenticated profile read but denies writes and forged scope",()=>{
 const base={input:"https://fszgdxqxonqqcrzsnkca.supabase.co/functions/v1/student-profile",method:"POST"};
 assert.equal(isAllowedDevelopmentProductionRequest({...base,body:JSON.stringify({action:"profile"})}),true);
 for(const body of [{action:"update_photo"},{action:"profile",student_id:99},{action:"profile",organization_id:99},{}])assert.equal(isAllowedDevelopmentProductionRequest({...base,body:JSON.stringify(body)}),false);
});
test("pre-OTP setup helper exposes only server-masked recognition fields",async()=>{
 const h=harness();
 const r=await h.api.inspectStudentSetup({studentNumber:"700001"});
 assert.deepEqual(JSON.parse(JSON.stringify(r.data)),{student_number:"700001",verification_required:true,masked_first_name:"Sy"+"•".repeat(7),masked_last_name:"S"+"•".repeat(6),program:"BSIT",year_level:1});
 assert.equal(JSON.stringify(r.data).includes("ynthetic"),false);
});
