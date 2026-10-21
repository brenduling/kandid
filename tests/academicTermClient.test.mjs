import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
const code = transformSync(readFileSync('src/utils/academicTerms.js','utf8'),{format:'cjs',target:'es2022'}).code;
const operationId='00000000-0000-4000-8000-000000000601';
const source={id:1,academic_year:'2026-2027',semester:'1st Semester',status:'active'};
const target={...source,id:2,semester:'2nd Semester',status:'draft'};
const review=()=>({operation_id:operationId,status:'review',expires_at:new Date(Date.now()+600000).toISOString(),
  confirmation_text:'ACTIVATE 2nd Semester AY 2026-2027',impact:{source_term:source,target_term:target,can_activate:true,blockers:[],counts:Object.fromEntries([
    'persistent_accounts','source_enrolled_students','target_enrolled_students','active_accounts_requiring_verification','verified_program_shifts',
    'intended_program_memberships','intended_institution_memberships','target_explicit_removals_preserved','conflicting_program_memberships','blocking_elections','notification_recipients',
  ].map(k=>[k,0]))}});
const receipt=()=>({operation_id:operationId,status:'committed',academic_term:{...target,status:'active'},audit_id:1,notification_count:8,committed_at:new Date().toISOString()});
function fixture(response){const calls=[], exports={}, module={exports};vm.runInNewContext(code,{module,exports,Response,
  require:name=>name.includes('supabaseClient')?{supabase:{functions:{invoke:async(name,args)=>{calls.push({name,...args});return response;}}}}:{clearCachedValue(){},getCachedValue(){},setCachedValue(){}},
  AbortSignal,
});return {api:module.exports,calls};}
test('client sends only guarded request fields and validates authoritative review/receipt responses',async()=>{
  const f=fixture({data:{data:review()},error:null});assert.equal((await f.api.previewAcademicTerm(2)).error,null);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].body)),{action:'preview',termId:2});
  assert.equal(f.calls[0].timeout,60000);
  const c=fixture({data:{data:receipt()},error:null});assert.equal((await c.api.activateAcademicTerm({operationId,confirmationText:review().confirmation_text})).error,null);
  assert.equal(c.calls[0].body.operationId,operationId);assert.equal(c.calls[0].body.acknowledged,true);assert.equal('termId' in c.calls[0].body,false);
});
test('incomplete counts, wrong target, invalid confirmation and unconfirmed commits cannot appear successful',async()=>{
  for(const modify of [r=>delete r.impact.counts.verified_program_shifts,r=>r.impact.target_term.id=99,r=>r.confirmation_text='wrong',r=>r.impact.blockers=['blocked']]){
    const r=review();modify(r);assert.ok((await fixture({data:{data:r},error:null}).api.previewAcademicTerm(2)).error);
  }
  for(const data of [null,review(),{...receipt(),operation_id:'wrong'},{...receipt(),audit_id:null}]) assert.ok((await fixture({data:{data},error:null}).api.activateAcademicTerm({operationId,confirmationText:'x'})).error);
});
test('HTTP errors expose safe backend messages and missing deployment/gateway diagnostics',async()=>{
  for(const [status,body,expected] of [[409,{error:'The impact review expired or changed.'},/expired or changed/],[404,{code:'NOT_FOUND',message:'Requested function was not found'},/not deployed/],[401,{},/gateway rejected/]]){
    const f=fixture({data:null,error:{message:'Edge Function returned a non-2xx status code',context:new Response(JSON.stringify(body),{status})}});
    const r=await f.api.previewAcademicTerm(2);assert.equal(r.error.status,status);assert.match(r.error.message,expected);assert.equal(f.calls.length,1);
  }
  const r=await fixture({error:{name:'FunctionsFetchError',message:'Failed to send a request'}}).api.previewAcademicTerm(2);assert.match(r.error.message,/CORS preflight/);
});
test('permission errors naming academic_terms are errors rather than missing-schema fallbacks',()=>{
  const {api}=fixture({});assert.equal(api.isAcademicTermSchemaMissing({code:'42501',message:'permission denied for table academic_terms'}),false);
  assert.equal(api.isAcademicTermSchemaMissing({code:'PGRST205'}),true);
});
