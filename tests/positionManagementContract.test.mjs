import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createPositionSubmission, savePositionEdit, changePositionStatus, reorderPositions, deleteUnreferencedPosition, validatePositionValues } from '../src/utils/positionManagementContract.js';
import { ELECTION_DELETE_DEPENDENCIES } from '../src/utils/electionDeleteReview.js';
import { isAllowedDevelopmentProductionRequest as allowed } from '../src/utils/developmentProductionWriteGuard.js';

const row={election_id:3,name:'President',max_votes:1,display_order:1};
function client(options={}) {
 const calls=[],existing=options.positions||[];
 const api={calls,auth:{getUser:async()=>({data:{user:options.anonymous?null:{id:'trusted-auth'}},error:options.authError||null})},
  from(table){let kind='read';const chain=new Proxy({}, {get:(_,key)=>{
   if(key==='then')return (accept,reject)=>{
    if(kind!=='read'&&options.throwMutation)return Promise.reject(Error('connection lost')).then(accept,reject);
    let result=kind!=='read'?(options.response||{data:{id:42},error:null,status:201}):{data:table==='admin_users'?{id:1,role:options.role||'electoral_board',status:options.status||'active',organization_id:options.org??10}:table==='elections'?{id:3,organization_id:10,removed_at:options.removed?'2026-10-18T00:00:00Z':null}:table==='positions'?existing:[],error:null,count:options.candidates??0};
    return Promise.resolve(result).then(accept,reject);
   };
   return (...args)=>{calls.push([table,key,...args]);if(['insert','update','delete'].includes(key))kind=key;return chain;};
  }});return chain;},
  rpc(name,payload){calls.push(['rpc',name,payload]);const response=Promise.resolve({data:name==='kandid_can_mutate_election_positions'?options.lifecycle!==false:null,error:null});response.retry=()=>response;return response;},
  functions:{invoke:async(name,{body})=>{calls.push(['invoke',name,body]);const counts=Object.fromEntries(ELECTION_DELETE_DEPENDENCIES.map(({key})=>[key,key==='positions'?1:options.history&&key==='frozen_electorate'?1:0]));return options.reviewFailure?{error:Error('unavailable')}:{data:{data:{schema_version:1,election_id:3,counts,protected_history:!!options.history,may_delete:false}}};}},
 };return api;
}

test('actual SDK position INSERT needs the separate flag and an exact single-row representation',async()=>{
 let request;const api=createClient('https://fszgdxqxonqqcrzsnkca.supabase.co','synthetic-key',{global:{fetch:async(input,init)=>{request={input,method:init.method,body:init.body};return new Response('{"id":42}',{status:201,headers:{'Content-Type':'application/json'}});}}});
 await api.from('positions').insert([row]).select('id').single().retry(false);
 assert.deepEqual([...new URL(request.input).searchParams.keys()],['columns','select']);
 assert.equal(allowed({...request,allowElectionManagement:true}),false);
 assert.equal(allowed({...request,allowPositionManagement:true}),true);
 for(const bad of [{...row,election_id:0},{...row,name:' '},{...row,max_votes:0},{...row,max_votes:1.5},{...row,display_order:-1},{...row,status:'active'},{...row,arbitrary:true}])assert.equal(allowed({...request,body:JSON.stringify([bad]),allowPositionManagement:true}),false);
 for(const query of ['select=*','select=id&columns="id"','select=id&columns="name","name"','select=id&on_conflict=id','select=id&columns="election_id","name","max_votes","display_order"&columns="name"'])assert.equal(allowed({...request,input:'https://fszgdxqxonqqcrzsnkca.supabase.co/rest/v1/positions?'+query,allowPositionManagement:true}),false);
 assert.equal(allowed({...request,body:JSON.stringify([row,row]),allowPositionManagement:true}),false);
});

