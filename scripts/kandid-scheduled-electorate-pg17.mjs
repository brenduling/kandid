// Replays inspected contracts in a disposable LOCAL PG17 DB. The Cron catalog
// is a local fixture; native Cron is validated separately. No production URL.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const evidence=resolve(root,'.tmp/voting-backend-runtime/scheduled-electorate');mkdirSync(evidence,{recursive:true});
const container='supabase_db_kandid-board-e2e-20261016-8c19';
const database='kandid_scheduled_'+randomBytes(6).toString('hex');
const prefix=['--config',resolve(root,'.tmp/election-3-rule-validation/docker'),'--host','npipe:////./pipe/dockerDesktopLinuxEngine'];
const docker=(args,input)=>spawnSync('docker',[...prefix,...args],{input,encoding:'utf8',maxBuffer:12*1024*1024,windowsHide:true});
const inspect=docker(['inspect',container]);assert.equal(inspect.status,0,inspect.stderr);
const info=JSON.parse(inspect.stdout)[0];assert.equal(info.Name,'/'+container);assert.equal(info.Config.Labels['com.supabase.cli.project'],'kandid-board-e2e-20261016-8c19');assert.equal(info.HostConfig.PortBindings['5432/tcp'][0].HostPort,'59322');
assert.match(database,/^kandid_scheduled_[a-f0-9]{12}$/);assert.equal(docker(['exec',container,'createdb','-U','postgres','--template=template0',database]).status,0);
const psql=['exec','-i',container,'psql','-X','-q','-At','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
function sql(query,ok=true){const r=docker(psql,query);if(ok)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0,'Expected SQL rejection');return r;}
function asyncSql(query){return new Promise((accept,reject)=>{const child=spawn('docker',[...prefix,...psql],{windowsHide:true});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.on('error',reject);child.on('close',status=>accept({status,stdout,stderr}));child.stdin.end(query);});}
const last=r=>r.stdout.trim().split('\n').at(-1);
const uid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const actor=n=>`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${uid(n)}',true);`;
const board=(query,n=1)=>last(sql(actor(n)+query+';commit;'));
const student=(n,q)=>last(sql(actor(100+n)+q+';commit;'));
const worker=()=>JSON.parse(last(sql('select private.kandid_process_due_electorates();')));
const preview=(id=3,n=1)=>JSON.parse(board(`select public.kandid_get_board_electorate_preview(${id})`,n));
const count=(table,id=3)=>Number(last(sql(`select count(*) from ${table} where election_id=${id};`)));
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name);};const checks=[];
const contract=JSON.parse(readFileSync(resolve(root,'tests/fixtures/election3ElectorateProductionContract.json'),'utf8'));
const migration=readFileSync(resolve(root,'supabase/migrations/20261021140000_scheduled_electorate_finalization.sql'),'utf8');
const create=(id,org=2)=>board(`insert into public.elections(id,title,organization_id,academic_term_id,status,start_date,end_date) values(${id},'Synthetic ${id}',${org},1,'active',timezone('Asia/Manila',clock_timestamp())+interval '5 minutes',timezone('Asia/Manila',clock_timestamp())+interval '2 hours')`);
try{
 assert.equal(last(sql('select current_database();')),database);assert.match(last(sql('show server_version;')),/^17\./);
 sql(readFileSync(resolve(root,'tests/fixtures/election3ElectorateRules.sql'),'utf8'));
 for(const f of contract.functions)sql(f.definition);
 sql(`revoke all on all functions in schema private from public,anon,authenticated,service_role;
 revoke all on function public.kandid_get_board_electorate_preview(integer),public.kandid_lock_board_electorate(integer),public.kandid_get_student_ballot_candidates(integer),public.kandid_is_locked_electorate_member(integer,integer) from public,anon,authenticated,service_role;
 grant execute on function public.kandid_get_board_electorate_preview(integer),public.kandid_lock_board_electorate(integer),public.kandid_get_student_ballot_candidates(integer) to authenticated;
 grant execute on function public.kandid_is_locked_electorate_member(integer,integer) to service_role;
 create trigger elections_guard_frozen_electorate before insert or update on public.elections for each row execute function private.kandid_guard_frozen_electorate();
 create trigger election_eligible_voters_immutable before insert or update or delete on private.election_eligible_voters for each row execute function private.kandid_guard_frozen_electorate_member();
 create trigger vote_ballots_require_locked_electorate before insert on public.vote_ballots for each row execute function private.kandid_require_locked_electorate_for_ballot();
 grant select,insert,update on public.elections to authenticated;
 grant select on public.admin_users to authenticated;
 grant select,insert,update,delete on public.eligibility_rules to authenticated;
 grant usage on sequence public.eligibility_rules_id_seq to authenticated;
 alter table public.elections enable row level security;
 create policy scoped_elections on public.elections to authenticated using(exists(select 1 from public.admin_users a where a.auth_user_id=auth.uid() and a.status='active' and (a.role='super_admin' or a.role='electoral_board' and a.organization_id=elections.organization_id))) with check(exists(select 1 from public.admin_users a where a.auth_user_id=auth.uid() and a.status='active' and (a.role='super_admin' or a.role='electoral_board' and a.organization_id=elections.organization_id)));
 alter table public.eligibility_rules enable row level security;
 delete from public.eligibility_rules where election_id=4;
 update public.elections set status='draft',start_date=timezone('Asia/Manila',now())+interval '30 minutes' where id=3;
 delete from public.eligibility_rules where election_id=3;`);
 const ruleContract=JSON.parse(readFileSync(resolve(root,'tests/fixtures/eligibilityRulesProductionContract.json'),'utf8'));
 for(const p of ruleContract.policies)sql(`create policy ${p.name} on public.eligibility_rules for ${p.cmd} to authenticated ${p.using?'using ('+p.using+')':''} ${p.check?'with check ('+p.check+')':''};`);
 check('migration refuses function drift atomically',()=>{
  const f=contract.functions.find(f=>f.name==='kandid_lock_board_electorate').definition;sql(f.replace('declare','declare\n-- fixture drift'));
  assert.match(sql(migration,false).stderr,/contract drift/);assert.equal(last(sql("select to_regclass('private.election_electorate_finalizations') is null;")),'t');sql(f);
 });
 sql(migration);
 check('installation does not freeze, backfill requests, change elections or install Cron',()=>{
  assert.equal(count('private.election_eligible_voters'),0);assert.equal(count('private.election_electorate_finalizations'),0);
  assert.equal(last(sql("select exists(select 1 from pg_extension where extname='pg_cron');")),'f');
 });
 check('activation fails atomically when the dispatcher is missing',()=>{
  assert.match(sql(actor(1)+"update public.elections set status='active' where id=3;",false).stderr,/Automatic electorate finalization is unavailable/);
  assert.equal(last(sql('select status from public.elections where id=3;')),'draft');assert.equal(count('private.election_electorate_finalizations'),0);
 });
 sql(`create schema cron;create table cron.job(jobid bigint primary key,jobname text,active boolean,username text,database text,schedule text,command text);
 insert into cron.job values(1,'kandid-electorate-finalization-v1',true,'postgres',current_database(),'* * * * *','select private.kandid_process_due_electorates();');`);
 check('a recent trusted dispatcher heartbeat is required before activation',()=>{
  assert.match(sql(actor(1)+"update public.elections set status='active' where id=3;",false).stderr,/unavailable/);assert.equal(worker().processed,0);
 });
 check('no-rule activation queues automatically without freezing and uses Manila start minus ten minutes',()=>{
  board("update public.elections set status='active' where id=3");const p=preview();assert.equal(p.rule_count,0);assert.equal(p.eligibility_mode,'membership_only');assert.equal(p.finalization_state,'scheduled');assert.equal(p.eligible_voters,6);assert.equal(p.is_locked,false);
  assert.equal(last(sql("select due_at=(voting_start at time zone 'Asia/Manila')-interval '10 minutes' from private.election_electorate_finalizations where election_id=3;")),'t');assert.equal(worker().processed,0);
 });
 check('early manual retries cannot force a freeze',()=>{
  const result=JSON.parse(board('select public.kandid_lock_board_electorate(3)'));assert.equal(result.is_locked,false);assert.equal(result.reason_code,'NOT_DUE');assert.equal(count('private.election_eligible_voters'),0);
 });
 check('private worker, core, health and queue are unavailable to API roles',()=>{
  for(const role of ['anon','authenticated','service_role'])for(const query of ['select private.kandid_process_due_electorates()','select private.kandid_attempt_electorate(3)','select * from private.election_electorate_finalizations','update private.electorate_scheduler_health set last_success_at=clock_timestamp()'])assert.match(sql('begin;set local role '+role+';'+query+';',false).stderr,/permission denied/);
 });
 check('a forged legacy GUC cannot authorize a manual freeze',()=>{
  assert.match(sql(actor(1)+"select set_config('kandid.lock_electorate','on',true);update public.elections set electorate_frozen_at=clock_timestamp(),electorate_frozen_by=1 where id=3;",false).stderr,/trusted scheduled finalization/);
 });
 check('late enrollment before finalization appears in the live population',()=>{
  sql(`insert into public.students(id,auth_user_id,status,program,year_level,is_shs,first_name,last_name) values(17,'${uid(117)}','active','BSIT',2,false,'Synthetic','Late');insert into public.student_term_enrollments values(17,1,'enrolled','BSIT',2,false);insert into public.student_organization_terms values(17,2,1,'active','system');`);assert.equal(preview().eligible_voters,7);
 });
 check('optional rules narrow the population and deleting the last rule restores membership-only mode',()=>{
  board("insert into public.eligibility_rules(election_id,program,min_year_level,max_year_level,allow_shs) values(3,'BSIT',1,4,false)");assert.equal(preview().eligible_voters,3);assert.equal(preview().eligibility_mode,'membership_plus_rules');
  board('delete from public.eligibility_rules where election_id=3');assert.equal(preview().eligible_voters,7);assert.equal(preview().rule_count,0);
 });
 check('disabled, foreign Board and students cannot activate or retry another organization',()=>{
  for(const n of [2,3,101])assert.match(sql(actor(n)+'select public.kandid_lock_board_electorate(3);',false).stderr,/42501/);
  assert.equal(last(sql(actor(2)+"with changed as(update public.elections set title='forbidden' where id=3 returning id) select count(*) from changed;rollback;")),'0');
 });
 check('unfinalized candidates remain unavailable even if voting time is reached',()=>{
  assert.match(sql(`begin;alter table public.elections disable trigger elections_schedule_electorate;update public.elections set start_date=timezone('Asia/Manila',now())-interval '1 hour' where id=3;set local role authenticated;select set_config('request.jwt.claim.sub','${uid(101)}',true);select public.kandid_get_student_ballot_candidates(3);`,false).stderr,/42501.*Ballot choices/);
 });
 board("update public.elections set start_date=timezone('Asia/Manila',clock_timestamp())+interval '5 minutes' where id=3");
 check('a failed audit rolls back snapshot/freeze and persists a safe retry reason',()=>{
  sql("create function private.fixture_fail_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic sensitive details';end;$$;create trigger fixture_fail_audit before insert on public.audit_logs for each row execute function private.fixture_fail_audit();");
  assert.equal(worker().processed,1);assert.equal(count('private.election_eligible_voters'),0);assert.equal(preview().is_locked,false);assert.equal(preview().finalization_state,'retrying');assert.equal(preview().reason_code,'FINALIZATION_FAILED');assert.doesNotMatch(JSON.stringify(preview()),/sensitive details/);
  assert.equal(last(sql("select next_attempt_at=date_trunc('minute',last_attempt_at)+interval '1 minute' from private.election_electorate_finalizations where election_id=3;")),'t');
  sql("update private.election_electorate_finalizations set next_attempt_at=clock_timestamp()+interval '5 minutes' where election_id=3;");assert.equal(worker().processed,0,'worker skips a retry before its scheduled attempt');
  sql('drop trigger fixture_fail_audit on public.audit_logs;drop function private.fixture_fail_audit();update private.election_electorate_finalizations set next_attempt_at=clock_timestamp() where election_id=3;');
 });
 sql("create function private.fixture_slow_snapshot() returns trigger language plpgsql as $$begin perform pg_sleep(0.1);return new;end;$$;create trigger fixture_slow_snapshot before insert on private.election_eligible_voters for each row execute function private.fixture_slow_snapshot();");
 const concurrent=await Promise.all([asyncSql('select private.kandid_process_due_electorates();'),asyncSql('select private.kandid_process_due_electorates();')]);
 check('concurrent workers finalize exactly once, without a Board JWT, with one audit',()=>{
  for(const r of concurrent)assert.equal(r.status,0,r.stderr);assert.equal(count('private.election_eligible_voters'),7);assert.equal(count('public.audit_logs'),1);assert.equal(preview().is_locked,true);
  assert.equal(last(sql("select metadata->>'execution' from public.audit_logs where election_id=3;")),'scheduled_database');assert.equal(count('public.vote_ballots'),0);
  const repeat=worker();assert.equal(repeat.processed,0);assert.equal(count('public.audit_logs'),1);
 });
 sql('drop trigger fixture_slow_snapshot on private.election_eligible_voters;drop function private.fixture_slow_snapshot();');
 check('frozen snapshots, rules and voting schedules remain immutable',()=>{
  assert.match(sql('delete from private.election_eligible_voters where election_id=3;',false).stderr,/locked electorate/);
  assert.match(sql(actor(1)+"insert into public.eligibility_rules(election_id,program,allow_shs) values(3,'BSIT',false);",false).stderr,/rules are locked/);
  assert.match(sql(actor(1)+"update public.elections set start_date=start_date+interval '1 hour' where id=3;",false).stderr,/immutable/);
 });
 check('scheduled finalization failure on an empty audience retries after legitimate enrollment',()=>{
  sql("insert into public.organizations values(20,'Synthetic empty organization','manual','non_departmental');insert into public.admin_users values(20,'10000000-0000-4000-8000-000000000020','electoral_board','active',20,'Synthetic empty Board');");
  board("insert into public.elections(id,title,organization_id,academic_term_id,status,start_date,end_date) values(20,'Synthetic empty',20,1,'active',timezone('Asia/Manila',now())+interval '5 minutes',timezone('Asia/Manila',now())+interval '1 hour')",20);
  worker();assert.equal(preview(20,20).reason_code,'NO_ELIGIBLE_MEMBERS');assert.equal(count('private.election_eligible_voters',20),0);
  sql("insert into public.student_organization_terms values(17,20,1,'active','manual');update private.election_electorate_finalizations set next_attempt_at=clock_timestamp() where election_id=20;");worker();assert.equal(preview(20,20).is_locked,true);assert.equal(count('private.election_eligible_voters',20),1);
 });
 check('expired schedules are marked missed without a snapshot or retrospective freeze',()=>{
  create(30);sql("alter table public.elections disable trigger elections_schedule_electorate;update public.elections set start_date=timezone('Asia/Manila',now())-interval '1 minute' where id=30;alter table public.elections enable trigger elections_schedule_electorate;update private.election_electorate_finalizations q set voting_start=e.start_date,due_at=clock_timestamp()-interval '11 minutes',next_attempt_at=clock_timestamp(),revision=private.kandid_electorate_revision(e.id) from public.elections e where e.id=q.election_id and e.id=30;");worker();assert.equal(preview(30).finalization_state,'missed');assert.equal(count('private.election_eligible_voters',30),0);assert.equal(JSON.parse(board('select public.kandid_lock_board_electorate(30)')).is_locked,false);
 });
 check('inactive authorizer blocks the worker; current Board may reauthorize a due retry',()=>{
  create(31);sql("update public.admin_users set status='disabled' where id=1;insert into public.admin_users values(21,'10000000-0000-4000-8000-000000000021','electoral_board','active',2,'Replacement Board');");worker();assert.equal(preview(31,21).reason_code,'AUTHORIZATION_REVOKED');
  assert.equal(JSON.parse(board('select public.kandid_lock_board_electorate(31)',21)).is_locked,true);assert.equal(last(sql('select electorate_frozen_by from public.elections where id=31;')),'21');sql("update public.admin_users set status='active' where id=1;");
 });
 check('inactive and wrong-owned dispatcher catalog entries reject activation',()=>{
  sql("update cron.job set username='authenticator';");assert.match(sql(actor(1)+"insert into public.elections(id,title,organization_id,academic_term_id,status,start_date,end_date) values(32,'Synthetic',2,1,'active',timezone('Asia/Manila',now())+interval '5 minutes',timezone('Asia/Manila',now())+interval '1 hour');",false).stderr,/unavailable/);sql("update cron.job set username='postgres';");
 });
 // Synthetic clock shift only; production frozen dates are never changed.
 sql("alter table public.elections disable trigger elections_guard_frozen_electorate;update public.elections set start_date=timezone('Asia/Manila',now())-interval '1 hour' where id=3;alter table public.elections enable trigger elections_guard_frozen_electorate;");
 check('eligible frozen members receive two candidates; nonmembers and revoked members remain denied',()=>{
  assert.equal(student(1,'select jsonb_array_length(public.kandid_get_student_ballot_candidates(3))'),'2');assert.equal(student(3,'select jsonb_array_length(public.kandid_get_student_ballot_candidates(3))'),'2');
  for(const id of [7,8,9,10,11,14,15])assert.match(sql(actor(100+id)+'select public.kandid_get_student_ballot_candidates(3);',false).stderr,/Ballot choices/);
  assert.match(sql(`begin;update public.student_organization_terms set status='removed' where student_id=1 and organization_id=2;set local role authenticated;select set_config('request.jwt.claim.sub','${uid(101)}',true);select public.kandid_get_student_ballot_candidates(3);`,false).stderr,/Ballot choices/);
 });
 check('trusted insertion guard enforces the canonical membership and voting time',()=>{
  sql('begin;insert into public.vote_ballots(election_id,student_id) values(3,1);rollback;');assert.match(sql('insert into public.vote_ballots(election_id,student_id) values(3,9);',false).stderr,/locked election electorate/);
  assert.match(sql("begin;update public.elections set status='closed' where id=3;insert into public.vote_ballots(election_id,student_id) values(3,1);",false).stderr,/not eligible/);
 });
 const result={result:'PASS',checks:checks.length,details:checks,postgres:17,cron:'catalog fixture, real restricted worker execution; native Cron tested separately',productionConnected:false};writeFileSync(resolve(evidence,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{assert.match(database,/^kandid_scheduled_[a-f0-9]{12}$/);const dropped=docker(['exec',container,'dropdb','-U','postgres','--force',database]);assert.equal(dropped.status,0,dropped.stderr);console.log('Removed isolated scheduled-electorate database.');}
