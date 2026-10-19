import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createCandidateSubmission,saveCandidateEdit,deleteCandidateSafely,disconnectCandidateSafely,loadCandidateManagementContext,validateCandidateValues,mergeCandidatePartylists,candidateSaveError} from '../src/utils/candidateManagementContract.js';
import {isAllowedDevelopmentProductionRequest as allowed} from '../src/utils/developmentProductionWriteGuard.js';
const form={position_id:4,student_id:5,partylist_id:6,photo:'https://example.invalid/photo.png',bio:'Bio',platform:'Platform',credentials:'Credentials',campaign_materials:[{label:'Material',url:'https://example.invalid/rf.pdf',type:'document',downloadable:true}]};
function mock(options={}){
 const calls=[],context={contract_version:1,election:{id:3,organization_id:2,academic_term_id:1},positions:[{id:4,election_id:3,status:'active'}],partylists:[{id:6,election_id:3,organization_id:2}],eligible_students:[{id:5}]};
 let inserted;
 return {calls,auth:{getUser:async()=>({data:{user:options.anonymous?null:{id:'verified'}}})},rpc(name,payload){
  calls.push([name,payload]);const result=name==='kandid_candidate_management_context_v1'?{data:options.context||context,error:options.contextError||null}:
   {data:inserted?(options.saved??[inserted]):options.duplicates||[],error:inserted?options.savedError||null:options.directoryError||null};
  const promise=Promise.resolve(result);promise.retry=()=>promise;return promise;
 },from(table){const chain=new Proxy({}, {get(_,key){
  if(key==='then')return (accept,reject)=>(options.throwMutation?Promise.reject(Error('offline')):Promise.resolve(options.result||{data:inserted?null:{id:42},error:null,status:201})).then(accept,reject);
  return(...args)=>{calls.push([table,key,...args]);if(key==='insert')inserted={...args[0][0],id:42,campaign_status:'draft'};return chain;};
 }});return chain;}};
}
test('candidate INSERT uses actual SDK representation, separate gate and exact columns',async()=>{
 let request;const client=createClient('https://fszgdxqxonqqcrzsnkca.supabase.co','synthetic',{global:{fetch:async(input,init)=>{request={input,method:init.method,body:init.body};return new Response('{"id":42}',{status:201,headers:{'Content-Type':'application/json'}});}}});
 const row=validateCandidateValues(form);await client.from('candidates').insert([row]).retry(false);
 assert.deepEqual([...new URL(request.input).searchParams.keys()],['columns']);assert.equal(allowed({...request,allowPositionManagement:true,allowElectionManagement:true}),false);assert.equal(allowed({...request,allowCandidateManagement:true}),true);
 for(const bad of [{...row,id:99},{...row,organization_id:2},{...row,created_at:'2026-10-18'},{...row,student_id:0},{...row,partylist_id:-1},{...row,photo:'javascript:alert(1)'}])assert.equal(allowed({...request,body:JSON.stringify([bad]),allowCandidateManagement:true}),false);
 assert.equal(allowed({...request,body:JSON.stringify([row,row]),allowCandidateManagement:true}),false);assert.equal(allowed({...request,input:request.input+'&columns="id"',allowCandidateManagement:true}),false);
});
test('creation confirms Draft and the saved ID through the trusted directory without any status PATCH',async()=>{
 const c=mock();const result=await createCandidateSubmission(c)(form,3);assert.equal(result.data.id,42);
 assert.equal(c.calls.some(x=>x[1]==='update'),false);
 assert.equal(Object.hasOwn(c.calls.find(x=>x[1]==='insert')[2][0],'campaign_status'),false);
 assert.equal(c.calls.filter(x=>x[0]==='kandid_admin_candidate_directory').length,2);
 for(const options of [{saved:[]},{savedError:{code:'42501'}},{saved:[{...validateCandidateValues(form),id:42,campaign_status:'published'}]}])
  assert.equal((await createCandidateSubmission(mock(options))(form,3)).error.code,'CANDIDATE_CREATE_UNCONFIRMED');
});
test('creation readback tolerates PostgreSQL JSONB key ordering without ignoring different material values',async()=>{
 const row=validateCandidateValues(form),material=row.campaign_materials[0];
 const saved={...row,id:42,campaign_status:'draft',campaign_materials:[{type:material.type,downloadable:material.downloadable,url:material.url,label:material.label}]};
 assert.equal((await createCandidateSubmission(mock({saved:[saved]}))(form,3)).data.id,42);
 saved.campaign_materials[0].url='https://example.invalid/different.pdf';
 assert.equal((await createCandidateSubmission(mock({saved:[saved]}))(form,3)).error.code,'CANDIDATE_CREATE_UNCONFIRMED');
});

