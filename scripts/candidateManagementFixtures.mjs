import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

export function prepareCandidateFixtures(sql,root){
 const {catalog}=JSON.parse(readFileSync(resolve(root,'deploy/candidate-management-review/production-catalog.json'),'utf8'));
 // Reproduce only the inspected production candidate functions/policies/grants
 // in this fresh disposable database. Never alter the source scratch database.
 for(const t of catalog.triggers.filter(t=>t.table==='candidates')){
  sql(t.source,'supabase_admin');
  sql(`alter function ${t.function.includes('.')?t.function:'public.'+t.function} owner to postgres;`,'supabase_admin');
 }
 const quote=x=>'"'+x.replaceAll('"','""')+'"';
 sql("do $$ declare p record;begin for p in select policyname from pg_policies where schemaname='public' and tablename='candidates' loop execute format('drop policy %I on public.candidates',p.policyname);end loop;end $$;");
 for(const p of catalog.policies.filter(p=>p.tablename==='candidates'))sql(`create policy ${quote(p.policyname)} on public.candidates for ${p.cmd} to ${p.roles.map(quote).join(',')} ${p.qual?'using ('+p.qual+')':''} ${p.with_check?'with check ('+p.with_check+')':''};`);
 sql('revoke all on public.candidates from public,anon,authenticated;');
 for(const role of ['anon','authenticated'])for(const privilege of ['SELECT','INSERT','UPDATE','REFERENCES']){
  const columns=catalog.column_grants.filter(x=>x.table_name==='candidates'&&x.grantee===role&&x.privilege_type===privilege).map(x=>quote(x.column_name));
  if(columns.length)sql(`grant ${privilege} (${columns.join(',')}) on public.candidates to ${quote(role)};`);
 }
 sql('grant delete on public.candidates to authenticated;');
 sql(`begin;set local session_replication_role=replica;
 insert into public.programs(id,code,name) values(981,'BSIT','Synthetic BSIT'),(982,'BSHM','Synthetic BSHM');
 insert into public.organization_programs(organization_id,program_id) values(901,981),(902,982);
 insert into public.academic_terms(id,academic_year,semester,status,activated_at,closed_at) values(903,'2098-2099','2nd Semester','closed',now()-interval '30 days',now()-interval '1 day');
 insert into public.elections(id,organization_id,title,status,academic_term_id) values(91205,901,'Synthetic Own Term Election','draft',903);
 insert into public.positions(id,election_id,name,max_votes,display_order,status) values
 (91201,91201,'Synthetic President',1,1,'active'),(91202,91201,'Synthetic Vice President',1,2,'active'),(91203,91201,'Synthetic Retired Position',1,3,'retired'),
 (91211,91202,'Synthetic Foreign Position',1,1,'active'),(91221,91203,'Synthetic Closed Position',1,1,'active'),(91231,91204,'Synthetic Removed Position',1,1,'active'),(91241,91205,'Synthetic Other Term Position',1,1,'active');
 insert into public.partylists(id,election_id,organization_id,name) values(91201,91201,901,'Synthetic Candidate Party'),(91202,91202,902,'Synthetic Foreign Party'),(91203,91205,901,'Synthetic Other Election Party'),(91204,null,901,'Synthetic Reusable Party');
 insert into public.students(id,student_number,first_name,last_name,status,program,year_level)
 select n,'SYNTHETIC-'||n,'Synthetic '||n,'Candidate','active','BSIT','4' from generate_series(921,945) n;
 insert into public.students(id,student_number,first_name,last_name,status,program,year_level) values(951,'SYNTHETIC-951','Foreign','Candidate','active','BSHM','4'),(952,'SYNTHETIC-952','Not Enrolled','Candidate','active','BSIT','4'),(960,'SYNTHETIC-960','Other Term','Candidate','active','BSIT','4');
 insert into public.student_term_enrollments(student_id,academic_term_id,program,year_level,enrollment_status)
 select id,901,program,year_level,'enrolled' from public.students where id between 921 and 951;
 insert into public.student_term_enrollments(student_id,academic_term_id,program,year_level,enrollment_status) values(960,903,'BSIT','4','enrolled');
 insert into public.student_organization_terms(student_id,organization_id,academic_term_id,status,source)
 select id,901,901,'active','program_sync' from public.students where id between 921 and 945;
 insert into public.student_organization_terms(student_id,organization_id,academic_term_id,status,source) values(951,902,901,'active','program_sync'),(960,901,903,'active','program_sync');
 commit;`,'supabase_admin');
 const proof=sql(`begin;set local role authenticated;select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
 insert into public.candidates(position_id,student_id,partylist_id) values(91201,921,91202);select count(*) from public.candidates where position_id=91201;rollback;`);
 assert.match(proof,/1/,'Inspected predecessor reproduces foreign-partylist acceptance before the new guard');
 console.log('CONFIRMED PREDECESSOR DEFECT: foreign-partylist INSERT accepted only inside a rolled-back synthetic transaction');
 sql(readFileSync(resolve(root,'supabase/migrations/20261018124015_position_name_per_election_unique.sql'),'utf8'));
 sql(readFileSync(resolve(root,'deploy/candidate-management-review/PREFLIGHT.sql'),'utf8'));
 const candidateMigration=readFileSync(resolve(root,'supabase/migrations/20261021130000_candidate_management_scope_and_history_guard.sql'),'utf8');
 sql(candidateMigration);
 const postflight=sql(readFileSync(resolve(root,'deploy/candidate-management-review/POSTFLIGHT.sql'),'utf8'));
 writeFileSync(resolve(root,'deploy/candidate-management-review/evidence/migration-installation.json'),JSON.stringify({database:sql('select current_database();'),sha256:createHash('sha256').update(candidateMigration).digest('hex').toUpperCase(),completeFileExecuted:true,postflight},null,2));
 console.log('CANDIDATE_AND_POSITION_MIGRATIONS_INSTALLED_ONLY_IN_FRESH_SCRATCH');
}
