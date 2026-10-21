// Synthetic, disposable LOCAL PostgreSQL only. Never uses production credentials.
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {randomBytes} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"..");
const evidence=resolve(root,".tmp/voting-backend-runtime/ballot-finalization");mkdirSync(evidence,{recursive:true});
const container="supabase_db_kandid-board-e2e-20261016-8c19";
const database="kandid_ballot_final_"+randomBytes(6).toString("hex");
const prefix=["--config",resolve(root,".tmp/election-3-rule-validation/docker"),"--host","npipe:////./pipe/dockerDesktopLinuxEngine"];
const docker=(args,input)=>spawnSync("docker",[...prefix,...args],{input,encoding:"utf8",maxBuffer:12*1024*1024,windowsHide:true});
const inspect=docker(["inspect",container]);assert.equal(inspect.status,0,inspect.stderr);
const info=JSON.parse(inspect.stdout)[0];assert.equal(info.Name,"/"+container);
assert.equal(info.Config.Labels["com.supabase.cli.project"],"kandid-board-e2e-20261016-8c19");
assert.equal(info.HostConfig.PortBindings["5432/tcp"][0].HostPort,"59322");
assert.match(database,/^kandid_ballot_final_[a-f0-9]{12}$/);
assert.equal(docker(["exec",container,"createdb","-U","postgres","--template=template0",database]).status,0);
function sql(query,ok=true){const r=docker(["exec","-i",container,"psql","-X","-q","-At","-U","postgres","-d",database,"-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose"],query);if(ok)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0,"Expected rejection");return r;}
const last=r=>r.stdout.trim().split("\n").at(-1);
const uid=n=>"10000000-0000-4000-8000-"+String(n).padStart(12,"0");
const actor=n=>`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${uid(n)}',true);`;
const board=q=>last(sql(actor(1)+q+";commit;"));
const student=(n,q)=>last(sql(actor(100+n)+q+";commit;"));
const service=q=>last(sql("begin;set local role service_role;select set_config('request.jwt.claim.role','service_role',true);"+q+";commit;"));
const preview=()=>JSON.parse(board("select public.kandid_get_board_electorate_preview(4)"));
const count=table=>Number(last(sql("select count(*) from "+table+" where election_id=4;")));
const check=(name,fn)=>{fn();checks.push(name);console.log("PASS "+name);};const checks=[];
const contract=JSON.parse(readFileSync(resolve(root,"tests/fixtures/election3ElectorateProductionContract.json"),"utf8"));
const proposal=readFileSync(resolve(root,"supabase/proposals/election-4-ballot-finalization.sql"),"utf8");
const functionSource=name=>contract.functions.find(f=>f.name===name).definition;
// Swap only synthetic election references, never student or administrator IDs.
let fixture=readFileSync(resolve(root,"tests/fixtures/election3ElectorateRules.sql"),"utf8")
 .replace("(3,'Prac Elec'","(4,'Election'").replace("(4,'Untouched election'","(3,'Untouched election'")
 .replace("values(3,'BSIT',2,4,false),(4,'BSIT',2,4,false)","values(4,'BSIT',2,4,false),(3,'BSIT',2,4,false)")
 .replace("select 4,id from public.students","select 3,id from public.students")
 .replaceAll("values(4,2,","values(3,2,")
 .replace("values(1,3,'active',1),(2,4,'active',1)","values(1,4,'active',1),(2,3,'active',1)")
 .replace("values(1,2,3,'Synthetic Party'","values(1,2,4,'Synthetic Party'");
const original=()=>last(sql(`select md5(jsonb_build_object(
 'elections',(select jsonb_agg(to_jsonb(t) order by id) from public.elections t where id<>4),
 'rules',(select jsonb_agg(to_jsonb(t) order by id) from public.eligibility_rules t where election_id<>4),
 'snapshot',(select jsonb_agg(to_jsonb(t) order by student_id) from private.election_eligible_voters t where election_id<>4),
 'ballots',(select jsonb_agg(to_jsonb(t) order by id) from public.vote_ballots t where election_id<>4),
 'votes',(select jsonb_agg(to_jsonb(t) order by id) from public.votes t where election_id<>4),
 'students',(select jsonb_agg(to_jsonb(t) order by id) from public.students t),
 'enrollment',(select jsonb_agg(to_jsonb(t) order by student_id) from public.student_term_enrollments t))::text);`));
