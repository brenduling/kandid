import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPositionSubmission, savePositionEdit, changePositionStatus, reorderPositions, deleteUnreferencedPosition } from '../src/utils/positionManagementContract.js';

export async function runPositionAcceptance(c) {
 const {sql,api,anon,accounts,probeClient,send,evaluate,wait,click,clickExpr,clickText,fill,login,results,jsonSnapshot,before,evidence,origin,suffix,creationPayloads,failNextInsert}=c;
 const literal=x=>"'"+String(x).replaceAll("'","''")+"'";
 const pass=(name,extra={})=>{results.push({name,result:'PASS',...extra});console.log('PASS '+name);};
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=createClient(api,anon,options),student=createClient(api,anon,options),foreign=createClient(api,anon,options);
 for(const [client,account]of [[admin,accounts.admin],[student,accounts.student],[foreign,accounts.foreign]])assert.equal((await client.auth.signInWithPassword(account)).error,null);
 const payload={election_id:91201,name:'Synthetic SQL President',display_order:1,max_votes:1};
 const save=createPositionSubmission(probeClient);
 const [created,repeated]=await Promise.all([save(payload,91201),save(payload,91201)]);
 assert.equal(created.error,null,created.error?.message);assert.equal(repeated.data.id,created.data.id);
 assert.equal((await save(payload,91201)).data.id,created.data.id);
 assert.equal(sql("SELECT count(*) FROM public.positions WHERE election_id=91201 AND name='Synthetic SQL President';"),'1');
 pass('real Board Add and duplicate submission: one persisted position');
 let original=(await probeClient.from('positions').select('*').eq('id',created.data.id).single()).data;
 const edited=await savePositionEdit(probeClient,original,{...original,name:'Synthetic SQL Chair'});assert.equal(edited.error,null,edited.error?.message);
 assert.equal(sql(`SELECT name FROM public.positions WHERE id=${created.data.id};`),'Synthetic SQL Chair');
 pass('real Board Edit persists with immutable parent and trusted audit');
 const stale=await savePositionEdit(probeClient,original,{...original,name:'Synthetic stale overwrite'});assert.ok(stale.error);assert.equal(sql(`SELECT name FROM public.positions WHERE id=${created.data.id};`),'Synthetic SQL Chair');pass('stale concurrent Edit cannot overwrite a confirmed newer version');
 const second=await createPositionSubmission(admin)({...payload,name:'Synthetic SQL Vice',display_order:2},91201);assert.equal(second.error,null,second.error?.message);pass('real Super Admin Add');
 const reordered=await reorderPositions(probeClient,91201,[created.data.id,second.data.id],[2,1]);assert.equal(reordered.error,null,reordered.error?.message);
 assert.equal(sql(`SELECT display_order FROM public.positions WHERE id=${created.data.id};`),'2');pass('atomic reorder persists without duplicate display orders');
 original=(await probeClient.from('positions').select('*').eq('id',created.data.id).single()).data;
 const retired=await changePositionStatus(probeClient,original,'retired');assert.equal(retired.error,null,retired.error?.message);
 const retiredRow=(await probeClient.from('positions').select('*').eq('id',created.data.id).single()).data;
 assert.equal((await changePositionStatus(probeClient,retiredRow,'active')).error,null);
 assert.equal(sql(`SELECT status FROM public.positions WHERE id=${created.data.id};`),'active');pass('existing status contract: retire/reactivate without losing ID or history');
 for(const values of [{...payload,name:' '},{...payload,max_votes:0},{...payload,display_order:1.5},{...payload,name:'a'.repeat(101)}])assert.ok((await createPositionSubmission(probeClient)(values,91201)).error);
 for(const values of [{...payload,name:' synthetic sql chair ',display_order:3},{...payload,name:'Synthetic occupied order',display_order:2}])assert.ok((await createPositionSubmission(probeClient)(values,91201)).error);
 pass('invalid values and duplicate names/orders rejected without mutation');
 for(const [name,client,parent]of [['foreign organization',foreign,91201],['Student account',student,91201],['closed lifecycle',probeClient,91203],['removed election',probeClient,91204]]){
  const values={...payload,election_id:parent,name:'Synthetic denied '+name,display_order:10};
  assert.ok((await createPositionSubmission(client)(values,parent)).error,name+' helper denial');
  const direct=await client.from('positions').insert([values]).select('id').single().retry(false);assert.ok(direct.error,name+' actual RLS/trigger denial');
  assert.equal(sql(`SELECT count(*) FROM public.positions WHERE name=${literal(values.name)};`),'0');pass('direct API and helper denial: '+name);
 }
 const anonymous=createClient(api,anon,options);assert.ok((await createPositionSubmission(anonymous)({...payload,display_order:10},91201)).error);pass('anonymous creation denied');
 const moved=await probeClient.from('positions').update({election_id:91202}).eq('id',created.data.id).select('id').single();assert.ok(moved.error);assert.equal(sql(`SELECT election_id FROM public.positions WHERE id=${created.data.id};`),'91201');pass('direct parent tampering denied by existing trigger/RLS');
 const historical=JSON.parse(sql('SELECT to_jsonb(p) FROM public.positions p WHERE id=91101;'));
 assert.ok((await deleteUnreferencedPosition(probeClient,historical)).error);
 const directDelete=await probeClient.from('positions').delete().eq('id',historical.id).select('id').single();assert.ok(directDelete.error);
 assert.deepEqual(jsonSnapshot(),before);pass('historical/frozen position deletion blocked; all original history unchanged');
 const secondRow=(await admin.from('positions').select('*').eq('id',second.data.id).single()).data;
 const deleted=await deleteUnreferencedPosition(admin,secondRow);assert.equal(deleted.error,null,deleted.error?.message);assert.equal(deleted.data.id,secondRow.id);
 assert.equal(sql(`SELECT count(*) FROM public.positions WHERE id=${secondRow.id};`),'0');pass('existing unreferenced-position deletion: confirmed ID; no CASCADE');
 assert.equal(sql(`SELECT count(*)>0 FROM public.audit_logs WHERE entity_type='position' AND entity_id='${created.data.id}' AND user_id=901 AND event_origin='trusted_database';`),'t');pass('database audit attribution uses authenticated Board identity');
 const concurrentPayload={...payload,name:'Synthetic concurrent Add',display_order:40};
 const concurrent=await Promise.all([probeClient.from('positions').insert([concurrentPayload]).select('id').single().retry(false),probeClient.from('positions').insert([concurrentPayload]).select('id').single().retry(false)]);
 assert.equal(concurrent.filter(x=>!x.error).length,1);assert.equal(concurrent.filter(x=>x.error?.code==='23505').length,1);pass('concurrent same-order requests are duplicate-safe in PostgreSQL');

 async function page(role){await send('Page.navigate',{url:origin+(role==='board'?'/board/positions?election=91201':'/super-admin/positions')});if(role==='admin'){await wait("!!document.querySelector('.sa-ballot-selector-record')");await clickExpr("Array.from(document.querySelectorAll('.sa-ballot-selector-record')).find(e=>e.textContent.includes('Synthetic Position Election'))");}await wait(role==='board'?"!!document.querySelector('.board-positions-create')":"!!document.querySelector('.sa-positions-add')");}
 const untilSql=async(q,expected)=>{for(let i=0;i<60;i++){if(sql(q)===expected)return;await delay(100);}assert.equal(sql(q),expected);};
 for(const [width,height]of [[375,844],[820,1000],[1440,900]])for(const role of ['board','admin']){
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await login(role);await page(role);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'position register has no overflow');
  await click(role==='board'?'.board-positions-create':'.sa-positions-add');
  const prefix=role==='board'?'board':'sa';await wait(`!!document.querySelector('#${prefix}-position-name')`);
  const name=`Synthetic UI ${role} ${width} ${suffix}`;
  await fill(`#${prefix}-position-name`,name);await fill(`#${prefix}-position-max-votes`,'0');
  await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(role==='board'?'.board-position-sheet-next':'.position-form-actions [type=submit]')});b.form.noValidate=true;b.form.requestSubmit(b);})()`);
  await wait(`document.querySelector('#${prefix}-position-max-votes')?.getAttribute('aria-invalid')==='true' && document.body.textContent.includes('must be at least 1')`);assert.equal(sql(`SELECT count(*) FROM public.positions WHERE name=${literal(name)};`),'0');
  await fill(`#${prefix}-position-max-votes`,'1');
  await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(role==='board'?'.board-position-sheet-next':'.position-form-actions [type=submit]')});b.form.noValidate=false;b.form.requestSubmit(b);b.form.requestSubmit(b);})()`);
  await wait("document.body.textContent.includes('Add Candidate Now?')");await clickText('Done');await wait(`!document.querySelector('#${prefix}-position-name')`);
  await wait(`document.body.textContent.includes(${JSON.stringify(name)})`);
  assert.equal(sql(`SELECT count(*) FROM public.positions WHERE election_id=91201 AND name=${literal(name)};`),'1');
  const saved=JSON.parse(sql(`SELECT to_jsonb(p) FROM public.positions p WHERE name=${literal(name)};`));assert.equal(saved.max_votes,1);assert.equal(saved.status,'active');
  await clickExpr(role==='board'?`document.querySelector(${JSON.stringify('[aria-label="Edit '+name+'"]')})`:`Array.from(document.querySelectorAll('article')).find(e=>e.textContent.includes(${JSON.stringify(name)})).querySelector('[title="Edit position"]')`);
  await wait(`document.querySelector('#${prefix}-position-name')?.value===${JSON.stringify(name)}`);
  const updated=name+' edited';await fill(`#${prefix}-position-name`,updated);
  await click(role==='board'?'.board-position-sheet-next':'.position-form-actions [type=submit]');await wait(`!document.querySelector('#${prefix}-position-name')`);await wait(`document.body.textContent.includes(${JSON.stringify(updated)})`);
  assert.equal(sql(`SELECT name FROM public.positions WHERE id=${saved.id};`),updated);
  const oldOrder=Number(sql(`SELECT display_order FROM public.positions WHERE id=${saved.id};`));
  await click(`[aria-label="Move ${updated} up"]`);await untilSql(`SELECT display_order<${oldOrder} FROM public.positions WHERE id=${saved.id};`,'t');
  const afterOrder=sql(`SELECT display_order FROM public.positions WHERE id=${saved.id};`);
  await page(role);await wait(`document.body.textContent.includes(${JSON.stringify(updated)})`);assert.equal(sql(`SELECT display_order FROM public.positions WHERE id=${saved.id};`),afterOrder);
  const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(evidence,`${role}-${width}-positions.png`),Buffer.from(shot.data,'base64'));
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'position workspace no horizontal overflow');
  assert.deepEqual(jsonSnapshot(),before);pass('actual browser Add/Edit/reorder/refresh: '+role+' '+width,{width,role});
 }
 await send('Emulation.setDeviceMetricsOverride',{width:375,height:844,deviceScaleFactor:1,mobile:false});await login('board');await page('board');await click('.board-positions-create');await wait("!!document.querySelector('#board-position-name')");
 const failedName='Synthetic unconfirmed '+suffix;await fill('#board-position-name',failedName);failNextInsert();
 await click('.board-position-sheet-next');await wait("document.body.textContent.includes('It may already have been saved')");
 assert.equal(sql(`SELECT count(*) FROM public.positions WHERE name=${literal(failedName)};`),'0');
 await click('.board-position-sheet-next');await delay(300);assert.equal(creationPayloads.filter(x=>x.name===failedName).length,1);
 assert.equal(await evaluate("document.querySelector('#board-position-name').value"),failedName);await click('[aria-label="Close add position"]');
 pass('browser ambiguous network failure retains modal; no automatic or repeated INSERT');
 assert.deepEqual(jsonSnapshot(),before);assert.equal(sql('SELECT count(*) FROM public.positions WHERE display_order<=0 OR max_votes<=0;'),'0');
 pass('final PostgreSQL invariants and all original history preservation');
}
