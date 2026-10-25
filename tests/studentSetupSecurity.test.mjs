import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {readStudentSetupRecognition,readStudentSetupVerification} from '../src/utils/studentSetupRecognition.js';
import {KANDID_WEB_ORIGINS,corsHeaders,handleCorsPreflight,rejectDisallowedOrigin,withKandidCors} from '../supabase/functions/_shared/kandidProductionSecurity.mjs';

const compile=path=>stripTypeScriptTypes(readFileSync(path,'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const helper={crypto:webcrypto,TextEncoder};
runInNewContext(compile('supabase/functions/_shared/studentSetupAdmission.ts')+'\nglobalThis.helpers={setupAdmission,setupRpc,setupTokenHash,newSetupToken,setupDetails,maskedSetupRecognition};',helper);
const sources=Object.fromEntries(['resolve-student-login','link-student-identity'].map(name=>[name,compile(`supabase/functions/${name}-secure-deploy/index.ts`)]));
const user={id:'00000000-0000-4000-8000-000000000042',email:'synthetic@example.invalid',email_confirmed_at:'2026-10-22T00:00:00Z'};
const student={id:42,student_number:'700001',email:user.email,status:'pending',auth_user_id:null,full_name:'Synthetic Student',first_name:'Synthetic',last_name:'Student',program:'BSIT',year_level:1};
const setup={student_number:student.student_number,setup_mode:true,password:'Synthetic!123',setup_token:'a'.repeat(64)};
const clone=x=>JSON.parse(JSON.stringify(x));
function harness(name='resolve-student-login',options={}){
 let handler,claimed=false;const events=[];
 const fixtureStudent={...student,...(options.loginActive?{status:'active',auth_user_id:user.id}:{})};
 const auth={auth:{getUser:async()=>({data:{user:options.user||user},error:options.invalidSession?{}:null}),
   signInWithPassword:async()=>({data:options.badPassword?{}:{session:{access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600},user:{...user,id:options.foreignLogin?'foreign-auth':user.id}},error:null}),
   verifyOtp:async()=>{events.push('otp');return options.invalidOtp?{data:{},error:{}}:{data:{user,session:{access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600}}};},
   signInWithOtp:async()=>{events.push('dispatch');return {error:options.dispatchFailure?{}:null};},
   admin:{listUsers:async()=>({data:{users:[user]},error:null}),getUserById:async()=>({data:{user},error:null})}}};
 const service={auth:auth.auth,from(table){events.push('read:'+table);const q={select(){return q},eq(){return q},limit(){return q},then(a,b){return Promise.resolve({data:table==='students'?[fixtureStudent]:[],error:null}).then(a,b)}};return q;},
  async rpc(name,args){events.push(name);
   if(name==='kandid_consume_student_auth_rate_limit')return {data:options.rateAllowed!==false,error:null};
   if(options.rpcError)return {data:null,error:{}};
   if(name==='kandid_student_setup_admission_v1')return {data:options.ineligible?null:(options.admissionStudent||student),error:null};
   if(name==='kandid_student_setup_issue_v1')return {data:options.ineligible?null:{account_state:options.active?'active':'pending',student,expires_at:Math.floor(Date.now()/1000)+300},error:null};
   assert.equal(args.p_auth_user_id,user.id);assert.equal(args.p_expected_email,user.email);assert.match(args.p_proof_hash,/^[a-f0-9]{64}$/);
   if(name==='kandid_student_setup_claim_v1'){
    const permitted=!claimed&&!options.ineligible;claimed=true;
    if(options.claimWait)await options.claimWait;
    return {data:permitted?(options.badClaim||student):null,error:null};
   }
   assert.equal(name,'kandid_student_setup_finish_v1');return {data:options.stale?null:{id:42,student_number:'700001',status:'active'},error:null};
  }};
 const env={SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET:'x'.repeat(48),STUDENT_SETUP_SECURITY_ENABLED:options.disabled?'false':'true'};
 const ctx={...helper.helpers,Request,Response,Headers,URL,TextEncoder,TextDecoder,AbortSignal,crypto:webcrypto,
  console:{warn(){},error(){}},setTimeout(fn){fn()},KANDID_WEB_ORIGINS,corsHeaders,handleCorsPreflight,rejectDisallowedOrigin,
  serveWithKandidCors(fn){handler=async req=>withKandidCors(req,await fn(req));},
  Deno:{env:{get:k=>env[k]},serve(fn){handler=fn}},
  createClient(_url,key){return key==='synthetic-service'?service:auth},
  async fetch(){events.push('password');if(options.fetchThrows)throw Error('Synthetic timeout');return new Response(JSON.stringify(user),{status:options.passwordFailure?400:200});}};
 runInNewContext(name==='legacy-login'?compile('supabase/functions/resolve-student-login-recognition-deploy/index.ts'):sources[name],ctx);
 return {events,async invoke(body,authorized=true){const r=await handler(new Request('https://synthetic.invalid/function',{method:'POST',headers:{Origin:'http://localhost:5174','Content-Type':'application/json','cf-connecting-ip':'198.51.100.4',...(authorized?{Authorization:'Bearer synthetic-session'}:{})},body:JSON.stringify(body)}));return {status:r.status,body:await r.json(),headers:r.headers};}};
}
test('pre-OTP recognition returns only server-masked fields for an admitted pending record',async()=>{
 const h=harness();const r=await h.invoke({action:'inspect_setup',student_number:'700001'},false);
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.deepEqual(clone(r.body),{data:{recognition_version:4,student_number:'700001',verification_required:true,
  masked_first_name:'Sy'+'•'.repeat(7),masked_last_name:'S'+'•'.repeat(6),program:'BSIT',year_level:1}});
 assert.deepEqual(h.events,['kandid_consume_student_auth_rate_limit','kandid_student_setup_admission_v1']);
 const serialized=JSON.stringify(r.body);
 for(const secret of [user.email,'ynthetic','Student','full_name','auth_user_id'])assert.equal(serialized.includes(secret),false,secret);
 assert.ok(readStudentSetupRecognition(r.body.data,'700001'));
});
test('pre-OTP recognition gives one generic rejection for ineligible and already-active records',async()=>{
 let baseline;
 for(const options of [{ineligible:true},{admissionStudent:{...student,status:'active',auth_user_id:user.id}}]){
  const h=harness(undefined,options);const r=await h.invoke({action:'inspect_setup',student_number:'700001'},false);
  assert.equal(r.status,404);assert.equal(r.headers.get('cache-control'),'no-store');
  if(baseline)assert.deepEqual(clone(r.body),baseline);baseline=clone(r.body);
  assert.equal(r.body.data,undefined);assert.equal(readStudentSetupRecognition(r.body.data,'700001'),null);
  assert.ok(!JSON.stringify(r.body).includes('Synthetic'));
 }
});
test('server masking never returns a complete name part and handles edge names',()=>{
 const m=record=>clone(helper.helpers.maskedSetupRecognition(record));
 assert.deepEqual(m({first_name:'Brendo',last_name:'Manlapaz',program:'BSIT',year_level:4}),
  {masked_first_name:'Br'+'•'.repeat(4),masked_last_name:'M'+'•'.repeat(7),program:'BSIT',year_level:4});
 assert.deepEqual(m({first_name:'Maria Clara',last_name:'Dela Cruz',program:'BSED',year_level:2}),
  {masked_first_name:'Ma'+'•'.repeat(9),masked_last_name:'D'+'•'.repeat(8),program:'BSED',year_level:2});
 assert.deepEqual(m({first_name:'Jo',last_name:'Uy',program:'BSBA',year_level:1}),
  {masked_first_name:'J'+'•'.repeat(3),masked_last_name:'U'+'•'.repeat(3),program:'BSBA',year_level:1});
 assert.deepEqual(m({first_name:'A',last_name:null,program:null,year_level:null}),
  {masked_first_name:'•'.repeat(4),masked_last_name:null,program:null,year_level:null});
 assert.deepEqual(m({first_name:null,last_name:null,full_name:'José Peña',program:'BSCS',year_level:3}),
  {masked_first_name:'Jo'+'•'.repeat(3),masked_last_name:'P'+'•'.repeat(3),program:'BSCS',year_level:3});
});
test('uniform setup dispatch uses authoritative admission and never writes password',async()=>{
 for(const ineligible of [false,true]){
  const h=harness(undefined,{ineligible});const r=await h.invoke({action:'begin_access',student_number:'700001'});
  assert.equal(r.status,202);assert.equal(r.body.data.delivery_confirmed,false);assert.ok(h.events.includes('kandid_student_setup_admission_v1'));assert.ok(!h.events.includes('password'));
 }
});
test('verified OTP returns bounded private recognition and a five-minute single-use proof',async()=>{
 const h=harness();const r=await h.invoke({action:'verify_access',student_number:'700001',verification_code:'012345'});
 assert.equal(r.status,200);const p=r.body.data.setup_verification;
 assert.equal(p.contract_version,3);assert.match(p.setup_token,/^[a-f0-9]{64}$/);assert.ok(readStudentSetupVerification(p,'700001',user));
 assert.deepEqual(p.student_details,{full_name:student.full_name,program:student.program,year_level:1});
 assert.ok(!h.events.includes('password'));assert.equal(JSON.stringify(p).includes(user.email),false);
 for(const changed of [{...p,setup_token:null},{...p,expires_at:0},{...p,contract_version:2},{...p,auth_user_id:'foreign'},{...p,student_details:{...p.student_details,email:user.email}}])assert.equal(readStudentSetupVerification(changed,'700001',user),null);
});
test('invalid OTP and admission errors cannot issue setup proof',async()=>{
 const bad=harness(undefined,{invalidOtp:true});assert.equal((await bad.invoke({action:'verify_access',student_number:'700001',verification_code:'012345'})).status,401);
 assert.ok(!bad.events.includes('kandid_student_setup_issue_v1'));
 const fail=harness(undefined,{rpcError:true});assert.equal((await fail.invoke({action:'begin_access',student_number:'700001'})).status,503);assert.ok(!fail.events.includes('dispatch'));
});
test('setup limits deny lookup, dispatch and verification before student reads',async()=>{
 for(const action of ['inspect_setup','begin_access','verify_access']){
  const h=harness(undefined,{rateAllowed:false});assert.equal((await h.invoke({action,student_number:'700001',...(action==='verify_access'?{verification_code:'012345'}:{})})).status,429);assert.deepEqual(h.events,['kandid_consume_student_auth_rate_limit']);
 }
});
test('both secure endpoints fail closed when the server release switch is off',async()=>{
 for(const name of Object.keys(sources)){
  const h=harness(name,{disabled:true});assert.equal((await h.invoke(name==='resolve-student-login'?{action:'inspect_setup',student_number:'700001'}:setup)).status,503);assert.deepEqual(h.events,[]);
 }
});
test('linking requires the confirmed matching JWT and opaque setup token',async()=>{
 for(const [options,body,authorized] of [[{},setup,false],[{invalidSession:true},setup,true],[{user:{...user,email_confirmed_at:null}},setup,true],[{}, {...setup,setup_token:undefined},true],[{ineligible:true},setup,true],[{badClaim:{}},setup,true]]){
  const h=harness('link-student-identity',options);assert.ok((await h.invoke(body,authorized)).status>=400);assert.ok(!h.events.includes('password'));
 }
});
test('successful link claims before password and finalizes only after successful Auth response',async()=>{
 const h=harness('link-student-identity');const r=await h.invoke(setup);assert.equal(r.status,200);assert.equal(r.body.linked,true);
 assert.deepEqual(h.events,['kandid_student_setup_claim_v1','password','kandid_student_setup_finish_v1']);assert.equal(JSON.stringify(r.body).includes(user.email),false);
});
test('stale finalization, password failure and ambiguous timeout never report activation or retry',async()=>{
 for(const options of [{stale:true},{passwordFailure:true},{fetchThrows:true}]){
  const h=harness('link-student-identity',options);const r=await h.invoke(setup);assert.equal(r.status,409);assert.equal(r.body.code,'setup_recovery_required');
  assert.equal(h.events.filter(e=>e==='password').length,1);if(!options.stale)assert.ok(!h.events.includes('kandid_student_setup_finish_v1'));
 }
});
test('concurrent or replayed proof cannot cause two Auth password writes',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve);const h=harness('link-student-identity',{claimWait:gate});
 const first=h.invoke(setup),second=h.invoke(setup);release();const r=await Promise.all([first,second]);
 assert.deepEqual(r.map(x=>x.status).sort(),[200,403]);assert.equal(h.events.filter(e=>e==='password').length,1);
 assert.equal((await h.invoke(setup)).status,403);assert.equal(h.events.filter(e=>e==='password').length,1);
});
test('ordinary Student login matches the deployed v9 baseline with setup disabled',async()=>{
 for(const options of [{loginActive:true},{loginActive:true,badPassword:true},{loginActive:true,foreignLogin:true},{loginActive:false},{rateAllowed:false}]){
  const request={action:'login',student_number:'700001',password:'Synthetic!123'};
  const before=await harness('legacy-login',options).invoke(request);
  const after=await harness('resolve-student-login',{...options,disabled:true}).invoke(request);
  assert.equal(after.status,before.status);assert.deepEqual(after.body,before.body);
 }
});