test('candidate read RPC permissions are bounded, explicit and do not authorize writes',()=>{
 const call=(name,payload)=>allowed({input:'https://fszgdxqxonqqcrzsnkca.supabase.co/rest/v1/rpc/'+name,method:'POST',body:JSON.stringify(payload)});
 assert.equal(call('kandid_admin_candidate_directory',{p_election_ids:[3],p_student_ids:null}),true);assert.equal(call('kandid_admin_candidate_directory',{p_election_ids:null,p_student_ids:null}),false);assert.equal(call('kandid_admin_candidate_directory',{p_election_ids:[3],p_student_ids:null,actor_id:1}),false);
 assert.equal(call('kandid_candidate_management_context_v1',{p_election_id:3}),true);assert.equal(call('kandid_candidate_management_context_v1',{p_election_id:3,organization_id:2}),false);
});
test('double submission and repeated confirmed creation produce one INSERT',async()=>{const c=mock(),save=createCandidateSubmission(c);const [a,b]=await Promise.all([save(form,3),save(form,3)]);assert.equal(a.data.id,42);assert.equal(b.data.id,42);assert.equal((await save(form,3)).data.id,42);assert.equal(c.calls.filter(x=>x[1]==='insert').length,1);});
for(const options of [{anonymous:true},{contextError:{code:'42501',message:'Foreign Board denied'}},{contextError:{code:'PGRST202'}},{directoryError:Error('unavailable')},{duplicates:[{id:99,student_id:5}]}])test('missing session, backend readiness, scope or duplicate denial: '+JSON.stringify(options),async()=>{const c=mock(options);assert.ok((await createCandidateSubmission(c)(form,3)).error);assert.equal(c.calls.some(x=>x[1]==='insert'),false);});
test('trusted context rejects ineligible student, retired/foreign position and invalid partylist',async()=>{
 for(const values of [{...form,student_id:9},{...form,position_id:7},{...form,partylist_id:9}]){const c=mock();assert.ok((await createCandidateSubmission(c)(values,3)).error);assert.equal(c.calls.some(x=>x[1]==='insert'),false);}
 const c=mock({context:{contract_version:1,election:{id:3,organization_id:2,academic_term_id:1},positions:[{id:4,election_id:3,status:'retired'}],partylists:[],eligible_students:[{id:5}]}});assert.ok((await createCandidateSubmission(c)({...form,partylist_id:null},3)).error);
});
test('content validation preserves URLs and rejects unsafe, invalid and silently truncated materials',()=>{
 assert.equal(validateCandidateValues(form).campaign_media_urls[0],form.campaign_materials[0].url);
 for(const values of [{...form,student_id:''},{...form,photo:'javascript:alert(1)'},{...form,photo:'https://user:password@example.invalid/photo'},{...form,campaign_materials:Array(4).fill(form.campaign_materials[0])},{...form,bio:{}},{...form,campaign_materials:[{type:'invalid',url:'https://example.invalid'}]}])assert.throws(()=>validateCandidateValues(values));
});
test('same-organization reusable partylists remain allowed; foreign-organization reusable rows do not',async()=>{
 const context={contract_version:1,election:{id:3,organization_id:2,academic_term_id:1},positions:[{id:4,election_id:3,status:'active'}],partylists:[{id:6,election_id:null,organization_id:2}],eligible_students:[{id:5}]};
 assert.equal((await createCandidateSubmission(mock({context}))(form,3)).error,null);
 context.partylists[0].organization_id=9;assert.ok((await createCandidateSubmission(mock({context}))(form,3)).error);
});
test('repeated eligibility refresh does not duplicate reusable partylist options',()=>{
 const context={election:{id:3},partylists:[{id:6,election_id:null,organization_id:2},{id:7,election_id:3,organization_id:2}]};
 const once=mergeCandidatePartylists([{id:6,election_id:null,organization_id:2}],context),twice=mergeCandidatePartylists(once,context);
 assert.deepEqual(twice,once);assert.equal(twice.length,2);
});
for(const options of [{saved:[]},{result:{error:{message:'network'},status:0}},{result:{error:{message:'gateway'},status:503}},{throwMutation:true}])test('ambiguous candidate INSERT is never repeated: '+JSON.stringify(options),async()=>{const c=mock(options),save=createCandidateSubmission(c);assert.equal((await save(form,3)).error.code,'CANDIDATE_CREATE_UNCONFIRMED');assert.equal((await save(form,3)).error.code,'CANDIDATE_CREATE_UNCONFIRMED');assert.equal(c.calls.filter(x=>x[1]==='insert').length,1);});
test('Edit keeps identity and parent immutable, requires confirmed ID and optimistic old-value filters',async()=>{
 const original={...validateCandidateValues(form),id:42};const c=mock();assert.equal((await saveCandidateEdit(c,original,{...form,bio:'Updated'},3)).data.id,42);assert.deepEqual(c.calls.find(x=>x[1]==='update')[2],{bio:'Updated'});assert.ok(c.calls.some(x=>x[1]==='eq'&&x[2]==='position_id'&&x[3]===4));assert.ok(c.calls.some(x=>x[1]==='eq'&&x[2]==='bio'&&x[3]==='Bio'));
 for(const value of [{...form,student_id:8},{...form,position_id:7}])assert.ok((await saveCandidateEdit(mock(),original,value,3)).error);
 for(const data of [null,{id:99}])assert.ok((await saveCandidateEdit(mock({result:{data,error:null,status:200}}),original,{...form,bio:'New'},3)).error);
});
test('candidate errors preserve backend permission details without campaign-publication mislabeling',()=>{
 const permission=candidateSaveError({code:'42501',message:'permission denied for table candidates'});
 assert.match(permission,/database permission/);assert.doesNotMatch(permission,/Campaign status/);
 assert.equal(candidateSaveError({code:'42501',message:'Election is locked by protected history.'}),'Election is locked by protected history.');
 assert.doesNotMatch(candidateSaveError({code:'23514'}),/campaign status/i);
});
test('Delete and explicit disconnect require current scoped backend readiness and confirmed IDs',async()=>{
 const original={...validateCandidateValues(form),id:42};assert.equal((await deleteCandidateSafely(mock(),original,3)).data.id,42);assert.equal((await disconnectCandidateSafely(mock(),original,3)).data.id,42);
 const blocked=mock({contextError:{code:'42501',message:'Protected history'}});assert.ok((await deleteCandidateSafely(blocked,original,3)).error);assert.equal(blocked.calls.some(x=>x[1]==='delete'),false);
 assert.ok((await deleteCandidateSafely(mock(),{...original,position_id:99},3)).error);
});
test('PATCH and DELETE reject parent reassignment, arbitrary identities and unscoped targets',()=>{
 const input='https://fszgdxqxonqqcrzsnkca.supabase.co/rest/v1/candidates?id=eq.42&position_id=eq.4&select=id';
 const call=(method,payload,target=input)=>allowed({input:target,method,body:payload===undefined?undefined:JSON.stringify(payload),allowCandidateManagement:true});
 assert.equal(call('PATCH',{bio:'Updated'}),true);assert.equal(call('PATCH',{student_id:9}),false);assert.equal(call('PATCH',{position_id:7}),false);assert.equal(call('PATCH',{position_id:null}),true);assert.equal(call('DELETE'),true);assert.equal(call('DELETE',undefined,input.replace('&position_id=eq.4','')),false);
});
test('errors distinguish stale updates, duplicate registration and protected history',async()=>{
 assert.match(candidateSaveError({code:'PGRST116'}),/Reload/);assert.match(candidateSaveError({code:'23503'}),/historical/);assert.equal(candidateSaveError({message:'This student is already a candidate for President in this election.'}),'This student is already registered as a candidate in this election.');
 await assert.rejects(loadCandidateManagementContext(mock({contextError:{code:'42883'}}),3),/safety migration/);
});