for(const role of ['electoral_board','super_admin'])test(role+' confirmed Add, duplicate-submit and exact returned ID',async()=>{
 const api=client({role}),save=createPositionSubmission(api);const [a,b]=await Promise.all([save(row,3),save(row,3)]);
 assert.equal(a.data.id,42);assert.equal(b.data.id,42);assert.equal((await save(row,3)).data.id,42);
 assert.equal(api.calls.filter(c=>c[1]==='insert').length,1);assert.deepEqual(api.calls.find(c=>c[1]==='insert')[2],[row]);
 assert.ok(api.calls.some(c=>c[1]==='retry'&&c[2]===false));
});
for(const values of [{...row,name:''},{...row,max_votes:0},{...row,display_order:0},{...row,display_order:2.5},{...row,max_votes:2147483648},{...row,election_id:7}])test('invalid values never reach mutation: '+JSON.stringify(values),async()=>{
 assert.throws(()=>validatePositionValues(values,3));const api=client();assert.ok((await createPositionSubmission(api)(values,3)).error);assert.equal(api.calls.some(c=>c[1]==='insert'),false);
});
for(const options of [{anonymous:true},{role:'student'},{status:'disabled'},{org:99},{removed:true},{lifecycle:false}])test('trusted scope/lifecycle denies mutation: '+JSON.stringify(options),async()=>{
 const api=client(options);assert.ok((await createPositionSubmission(api)(row,3)).error);assert.equal(api.calls.some(c=>c[1]==='insert'),false);
});
for(const positions of [[{id:9,name:' president ',display_order:2}],[{id:9,name:'Other',display_order:1}]])test('duplicate name or order rejected before INSERT',async()=>{
 const api=client({positions});assert.ok((await createPositionSubmission(api)(row,3)).error);assert.equal(api.calls.some(c=>c[1]==='insert'),false);
});
for(const options of [{response:{error:{message:'offline'},status:0}},{response:{error:{message:'gateway'},status:503}},{response:{data:null,error:null,status:201}},{throwMutation:true}])test('ambiguous INSERT never succeeds or retries',async()=>{
 const api=client(options),save=createPositionSubmission(api);assert.equal((await save(row,3)).error.code,'POSITION_CREATE_UNCONFIRMED');assert.equal((await save(row,3)).error.code,'POSITION_CREATE_UNCONFIRMED');assert.equal(api.calls.filter(c=>c[1]==='insert').length,1);
});
test('Edit keeps immutable parent, compares saved fields and confirms returned ID',async()=>{
 const original={...row,id:42,status:'active'},api=client({positions:[original]});assert.equal((await savePositionEdit(api,original,{...row,name:'Chair'})).data.id,42);
 const patch=api.calls.find(c=>c[1]==='update')[2];assert.deepEqual(patch,{name:'Chair'});assert.ok(api.calls.some(c=>c[1]==='eq'&&c[2]==='election_id'&&c[3]===3));
 const forged=client();assert.ok((await savePositionEdit(forged,original,{...row,election_id:99})).error);assert.equal(forged.calls.some(c=>c[1]==='update'),false);
 const denied=client({positions:[original],response:{data:null,error:{code:'PGRST116'},status:406}});assert.ok((await savePositionEdit(denied,original,{...row,name:'Chair'})).error);
});

test('expired sessions and unconfirmed UPDATE responses never report success',async()=>{
 const expired=client({authError:Error('JWT expired')});assert.ok((await createPositionSubmission(expired)(row,3)).error);assert.equal(expired.calls.some(c=>c[1]==='insert'),false);
 for(const data of [null,{id:99}]){const api=client({response:{data,error:null,status:200}});assert.ok((await savePositionEdit(api,{...row,id:42,status:'active'},{...row,name:'Chair'})).error);}
});
test('Retire/reactivate status contract requires confirmed authorized UPDATE',async()=>{
 const api=client();assert.equal((await changePositionStatus(api,{...row,id:42,status:'active'},'retired')).data.id,42);assert.deepEqual(api.calls.find(c=>c[1]==='update')[2],{status:'retired'});
 assert.ok((await changePositionStatus(client(),{...row,id:42},'arbitrary')).error);
});
test('Reorder retains atomic RPC and rejects foreign IDs, duplicate IDs and duplicate orders',async()=>{
 const api=client({positions:[{id:1},{id:2}]});assert.equal((await reorderPositions(api,3,[1,2],[2,1])).error,null);
 for(const [ids,orders]of [[[1,1],[1,2]],[[1,2],[1,1]],[[1,99],[2,1]]])assert.ok((await reorderPositions(client({positions:[{id:1},{id:2}]}),3,ids,orders)).error);
});
test('Delete rechecks history; protected/failed/linked checks never send DELETE',async()=>{
 for(const options of [{history:true},{reviewFailure:true},{candidates:1}]){const api=client(options);assert.ok((await deleteUnreferencedPosition(api,{...row,id:42})).error);assert.equal(api.calls.some(c=>c[1]==='delete'),false);}
 const api=client();assert.equal((await deleteUnreferencedPosition(api,{...row,id:42})).data.id,42);assert.ok(api.calls.some(c=>c[1]==='eq'&&c[2]==='election_id'&&c[3]===3));
});
test('guard restricts PATCH, DELETE and reorder payloads to exact scoped operations',()=>{
 const input='https://fszgdxqxonqqcrzsnkca.supabase.co/rest/v1/positions?id=eq.42&election_id=eq.3&select=id';
 assert.equal(allowed({input,method:'PATCH',body:JSON.stringify({name:'Chair'}),allowPositionManagement:true}),true);
 assert.equal(allowed({input,method:'PATCH',body:JSON.stringify({election_id:99}),allowPositionManagement:true}),false);
 assert.equal(allowed({input:input.replace('&election_id=eq.3',''),method:'DELETE',allowPositionManagement:true}),false);
 assert.equal(allowed({input,method:'DELETE',allowPositionManagement:true}),true);
 for(const payload of [{p_election_id:3,p_position_ids:[1,2],p_display_orders:[2,1]},{p_election_id:3,p_position_ids:[1,1],p_display_orders:[2,1]}])assert.equal(allowed({input:'https://fszgdxqxonqqcrzsnkca.supabase.co/rest/v1/rpc/reorder_election_positions',method:'POST',body:JSON.stringify(payload),allowPositionManagement:true}),new Set(payload.p_position_ids).size===2);
});
