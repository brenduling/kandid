// Production-origin compatibility with entirely synthetic clients. No network or accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {KANDID_WEB_ORIGINS,corsHeaders,handleCorsPreflight,rejectDisallowedOrigin,withKandidCors} from '../supabase/functions/_shared/kandidProductionSecurity.mjs';
const official='https://fszgdxqxonqqcrzsnkca.supabase.co',origin='https://witkandid.vercel.app';
const strip=path=>stripTypeScriptTypes(readFileSync(path,'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const helper={crypto:webcrypto,TextEncoder};
runInNewContext(strip('supabase/functions/_shared/studentSetupAdmission.ts')+'\nglobalThis.api={setupAdmission,setupRpc,setupTokenHash,newSetupToken,setupDetails,maskedSetupRecognition};',helper);
function fixture(name){
 let handler;const requests=[];
 const user={id:'00000000-0000-4000-8000-000000000042',email:'synthetic@example.invalid',email_confirmed_at:'2026-10-22T00:00:00Z'};
 const student={id:42,student_number:'700001',status:'pending',email:user.email,auth_user_id:null,first_name:'Synthetic',last_name:'Student',full_name:'Synthetic Student',program:'BSIT',year_level:1};
 const context={...helper.api,crypto:webcrypto,Request,Response,Headers,URL,TextEncoder,TextDecoder,AbortSignal,setTimeout(fn){fn()},
  KANDID_WEB_ORIGINS,corsHeaders,handleCorsPreflight,rejectDisallowedOrigin,console,
  Deno:{env:{get:key=>({SUPABASE_URL:official,SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',STUDENT_AUTH_RATE_LIMIT_HMAC_SECRET:'x'.repeat(48),STUDENT_SETUP_SECURITY_ENABLED:'true'})[key]},serve(fn){handler=fn}},
  serveWithKandidCors(fn){handler=async req=>withKandidCors(req,await fn(req))},
  createClient(url,key){assert.equal(url,official);return key==='synthetic-service'?{async rpc(name){requests.push(name);return {error:null,data:name==='kandid_consume_student_auth_rate_limit'?true:name==='kandid_student_setup_claim_v1'||name==='kandid_student_setup_admission_v1'?student:{id:42,student_number:'700001',status:'active'}}}}:{auth:{async getUser(){return {data:{user},error:null}}}}},
  async fetch(url,init){assert.equal(url,official+'/auth/v1/user');assert.equal(init.method,'PUT');requests.push('synthetic-password-write');return new Response(JSON.stringify(user))},
 };
 runInNewContext(strip(`supabase/functions/${name}-secure-deploy/index.ts`),context);
 return {requests,invoke:(body,cloudflare=true)=>handler(new Request(official+'/functions/v1/'+name,{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic-session','Content-Type':'application/json',...(cloudflare?{'cf-connecting-ip':'198.51.100.42'}:{'x-forwarded-for':'127.0.0.1'})},body:JSON.stringify(body)}))};
}
test('production origin returns masked admission-gated recognition without any localhost or Kong fallback',async()=>{
 const h=fixture('resolve-student-login');const r=await h.invoke({action:'inspect_setup',student_number:'700001'});
 assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),origin);
 const body=await r.json();assert.equal(body.data.recognition_version,4);
 assert.equal(body.data.masked_first_name,'Sy'+'•'.repeat(7));assert.equal(JSON.stringify(body).includes('Synthetic Student'),false);
 assert.equal(JSON.stringify(body).includes('synthetic@example.invalid'),false);
 assert.deepEqual(h.requests,['kandid_consume_student_auth_rate_limit','kandid_student_setup_admission_v1']);
});
test('cloud source-IP prerequisites fail closed rather than using local test fallback',async()=>{
 const h=fixture('resolve-student-login');assert.equal((await h.invoke({action:'inspect_setup',student_number:'700001'},false)).status,503);assert.deepEqual(h.requests,[]);
});
test('production-origin linker uses official Auth endpoint and proof RPCs with synthetic clients',async()=>{
 const h=fixture('link-student-identity');const r=await h.invoke({student_number:'700001',setup_mode:true,password:'Synthetic!123',setup_token:'a'.repeat(64)});
 assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),origin);assert.equal((await r.json()).linked,true);
 assert.deepEqual(h.requests,['kandid_student_setup_claim_v1','synthetic-password-write','kandid_student_setup_finish_v1']);
});
