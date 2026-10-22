// Disposable PostgreSQL fixtures only; no URLs, .env, cloud credentials or real email.
import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
const container='supabase_db_kandid-board-e2e-20261016-8c19';
const run=(args,input)=>spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
const inspected=run(['inspect',container]);assert.equal(inspected.status,0,'Verified isolated Docker database must be available');
const info=JSON.parse(inspected.stdout)[0];
assert.equal(info.Config.Labels['com.supabase.cli.project'],'kandid-board-e2e-20261016-8c19');
assert.equal(info.HostConfig.PortBindings['5432/tcp'][0].HostPort,'59322');
assert.equal(info.Id,'6bd024cac2ec0f8ffac8ec31b322f5fa581b51f9e8139edfdb4fd0c30d2c4676');
const db='kandid_setup_security_'+randomBytes(6).toString('hex');
assert.equal(run(['exec',container,'createdb','-U','postgres','--template=template0',db]).status,0);
const args=['exec','-i',container,'psql','-X','-q','-At','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'];
const sql=(query,ok=true)=>{const r=run(args,query);if(ok)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0);return r;};
const value=q=>sql(q).stdout.trim().split('\n').at(-1);
const uid='00000000-0000-4000-8000-000000000042',other='00000000-0000-4000-8000-000000000043';
const hash=n=>createHash('sha256').update('synthetic-proof-'+n).digest('hex');
const call=(name,n=1,user=uid)=>`select public.kandid_student_setup_${name}_v1('700001','${user}','synthetic@example.invalid','${hash(n)}');`;
const admission=()=>value(`select public.kandid_student_setup_admission_v1('700001');`);
const issue=n=>JSON.parse(value(call('issue',n))||'null');
const claim=n=>JSON.parse(value(call('claim',n))||'null');
const finish=n=>JSON.parse(value(call('finish',n))||'null');
const results=[];
const check=(name,f)=>{f();results.push({name,status:'PASS'});console.log('PASS '+name);};
sql(`create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create table public.students(id bigint primary key,student_number text unique,email text,status text,auth_user_id uuid references auth.users(id),first_name text,last_name text,program text,year_level int);
create unique index student_auth_unique on public.students(auth_user_id) where auth_user_id is not null;
create table public.admin_users(id bigint primary key,email text,auth_user_id uuid,status text);
create table public.student_term_enrollments(student_id bigint,academic_term_id int,enrollment_status text);
insert into public.student_term_enrollments values(42,1,'enrolled'),(42,2,'unverified');
alter table public.students enable row level security;
revoke all on public.students,public.admin_users from public,anon,authenticated;
insert into auth.users values('${uid}','synthetic@example.invalid',now()),('${other}','other@example.invalid',now());`);
const reset=()=>sql(`truncate public.students,public.admin_users,private.student_setup_proofs;
update auth.users set email='synthetic@example.invalid',email_confirmed_at=now() where id='${uid}';
insert into public.students values(42,'700001',' Synthetic@Example.Invalid ','pending',null,'Synthetic','Student','BSIT',1);`);
const proposal=readFileSync('supabase/proposals/student-setup-security.sql','utf8');
sql(proposal);reset();
check('migration replay fails closed without replacing functions',()=>assert.match(sql(proposal,false).stderr,/already exist/));
check('only service role executes admission/proof/claim/finalization RPCs',()=>{
 for(const role of ['anon','authenticated'])for(const q of [`select public.kandid_student_setup_admission_v1('700001');`,call('issue'),call('claim'),call('finish')])sql(`set role ${role};`+q,false);
 assert.ok(JSON.parse(value(`set role service_role;select public.kandid_student_setup_admission_v1('700001');`)).id===42);
 for(const role of ['anon','authenticated','service_role'])sql(`set role ${role};select * from private.student_setup_proofs;`,false);
});
check('pending identity remains setup eligible without verified current-term enrollment',()=>assert.equal(JSON.parse(admission()).id,42));
check('duplicate pending normalized email is rejected by admission, issuance and claim',()=>{
 issue(1);sql(`insert into public.students values(43,'700002','synthetic@example.invalid','pending',null,null,null,null,null);`);
 assert.equal(admission(),'');assert.equal(issue(2),null);assert.equal(claim(1),null);reset();
});
for(const status of ['active','pending'])check(status+' email collision beyond row 1000 is authoritative',()=>{
 sql(`insert into public.students select n,'8'||n,'unrelated-'||n||'@example.invalid','disabled',null,null,null,null,null from generate_series(100,1100)n;
 insert into public.students values(1200,'89999','SYNTHETIC@example.invalid','${status}',null,null,null,null,null);`);
 assert.equal(admission(),'');assert.equal(issue(1),null);reset();
});
check('privileged email after row 1000 is rejected without pagination',()=>{
 sql(`insert into public.admin_users select n,'admin-'||n||'@example.invalid',null,'active' from generate_series(1,1001)n;
 update public.admin_users set email=' synthetic@EXAMPLE.invalid ' where id=1001;`);
 assert.equal(admission(),'');assert.equal(issue(1),null);reset();
});
for(const state of ['disabled','pending_linked','foreign_linked','admin_uid','unconfirmed'])check(state+' identity fails admission and proof issuance',()=>{
 if(state==='disabled')sql("update public.students set status='disabled';");
 if(state==='pending_linked')sql(`update public.students set auth_user_id='${uid}';`);
 if(state==='foreign_linked')sql(`update public.students set status='active',auth_user_id='${other}';`);
 if(state==='admin_uid')sql(`insert into public.admin_users values(1,'different@example.invalid','${uid}','disabled');`);
 if(state==='unconfirmed')sql(`update auth.users set email_confirmed_at=null where id='${uid}';`);
 assert.equal(issue(1),null);reset();
});
check('five-minute proof, no early activation, one claim and replay prevention',()=>{
 const proof=issue(1);assert.equal(proof.account_state,'pending');assert.ok(proof.expires_at*1000-Date.now()<=301000);
 assert.equal(value('select status from public.students where id=42;'),'pending');assert.ok(claim(1));assert.equal(claim(1),null);
 assert.equal(finish(1).status,'active');assert.equal(finish(1),null);assert.equal(claim(1),null);
 assert.equal(value(`select count(*) from public.student_term_enrollments where enrollment_status='unverified';`),'1');reset();
});
check('expired proof cannot claim',()=>{issue(1);sql(`update private.student_setup_proofs set created_at=now()-interval '10 minutes',expires_at=now()-interval '1 minute';`);assert.equal(claim(1),null);reset();});
check('proof is bound to confirmed Auth UID and expected registered email',()=>{
 issue(1);assert.equal(value(call('claim',1,other)),'');
 assert.equal(value(call('claim',1).replace('synthetic@example.invalid','other@example.invalid')),'');reset();
});
for(const change of ["status='disabled'","email='changed@example.invalid'",`auth_user_id='${other}'`])check('stale claim rejects '+change,()=>{
 issue(1);sql(`update public.students set ${change} where id=42;`);assert.equal(claim(1),null);reset();
});
for(const change of ["status='disabled'","email='changed@example.invalid'",`auth_user_id='${other}'`])check('finalization preserves concurrent '+change,()=>{
 issue(1);claim(1);sql(`update public.students set ${change} where id=42;`);
 const before=value('select row_to_json(s)::text from public.students s where id=42;');
 assert.equal(finish(1),null);assert.equal(value('select row_to_json(s)::text from public.students s where id=42;'),before);reset();
});
check('new email collision during password request prevents final activation',()=>{
 issue(1);claim(1);sql(`insert into public.admin_users values(1,'synthetic@example.invalid',null,'active');`);assert.equal(finish(1),null);reset();
});
check('uncertain/abandoned claim blocks new password attempts even after expiry',()=>{
 issue(1);claim(1);sql(`update private.student_setup_proofs set created_at=now()-interval '10 minutes',expires_at=now()-interval '1 minute';`);
 assert.equal(issue(2),null);assert.equal(finish(1),null);reset();
});
check('already active linked identity receives login state and no password authorization',()=>{
 sql(`update public.students set status='active',auth_user_id='${uid}';`);assert.equal(issue(1).account_state,'active');assert.equal(claim(1),null);reset();
});
check('scoped recovery needs exact approval and permits only a fresh proof after review',()=>{
 issue(1);claim(1);sql(`update private.student_setup_proofs set created_at=now()-interval '10 minutes',expires_at=now()-interval '1 minute';`);
 const recovery=readFileSync('supabase/proposals/student-setup-security.recover.sql','utf8');
 sql('begin;'+recovery+'commit;',false);
 sql(`begin;set local kandid.setup_recovery_approved='true';set local kandid.setup_recovery_hash='${hash(1)}';set local kandid.setup_recovery_uid='${other}';`+recovery+'commit;',false);
 sql(`begin;set local kandid.setup_recovery_approved='true';set local kandid.setup_recovery_hash='${hash(1)}';set local kandid.setup_recovery_uid='${uid}';`+recovery+'commit;');
 assert.equal(finish(1),null);assert.equal(claim(1),null);assert.ok(issue(2));assert.ok(claim(2));reset();
});
// Real concurrent database sessions, not sequential mocks.
issue(1);issue(2);
const concurrent=query=>new Promise((accept,reject)=>{const p=spawn('docker',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';p.stdout.on('data',x=>out+=x);p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):accept(out.trim()));p.stdin.end(query);});
const races=await Promise.all([concurrent('begin;'+call('claim',1)+'select pg_sleep(0.5);commit;'),concurrent(call('claim',2))]);
assert.equal(races.filter(r=>r.includes('"student_number"')).length,1);
assert.equal(value('select count(*) from private.student_setup_proofs where claimed_at is not null;'),'1');
results.push({name:'two concurrent proof claims allow exactly one password writer',status:'PASS'});
const rollback=readFileSync('supabase/proposals/student-setup-security.rollback.sql','utf8');
check('rollback refuses unresolved password attempts',()=>assert.match(sql(rollback,false).stderr,/Unresolved password attempt/));
// Finish only the winning synthetic claim before testing the recovery artifact.
const winning=Number(value(`select case when proof_hash='${hash(1)}' then 1 else 2 end from private.student_setup_proofs where claimed_at is not null;`));
assert.equal(finish(winning).status,'active');
const beforeRollback=value('select row_to_json(s)::text from public.students s where id=42;');
check('rollback removes only new RPCs and preserves student, enrollment and proof journal',()=>{
 sql(rollback);
 assert.equal(value('select row_to_json(s)::text from public.students s where id=42;'),beforeRollback);
 assert.equal(value('select count(*) from public.student_term_enrollments;'),'2');
 assert.equal(value('select count(*) from private.student_setup_proofs;'),'2');
 assert.equal(value("select to_regprocedure('public.kandid_student_setup_admission_v1(text,uuid,text)') is null;"),'t');
});
mkdirSync('.tmp/student-setup-security',{recursive:true});
writeFileSync('.tmp/student-setup-security/postgres-results.json',JSON.stringify({db,results,productionRequests:0},null,2)+'\n');
console.log(JSON.stringify({database:db,passed:results.length,productionRequests:0}));
