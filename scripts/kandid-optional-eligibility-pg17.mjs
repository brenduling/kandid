// Proposal verification, synthetic LOCAL PostgreSQL only. Does not install Cron
// or claim that a scheduled production finalizer is implemented/deployed.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const evidence=resolve(root,'.tmp/voting-backend-runtime/optional-eligibility');mkdirSync(evidence,{recursive:true});
const container='supabase_db_kandid-board-e2e-20261016-8c19';
const database='kandid_optional_'+randomBytes(6).toString('hex');
const prefix=['--config',resolve(root,'.tmp/election-3-rule-validation/docker'),'--host','npipe:////./pipe/dockerDesktopLinuxEngine'];
const docker=(args,input)=>spawnSync('docker',[...prefix,...args],{input,encoding:'utf8',maxBuffer:12*1024*1024,windowsHide:true});
const inspection=docker(['inspect',container]);assert.equal(inspection.status,0,inspection.stderr);
const info=JSON.parse(inspection.stdout)[0];assert.equal(info.Name,'/'+container);
assert.equal(info.Config.Labels['com.supabase.cli.project'],'kandid-board-e2e-20261016-8c19');
assert.equal(info.HostConfig.PortBindings['5432/tcp'][0].HostPort,'59322');
assert.match(database,/^kandid_optional_[a-f0-9]{12}$/);
assert.equal(docker(['exec',container,'createdb','-U','postgres','--template=template0',database]).status,0);
function sql(query,ok=true){const r=docker(['exec','-i',container,'psql','-X','-q','-At','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],query);if(ok)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0,'Expected rejection');return r;}
const last=r=>r.stdout.trim().split('\n').at(-1);
const uid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const actor=n=>`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${uid(n)}',true);`;
const board=q=>last(sql(actor(1)+q+';commit;'));
const student=(n,q)=>last(sql(actor(100+n)+q+';commit;'));
const service=q=>last(sql("begin;set local role service_role;select set_config('request.jwt.claim.role','service_role',true);"+q+';commit;'));
const predicate='private.kandid_student_matches_optional_eligibility';
const members=()=>JSON.parse(last(sql(`select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from public.students where ${predicate}(3,id);`)));
const checks=[];const check=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name);};
const contract=JSON.parse(readFileSync(resolve(root,'tests/fixtures/election3ElectorateProductionContract.json'),'utf8'));
try{
 assert.equal(last(sql('select current_database();')),database);assert.match(last(sql('show server_version;')),/^17\./);
 sql(readFileSync(resolve(root,'tests/fixtures/election3ElectorateRules.sql'),'utf8'));
 for(const fn of contract.functions)sql(fn.definition);
 sql(readFileSync(resolve(root,'supabase/proposals/optional-eligibility-canonical-policy.sql'),'utf8'));
 sql(`revoke all on all functions in schema private from public,anon,authenticated,service_role;
 revoke all on function public.kandid_get_board_electorate_preview(integer),public.kandid_lock_board_electorate(integer),public.kandid_get_student_ballot_candidates(integer),public.kandid_is_locked_electorate_member(integer,integer) from public,anon,authenticated,service_role;
 grant execute on function public.kandid_get_board_electorate_preview(integer),public.kandid_lock_board_electorate(integer),public.kandid_get_student_ballot_candidates(integer) to authenticated;
 grant execute on function public.kandid_is_locked_electorate_member(integer,integer) to service_role;
 create trigger elections_guard_frozen_electorate before insert or update on public.elections for each row execute function private.kandid_guard_frozen_electorate();
 create trigger election_eligible_voters_immutable before insert or update or delete on private.election_eligible_voters for each row execute function private.kandid_guard_frozen_electorate_member();
 create trigger vote_ballots_require_locked_electorate before insert on public.vote_ballots for each row execute function private.kandid_require_locked_electorate_for_ballot();
 delete from public.eligibility_rules where election_id=3;`);
 // Experimental public adapters replay the inspected authorization bodies,
 // adding ONLY the proposed canonical population predicate. These are local
 // integration probes, not the scheduled executor or release-ready migrations.
 for(const name of ['kandid_get_board_electorate_preview','kandid_lock_board_electorate']){
  let definition=contract.functions.find(f=>f.name===name).definition;
  assert.equal(definition.split('and participation.allowed is true').length,2);
  definition=definition.replace('and participation.allowed is true',`and participation.allowed is true and ${predicate}(election_row.id,s.id)`);
  sql(definition);
 }
 let candidates=contract.functions.find(f=>f.name==='kandid_get_student_ballot_candidates').definition;
 candidates=candidates.replace('if not coalesce(participation_allowed,false) then',`if not coalesce(participation_allowed,false) or (election_row.electorate_policy_version=1 and not ${predicate}(p_election_id,student_id_value)) then`);
 sql(candidates);
 let membership=contract.functions.find(f=>f.name==='kandid_is_locked_electorate_member').definition;
 membership=membership.replace('and v.student_id = p_student_id',`and v.student_id = p_student_id and ${predicate}(p_election_id,p_student_id)`);
 sql(membership);
 check('no rules defaults to active authenticated enrolled organization members, without invented academic restrictions',()=>{
  assert.deepEqual(members(),[1,2,3,4,12,13]);
  assert.equal(JSON.parse(board('select public.kandid_get_board_electorate_preview(3)')).eligible_voters,6);
 });
 check('a draft can have a membership-only audience without being authorized to vote',()=>{
  assert.equal(last(sql(`begin;update public.elections set status='draft' where id=3;select ${predicate}(3,1);rollback;`)),'t');
 });
 check('adding BSIT Years 1–4, SHS excluded narrows membership to exactly two',()=>{
  sql("insert into public.eligibility_rules(election_id,program,min_year_level,max_year_level,allow_shs) values(3,'BSIT',1,4,false);");
  assert.deepEqual(members(),[1,2]);assert.equal(JSON.parse(board('select public.kandid_get_board_electorate_preview(3)')).eligible_voters,2);
 });
 check('rules cannot grant access to a nonmember, unlinked/pending/disabled student or missing term enrollment',()=>{
  for(const id of [5,6,7,8,9,10,11,14,15,16])assert.equal(last(sql(`select ${predicate}(3,${id});`)),'f');
 });
 check('current term academics, not stale central program/year, determine optional restrictions',()=>{
  assert.equal(last(sql(`begin;update public.students set program='BSCS',year_level=6 where id=1;select ${predicate}(3,1);rollback;`)),'t');
 });
 check('candidate and trusted membership adapters enforce saved rules on an already frozen electorate',()=>{
  assert.equal(student(2,'select jsonb_array_length(public.kandid_get_student_ballot_candidates(4))'),'1');
  assert.match(sql(actor(103)+'select public.kandid_get_student_ballot_candidates(4);',false).stderr,/42501.*Ballot choices are unavailable/);
  assert.equal(service('select public.kandid_is_locked_electorate_member(4,2)'),'t');
  assert.equal(service('select public.kandid_is_locked_electorate_member(4,3)'),'f');
 });
 check('multiple saved rules are ORed within verified organization membership',()=>{
  assert.equal(last(sql(`begin;insert into public.eligibility_rules(election_id,program,min_year_level,max_year_level,allow_shs) values(3,'BSCS',1,4,false);select ${predicate}(3,3);rollback;`)),'t');
 });
 check('SHS requires explicit inclusion when rules exist; no-rules membership default has no hidden SHS exclusion',()=>{
  assert.equal(last(sql(`select ${predicate}(3,12);`)),'f');
  assert.equal(last(sql(`begin;update public.eligibility_rules set allow_shs=true where election_id=3;select ${predicate}(3,12);rollback;`)),'t');
 });
 check('inactive or ambiguous active terms fail closed',()=>{
  for(const change of ["update public.academic_terms set status='archived' where id=1","update public.academic_terms set status='active' where id=2"])assert.equal(last(sql(`begin;${change};select ${predicate}(3,1);rollback;`)),'f');
 });
 check('unfrozen voting-window candidate access still raises 42501',()=>{
  assert.match(sql(`begin;update public.elections set start_date=timezone('Asia/Manila',now())-interval '1 hour' where id=3;set local role authenticated;select set_config('request.jwt.claim.sub','${uid(101)}',true);select public.kandid_get_student_ballot_candidates(3);`,false).stderr,/42501.*Ballot choices are unavailable/);
 });
 check('the internal predicate adds no anonymous, authenticated or service-role identity endpoint',()=>{
  for(const role of ['anon','authenticated','service_role'])assert.equal(last(sql(`select has_function_privilege('${role}','${predicate}(integer,integer)','EXECUTE');`)),'f');
 });
 check('existing finalization transaction can snapshot the membership default with zero rules',()=>{
  sql('delete from public.eligibility_rules where election_id=3;');
  assert.equal(JSON.parse(board('select public.kandid_lock_board_electorate(3)')).eligible_voters,6);
  assert.equal(last(sql('select count(*) from private.election_eligible_voters where election_id=3;')),'6');
  assert.equal(last(sql('select count(*) from public.audit_logs where election_id=3;')),'1');
 });
 check('finalized snapshots remain immutable and candidate cards remain time-gated',()=>{
  assert.match(sql('delete from private.election_eligible_voters where election_id=3;',false).stderr,/locked electorate/);
  assert.equal(student(1,'select jsonb_array_length(public.kandid_get_student_ballot_candidates(3))'),'0');
 });
 // Move only the synthetic test clock window after the immutability assertion.
 sql("alter table public.elections disable trigger elections_guard_frozen_electorate;update public.elections set start_date=timezone('Asia/Manila',now())-interval '1 hour' where id=3;alter table public.elections enable trigger elections_guard_frozen_electorate;");
 check('eligible members across programs receive candidates when no additional rules exist',()=>{
  for(const id of [1,2,3,4,12,13]){assert.equal(student(id,'select jsonb_array_length(public.kandid_get_student_ballot_candidates(3))'),'2');assert.equal(service(`select public.kandid_is_locked_electorate_member(3,${id})`),'t');}
 });
 check('a newly enrolled verified member cannot join an already frozen electorate',()=>{
  sql(`insert into public.students(id,auth_user_id,status,program,year_level,is_shs,first_name,last_name) values(17,'${uid(117)}','active','BSIT',2,false,'Synthetic','Late member');insert into public.student_term_enrollments values(17,1,'enrolled','BSIT',2,false);insert into public.student_organization_terms values(17,2,1,'active','system');`);
  assert.equal(last(sql(`select ${predicate}(3,17);`)),'t');
  assert.match(sql(actor(117)+'select public.kandid_get_student_ballot_candidates(3);',false).stderr,/42501.*Ballot choices are unavailable/);
  assert.equal(service('select public.kandid_is_locked_electorate_member(3,17)'),'f');
  assert.equal(last(sql('select count(*) from private.election_eligible_voters where election_id=3;')),'6');
 });
 check('revoked membership denies candidate access and trusted membership without rewriting the snapshot',()=>{
  assert.match(sql(`begin;update public.student_organization_terms set status='removed' where student_id=1;set local role authenticated;select set_config('request.jwt.claim.sub','${uid(101)}',true);select public.kandid_get_student_ballot_candidates(3);`,false).stderr,/Ballot choices are unavailable/);
  assert.equal(last(sql('select count(*) from private.election_eligible_voters where election_id=3;')),'6');
 });
 check('expired and closed elections do not expose candidates regardless of rule count',()=>{
  assert.match(sql(`begin;update public.elections set status='closed' where id=3;set local role authenticated;select set_config('request.jwt.claim.sub','${uid(101)}',true);select public.kandid_get_student_ballot_candidates(3);`,false).stderr,/Ballot choices are unavailable/);
  sql("alter table public.elections disable trigger elections_guard_frozen_electorate;update public.elections set end_date=timezone('Asia/Manila',now())-interval '1 minute' where id=3;alter table public.elections enable trigger elections_guard_frozen_electorate;");
  assert.equal(student(1,'select jsonb_array_length(public.kandid_get_student_ballot_candidates(3))'),'0');
 });
 const result={status:'PASS',checks:checks.length,details:checks,scope:'Proposed canonical eligibility and experimental local RPC adapters; not the scheduled worker',postgres:17,productionConnected:false};
 writeFileSync(resolve(evidence,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{assert.match(database,/^kandid_optional_[a-f0-9]{12}$/);const drop=docker(['exec',container,'dropdb','-U','postgres','--force',database]);assert.equal(drop.status,0,drop.stderr);console.log('Removed disposable local optional-eligibility database.');}