const openWindow=kind=>sql(`begin;alter table public.elections disable trigger elections_guard_frozen_electorate;
 update public.elections set start_date=timezone('Asia/Manila',now())-interval '2 hours',end_date=timezone('Asia/Manila',now())${kind==='expired'?"-interval '1 hour'":"+interval '1 hour'"} where id=4;
 alter table public.elections enable trigger elections_guard_frozen_electorate;commit;`);
try{
 assert.equal(last(sql("select current_database();")),database);assert.match(last(sql("show server_version;")),/^17\./);
 sql(fixture);
 for(const f of contract.functions)sql(f.definition);
 sql(`revoke all on all functions in schema private from public,anon,authenticated,service_role;
 revoke all on function public.resolve_student_organization_participation(integer,integer,integer) from public,anon,authenticated,service_role;
 grant execute on function public.resolve_student_organization_participation(integer,integer,integer) to service_role;
 revoke all on function public.kandid_get_board_electorate_preview(integer),public.kandid_lock_board_electorate(integer),public.kandid_get_student_ballot_candidates(integer),public.kandid_is_locked_electorate_member(integer,integer) from public,anon,authenticated,service_role;
 grant execute on function public.kandid_get_board_electorate_preview(integer),public.kandid_lock_board_electorate(integer),public.kandid_get_student_ballot_candidates(integer) to authenticated;
 grant execute on function public.kandid_is_locked_electorate_member(integer,integer) to service_role;
 create trigger elections_guard_frozen_electorate before insert or update on public.elections for each row execute function private.kandid_guard_frozen_electorate();
 create trigger election_eligible_voters_immutable before insert or update or delete on private.election_eligible_voters for each row execute function private.kandid_guard_frozen_electorate_member();
 create trigger vote_ballots_require_locked_electorate before insert on public.vote_ballots for each row execute function private.kandid_require_locked_electorate_for_ballot();
 alter table private.election_eligible_voters enable row level security;
 revoke all on private.election_eligible_voters from public,anon,authenticated,service_role;
 grant select on public.admin_users to authenticated;
 grant select,update on public.elections to authenticated;
 alter table public.elections enable row level security;
 create policy scoped_board on public.elections to authenticated using(exists(select 1 from public.admin_users a where a.auth_user_id=auth.uid() and a.status='active' and a.role='electoral_board' and a.organization_id=elections.organization_id)) with check(exists(select 1 from public.admin_users a where a.auth_user_id=auth.uid() and a.status='active' and a.role='electoral_board' and a.organization_id=elections.organization_id));
 grant select,insert,update,delete on public.eligibility_rules to authenticated;
 grant usage on sequence public.eligibility_rules_id_seq to authenticated;
 alter table public.eligibility_rules enable row level security;
 delete from public.eligibility_rules where election_id=4;`);
 const ruleContract=JSON.parse(readFileSync(resolve(root,"tests/fixtures/eligibilityRulesProductionContract.json"),"utf8"));
 for(const p of ruleContract.policies)sql(`create policy ${p.name} on public.eligibility_rules for ${p.cmd} to authenticated ${p.using?"using ("+p.using+")":""} ${p.check?"with check ("+p.check+")":""};`);
 const preserved=original();
 check("installed ballot RPC reproduces unfrozen Election 4 denial (42501)",()=>{
  sql("update public.elections set start_date=timezone('Asia/Manila',now())-interval '1 hour' where id=4;");
  assert.match(sql(actor(101)+"select public.kandid_get_student_ballot_candidates(4);",false).stderr,/42501.*Ballot choices are unavailable/);
  sql("update public.elections set start_date=timezone('Asia/Manila',now())+interval '2 hours' where id=4;");
 });
 check("installed preview would allow finalization without rules",()=>assert.equal(preview().locking_allowed,true));
 check("proposal aborts atomically when a reviewed function has drifted",()=>{
  sql(functionSource('kandid_lock_board_electorate').replace('declare','declare\n-- synthetic drift'));
  assert.match(sql(proposal,false).stderr,/Reviewed function has drifted/);
  assert.equal(last(sql("select to_regprocedure('private.kandid_student_matches_ballot_rules(integer,integer)') is null;")),"t");
  sql(functionSource('kandid_lock_board_electorate'));
 });
 sql(proposal);
 check("corrected preview exposes capability and refuses missing eligibility rules",()=>{
  const p=preview();assert.equal(p.eligibility_contract,"declared-rules-v1");assert.equal(p.locking_allowed,false);assert.equal(p.rule_count,0);assert.match(p.blocking_reason,/Save.*eligibility rules/);
  assert.match(sql(actor(1)+"select public.kandid_lock_board_electorate(4);",false).stderr,/Save.*eligibility rules/);
 });
 check("Board saves BSIT Years 1–4 excluding SHS: preview exactly two active linked enrolled members",()=>{
  board("insert into public.eligibility_rules(election_id,program,min_year_level,max_year_level,allow_shs) values(4,'BSIT',1,4,false)");
  assert.equal(preview().eligible_voters,2);assert.equal(preview().locking_allowed,true);
  assert.deepEqual(JSON.parse(last(sql("select jsonb_agg(id order by id) from public.students where private.kandid_student_matches_ballot_rules(4,id);"))),[1,2]);
 });
 check("anonymous, foreign Board, disabled Board and Student cannot finalize or read private electorate",()=>{
  for(const n of [2,3,101])assert.match(sql(actor(n)+"select public.kandid_lock_board_electorate(4);",false).stderr,/42501/);
  for(const role of ['anon','authenticated','service_role'])assert.match(sql('begin;set local role '+role+';select * from private.election_eligible_voters;',false).stderr,/permission denied/);
  assert.match(sql('begin;set local role anon;select public.kandid_lock_board_electorate(4);',false).stderr,/permission denied/);
 });
 check("term enrollment drives rules; SHS, wrong program/year and inactive or ambiguous terms fail closed",()=>{
  assert.equal(last(sql("begin;update public.students set program='BSCS',year_level=6 where id=1;select private.kandid_student_matches_ballot_rules(4,1);rollback;")),"t");
  for(const change of ["update public.academic_terms set status='archived' where id=1","update public.academic_terms set status='active' where id=2"]){
   const p=JSON.parse(last(sql("begin;"+change+";set local role authenticated;select set_config('request.jwt.claim.sub','"+uid(1)+"',true);select public.kandid_get_board_electorate_preview(4);rollback;")));assert.equal(p.locking_allowed,false);
   assert.equal(last(sql("begin;"+change+";select private.kandid_student_matches_ballot_rules(4,1);rollback;")),"f");
  }
 });
 check("past-start unfinalized activation or reschedule is rejected; legacy elapsed window cannot lock",()=>{
  assert.match(sql(actor(1)+"update public.elections set start_date=timezone('Asia/Manila',now())-interval '1 hour' where id=4;",false).stderr,/future voting window/);
  sql("alter table public.elections disable trigger elections_guard_unfinalized_ballot_start;update public.elections set start_date=timezone('Asia/Manila',now())-interval '1 hour' where id=4;alter table public.elections enable trigger elections_guard_unfinalized_ballot_start;");
  assert.equal(preview().locking_allowed,false);assert.match(preview().blocking_reason,/Voting start has passed/);
  assert.match(sql(actor(1)+"select public.kandid_lock_board_electorate(4);",false).stderr,/Voting start has passed/);
  board("update public.elections set start_date=timezone('Asia/Manila',now())+interval '2 hours' where id=4");
 });
 check("partial snapshots and existing voting history require review and are never overwritten",()=>{
  sql("insert into private.election_eligible_voters(election_id,student_id) values(4,1);");
  assert.match(preview().blocking_reason,/incomplete electorate snapshot/);assert.match(sql(actor(1)+"select public.kandid_lock_board_electorate(4);",false).stderr,/incomplete electorate snapshot/);
  sql("delete from private.election_eligible_voters where election_id=4;insert into public.votes(election_id,student_id) values(4,1);");
  assert.match(preview().blocking_reason,/voting history/);assert.match(sql(actor(1)+"select public.kandid_lock_board_electorate(4);",false).stderr,/voting history/);sql("delete from public.votes where election_id=4;");
 });
 check("audit failure rolls the snapshot and frozen timestamp back together",()=>{
  sql("create function private.fixture_fail_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure';end;$$;create trigger fixture_fail_audit before insert on public.audit_logs for each row execute function private.fixture_fail_audit();");
  assert.match(sql(actor(1)+"select public.kandid_lock_board_electorate(4);",false).stderr,/synthetic audit failure/);
  assert.equal(count('private.election_eligible_voters'),0);assert.equal(last(sql("select electorate_frozen_at is null from public.elections where id=4;")),"t");sql("drop trigger fixture_fail_audit on public.audit_logs;drop function private.fixture_fail_audit();");
 });
 check("a lock that crosses voting start rolls back the entire snapshot",()=>{
  sql("create function private.fixture_slow_snapshot() returns trigger language plpgsql as $$begin perform pg_sleep(0.2);return new;end;$$;create trigger fixture_slow_snapshot before insert on private.election_eligible_voters for each row execute function private.fixture_slow_snapshot();");
  assert.match(sql(actor(1)+"update public.elections set start_date=timezone('Asia/Manila',clock_timestamp())+interval '0.3 second' where id=4;select public.kandid_lock_board_electorate(4);",false).stderr,/Voting start has passed/);
  assert.equal(count('private.election_eligible_voters'),0);assert.equal(last(sql("select electorate_frozen_at is null from public.elections where id=4;")),"t");
  sql("drop trigger fixture_slow_snapshot on private.election_eligible_voters;drop function private.fixture_slow_snapshot();");
 });
 check("official finalization includes exactly two students, is idempotent and records one audit",()=>{
  const lock=JSON.parse(board("select public.kandid_lock_board_electorate(4)"));assert.equal(lock.eligible_voters,2);assert.ok(lock.locked_at);
  assert.equal(JSON.parse(board("select public.kandid_lock_board_electorate(4)")).locked_at,lock.locked_at);
  assert.equal(count('private.election_eligible_voters'),2);assert.equal(count('public.audit_logs'),1);
 });
 check("rules, schedule and frozen roster cannot change after finalization",()=>{
  for(const q of ["update public.eligibility_rules set min_year_level=2 where election_id=4","delete from public.eligibility_rules where election_id=4","update public.eligibility_rules set election_id=3 where election_id=4"])assert.match(sql(actor(1)+q+';',false).stderr,/locked|cannot be moved/);
  assert.match(sql(actor(1)+"update public.elections set start_date=start_date+interval '1 hour' where id=4;",false).stderr,/immutable/);
  assert.match(sql("delete from private.election_eligible_voters where election_id=4;",false).stderr,/locked electorate/);
 });
 check("pre-start candidates are empty and submission membership is false",()=>{
  assert.equal(student(1,"select jsonb_array_length(public.kandid_get_student_ballot_candidates(4))"),"0");
  assert.equal(service("select public.kandid_is_locked_electorate_member(4,1)"),"f");
 });
 openWindow('open');
 check("eligible Year 1 and Year 4 receive two candidate cards from active Chairman position",()=>{
  sql("alter table public.positions add column name text default 'Chairman';alter table public.positions add column max_votes integer default 1;");
  for(const id of [1,2]){const rows=JSON.parse(student(id,"select public.kandid_get_student_ballot_candidates(4)"));assert.equal(rows.length,2);assert.equal(rows[0].students.first_name,"Synthetic");assert.equal(rows[0].partylists.name,"Synthetic Party");assert.equal(Object.hasOwn(rows[0],'student_id'),false);assert.equal(service("select public.kandid_is_locked_electorate_member(4,"+id+")"),"t");}
  writeFileSync(resolve(evidence,'candidates.json'),JSON.stringify(JSON.parse(student(1,"select public.kandid_get_student_ballot_candidates(4)")),null,2));
 });
 check("inactive positions are excluded by the ballot RPC",()=>{
  assert.equal(last(sql("begin;update public.positions set status='retired' where id=1;set local role authenticated;select set_config('request.jwt.claim.sub','"+uid(101)+"',true);select jsonb_array_length(public.kandid_get_student_ballot_candidates(4));rollback;")),"0");
 });
 check("ineligible students cannot see choices, pass membership or insert a ballot",()=>{
  for(const id of [3,4,7,8,9,10,11,12,13,14,15]){
   assert.match(sql(actor(100+id)+"select public.kandid_get_student_ballot_candidates(4);",false).stderr,/42501.*Ballot choices are unavailable/);
   assert.equal(service("select public.kandid_is_locked_electorate_member(4,"+id+")"),"f");
   assert.match(sql("insert into public.vote_ballots(election_id,student_id) values(4,"+id+");",false).stderr,/not.*eligible|locked election electorate/);
  }
 });
 check("revoked enrollment, removed membership or changed academic year denies choices without altering snapshot",()=>{
  for(const change of ["update public.student_term_enrollments set enrollment_status='not_enrolled' where student_id=1","update public.student_organization_terms set status='removed' where student_id=1","update public.student_term_enrollments set year_level=5 where student_id=1"]){
   assert.match(sql("begin;"+change+";set local role authenticated;select set_config('request.jwt.claim.sub','"+uid(101)+"',true);select public.kandid_get_student_ballot_candidates(4);",false).stderr,/Ballot choices are unavailable/);
   assert.equal(last(sql("begin;"+change+";set local role service_role;select set_config('request.jwt.claim.role','service_role',true);select public.kandid_is_locked_electorate_member(4,1);rollback;")),"f");
  }assert.equal(count('private.election_eligible_voters'),2);
 });
 check("browser cannot directly insert ballots; trusted duplicate submissions are tested by the integrity runner",()=>{
  assert.match(sql(actor(101)+"insert into public.vote_ballots(election_id,student_id) values(4,1);",false).stderr,/42501.*permission denied/);
  assert.equal(count('public.vote_ballots'),0);
 });
 check("closed and legacy done elections deny candidate visibility and cannot reopen",()=>{
  for(const status of ['closed','done']){
   assert.match(sql("begin;update public.elections set status='"+status+"' where id=4;set local role authenticated;select set_config('request.jwt.claim.sub','"+uid(101)+"',true);select public.kandid_get_student_ballot_candidates(4);",false).stderr,/Ballot choices are unavailable/);
   assert.match(sql("begin;update public.elections set status='"+status+"' where id=4;update public.elections set status='active' where id=4;",false).stderr,/cannot be reopened/);
  }
 });
 openWindow('expired');
 check("expired elections return no candidates and reject new ballots",()=>{
  assert.equal(student(2,"select jsonb_array_length(public.kandid_get_student_ballot_candidates(4))"),"0");assert.equal(service("select public.kandid_is_locked_electorate_member(4,2)"),"f");assert.match(sql("insert into public.vote_ballots(election_id,student_id) values(4,2);",false).stderr,/not eligible/);
 });
 check("other election behavior, records, students, enrollments, votes and receipts remain unchanged",()=>{
  assert.equal(student(3,"select jsonb_array_length(public.kandid_get_student_ballot_candidates(3))"),"1");
  assert.equal(service("select public.kandid_is_locked_electorate_member(3,3)"),"t");
  assert.equal(original(),preserved);
 });
 const result={result:'PASS',checks:checks.length,details:checks,postgres:17,productionConnected:false,productionMutations:0};writeFileSync(resolve(evidence,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{assert.match(database,/^kandid_ballot_final_[a-f0-9]{12}$/);const drop=docker(["exec",container,"dropdb","-U","postgres","--force",database]);assert.equal(drop.status,0,drop.stderr);console.log('Removed isolated local ballot-finalization database.');}
