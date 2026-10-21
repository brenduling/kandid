// Synthetic data only, in a new database inside the verified LOCAL test container.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
const container='supabase_db_kandid-board-e2e-20261016-8c19';
const db='kandid_live_eligibility_'+randomBytes(6).toString('hex');
const docker=(args,input)=>spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
const inspection=docker(['inspect',container]);assert.equal(inspection.status,0,inspection.stderr);
const info=JSON.parse(inspection.stdout)[0];
assert.equal(info.Config.Labels['com.supabase.cli.project'],'kandid-board-e2e-20261016-8c19');
assert.equal(info.HostConfig.PortBindings['5432/tcp'][0].HostPort,'59322');
assert.match(db,/^kandid_live_eligibility_[a-f0-9]{12}$/);
assert.equal(docker(['exec',container,'createdb','-U','postgres','--template=template0',db]).status,0);
const args=['exec','-i',container,'psql','-X','-q','-At','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'];
function sql(input,ok=true){const r=docker(args,input);if(ok)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0,'Expected denial');return r;}
const value=q=>sql(q).stdout.trim().split('\n').at(-1);
const fixture=JSON.parse(readFileSync('tests/fixtures/automaticVoterEligibilityProductionContract.json','utf8'));
const old=JSON.parse(readFileSync('tests/fixtures/submitVoteIntegrityProductionContract.json','utf8'));
const definition=name=>fixture.functions.find(f=>f.definition.includes('FUNCTION '+name+'(')).definition;
const forward=readFileSync('supabase/proposals/automatic-voter-eligibility.sql','utf8');
const rollback=readFileSync('supabase/proposals/automatic-voter-eligibility.rollback.sql','utf8');
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const user=(n,q)=>`begin;set local role authenticated;set local request.jwt.claim.sub='${uid(n)}';${q}commit;`;
const service=q=>`begin;set local role service_role;${q}commit;`;
const ballot=(n,rows=[{position_id:11,candidate_id:201,is_abstain:false},{position_id:12,candidate_id:null,is_abstain:true}])=>`select * from public.insert_v2_vote_rows(${n},5,'${JSON.stringify(rows)}'::jsonb);`;
const access=n=>value(user(n,'select public.kandid_check_student_ballot_eligibility(5);'));
const counts=()=>value('select jsonb_build_array((select count(*) from public.vote_ballots),(select count(*) from public.votes));');
let passed=0;
const check=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
function parallel(query){return new Promise((resolve,reject)=>{const p=spawn('docker',args,{windowsHide:true});let stdout='',stderr='';p.stdout.on('data',c=>stdout+=c);p.stderr.on('data',c=>stderr+=c);p.on('error',reject);p.on('close',status=>resolve({status,stdout,stderr}));p.stdin.end(query);});}
try{
  sql(`create schema private;create schema auth;create schema extensions;create extension pgcrypto with schema extensions;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false,banned_until timestamptz);
    create table public.students(id integer primary key,auth_user_id uuid,status text,first_name text,last_name text,photo_url text);
    create table public.academic_terms(id integer primary key,status text,semester text,academic_year text);
    create table public.organizations(id integer primary key,membership_scope text,organization_type text,name text);
    create table public.admin_users(id integer primary key,auth_user_id uuid,role text,status text,organization_id integer);
    create table public.elections(id integer primary key,organization_id integer,academic_term_id integer,title text,status text,
      campaign_start timestamp,campaign_end timestamp,start_date timestamp,end_date timestamp,removed_at timestamptz,
      results_released_at timestamptz,electorate_policy_version integer,electorate_frozen_at timestamptz,electorate_frozen_by integer);
    create table public.student_term_enrollments(student_id integer,academic_term_id integer,program text,year_level integer,is_shs boolean,enrollment_status text,primary key(student_id,academic_term_id));
    create table public.student_organization_terms(student_id integer,organization_id integer,academic_term_id integer,status text,source text,primary key(student_id,organization_id,academic_term_id));
    create table public.eligibility_rules(id serial primary key,election_id integer,program text,min_year_level integer,max_year_level integer,allow_shs boolean);
    create table public.positions(id integer primary key,election_id integer,name text,status text,max_votes integer,display_order integer);
    create table public.partylists(id integer primary key,organization_id integer,election_id integer,name text,logo_url text);
    create table public.candidates(id integer primary key,position_id integer,student_id integer,partylist_id integer,photo text,campaign_status text);
    create table private.election_eligible_voters(election_id integer,student_id integer,primary key(election_id,student_id));
    create sequence public.votes_id_seq;`);
  for(const t of old.tables)sql(`create table public.${t.table} (${t.columns.map(c=>`"${c.name}" ${c.type}${c.default?' default '+c.default:''}${c.not_null?' not null':''}`).join(',')});`);
  for(const c of old.constraints)sql(`alter table public.${c.table} add constraint "${c.name}" ${c.definition};`);
  // Historical snapshot is synthetic and seeded before its immutable guards.
  sql(`insert into public.elections(id,organization_id,academic_term_id,status,start_date,end_date,electorate_policy_version,electorate_frozen_at,electorate_frozen_by)
    values(6,2,1,'active',timezone('Asia/Manila',now())-interval '1 hour',timezone('Asia/Manila',now())+interval '1 hour',1,now(),1);
    insert into private.election_eligible_voters values(6,1);`);
  for(const f of fixture.functions)sql(f.definition+';');
  sql(fixture.participation+';');
  sql(`create trigger vote_ballots_require_locked_electorate before insert on public.vote_ballots for each row execute function private.kandid_require_locked_electorate_for_ballot();
    create trigger preserve_snapshot before update or delete on private.election_eligible_voters for each row execute function private.kandid_guard_frozen_electorate_member();
    create trigger preserve_frozen_election before insert or update on public.elections for each row execute function private.kandid_guard_frozen_electorate();
    revoke all on function public.insert_v2_vote_rows(integer,integer,jsonb) from public,anon,authenticated,service_role;
    grant execute on function public.insert_v2_vote_rows(integer,integer,jsonb) to service_role;
    revoke all on function public.kandid_get_student_ballot_candidates(integer),public.kandid_get_board_electorate_preview(integer) from public,anon,authenticated,service_role;
    grant execute on function public.kandid_get_student_ballot_candidates(integer),public.kandid_get_board_electorate_preview(integer) to authenticated;
    alter table public.students enable row level security;
    alter table public.votes enable row level security;alter table public.vote_ballots enable row level security;
    revoke all on public.students,public.votes,public.vote_ballots,public.candidates from public,anon,authenticated;
    insert into public.academic_terms values(1,'active','first','2026');
    insert into public.organizations values(2,'institution','non_departmental','Synthetic'),(3,'manual','non_departmental','Other');
    insert into public.elections values(5,2,1,'Synthetic','active',null,null,timezone('Asia/Manila',now())-interval '1 hour',timezone('Asia/Manila',now())+interval '1 hour',null,null,1,null,null);
    insert into public.positions values(11,5,'Chairman','active',1,1),(12,5,'President','active',1,2),(13,5,'Retired','retired',1,3);
    insert into public.students select n,('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'active','Synthetic','Student',null from generate_series(1,20) n;
    insert into auth.users select auth_user_id,now(),null,false,null from public.students;
    insert into public.student_term_enrollments select id,1,'BSIT',1,false,'enrolled' from public.students;
    insert into public.student_organization_terms select id,2,1,'active','masterlist' from public.students;
    insert into public.candidates values(201,11,20,null,null,'draft'),(202,13,19,null,null,'published');
    insert into public.admin_users values(1,'${uid(101)}','electoral_board','active',2),(2,'${uid(102)}','electoral_board','active',3);`);
  check('reproduces deployed unfrozen candidate 42501',()=>assert.match(sql(user(1,'select public.kandid_get_student_ballot_candidates(5);'),false).stderr,/Ballot choices are unavailable/));
  const baselineCounts=counts();sql(forward);
  check('forward installs atomically without record changes',()=>assert.equal(counts(),baselineCounts));
  check('replay fails closed without partial installation',()=>assert.match(sql(forward,false).stderr,/baseline differs/));
  check('eligible Year 1 without rules or snapshot can see registered Chairman candidates',()=>{
    assert.equal(access(1),'t');
    const data=JSON.parse(value(user(1,'select public.kandid_get_student_ballot_candidates(5);')));
    assert.equal(data.length,1);assert.equal(data[0].id,201);
    assert.equal(value('select count(*) from private.election_eligible_voters where election_id=5;'),'0');
  });
  check('preview uses same eligibility definition and is Board organization scoped',()=>{
    const p=JSON.parse(value(user(101,'select public.kandid_get_board_electorate_preview(5);')));
    assert.equal(p.eligible_voters,20);assert.equal(p.lock_required,false);
    for(const id of [1,102])assert.match(sql(user(id,'select public.kandid_get_board_electorate_preview(5);'),false).stderr,/required|unavailable/);
  });
  check('unknown, anonymous and ordinary admin identities cannot read candidates',()=>{
    for(const n of [999,101])assert.match(sql(user(n,'select public.kandid_get_student_ballot_candidates(5);'),false).stderr,/unavailable/);
    assert.match(sql('set role anon;select public.kandid_get_student_ballot_candidates(5);',false).stderr,/permission denied/);
  });
  check('browser roles cannot call atomic insertion, private predicate or directly read candidates',()=>{
    for(const role of ['anon','authenticated'])for(const q of [ballot(1),'select private.kandid_student_is_live_eligible(5,1);','select * from public.candidates;'])assert.match(sql(`set role ${role};${q}`,false).stderr,/permission denied/);
  });
  check('historical snapshots and locked election schedules remain immutable',()=>{
    assert.equal(value('select count(*) from private.election_eligible_voters where election_id=6;'),'1');
    assert.match(sql('delete from private.election_eligible_voters where election_id=6;',false).stderr,/locked electorate cannot be changed/);
    assert.match(sql("update public.elections set end_date=end_date+interval '1 hour' where id=6;",false).stderr,/immutable/);
    assert.match(sql('insert into public.eligibility_rules(election_id) values(6);',false).stderr,/immutable/);
  });
  for(const [name,change] of [
    ['pending identity',"update public.students set status='pending' where id=1"],
    ['disabled identity',"update public.students set status='disabled' where id=1"],
    ['unverified email',"update auth.users set email_confirmed_at=null where id='"+uid(1)+"'"],
    ['anonymous Auth',"update auth.users set is_anonymous=true where id='"+uid(1)+"'"],
    ['banned Auth',"update auth.users set banned_until=now()+interval '1 day' where id='"+uid(1)+"'"],
    ['missing enrollment','delete from public.student_term_enrollments where student_id=1'],
    ['inactive enrollment',"update public.student_term_enrollments set enrollment_status='not_in_masterlist' where student_id=1"],
    ['removed membership',"update public.student_organization_terms set status='removed' where student_id=1"],
    ['wrong organization','update public.student_organization_terms set organization_id=3 where student_id=1'],
    ['wrong election term','update public.elections set academic_term_id=2 where id=5'],
    ['ambiguous active term',"insert into public.academic_terms values(2,'active',null,null)"],
    ['duplicate identity',"insert into public.students values(99,'"+uid(1)+"','active',null,null,null)"],
  ])check(name+' denied for access and atomic insert',()=>{
    assert.equal(value(`begin;${change};set local role authenticated;set local request.jwt.claim.sub='${uid(1)}';select public.kandid_check_student_ballot_eligibility(5);rollback;`),'f');
    assert.match(sql(`begin;${change};set local role service_role;${ballot(1)}commit;`,false).stderr,/not eligible/);assert.equal(counts(),baselineCounts);
  });
  for(const [name,change] of [
    ['done',"update public.elections set status='done' where id=5"],
    ['closed',"update public.elections set status='closed' where id=5"],
    ['removed',"update public.elections set removed_at=now() where id=5"],
    ['not started',"update public.elections set start_date=timezone('Asia/Manila',now())+interval '10 minutes' where id=5"],
    ['expired',"update public.elections set end_date=timezone('Asia/Manila',now()) where id=5"],
    ['campaign still running',"update public.elections set campaign_start=timezone('Asia/Manila',now())-interval '1 hour',campaign_end=timezone('Asia/Manila',now())+interval '1 minute' where id=5"],
  ])check(name+' cannot vote despite active-looking metadata',()=>assert.match(sql(`begin;${change};set local role service_role;${ballot(1)}commit;`,false).stderr,/not eligible/));
  check('optional rules restrict program and year using term enrollment',()=>{
    sql("insert into public.eligibility_rules(election_id,program,min_year_level,max_year_level,allow_shs) values(5,'BSIT',2,4,false);");
    assert.equal(access(1),'f');
    sql("update public.student_term_enrollments set year_level=2 where student_id=1;");assert.equal(access(1),'t');
    sql("update public.student_term_enrollments set program='BSCS' where student_id=1;");assert.equal(access(1),'f');
    sql("update public.student_term_enrollments set program='BSIT',year_level=1 where student_id=1;update public.eligibility_rules set min_year_level=1;");assert.equal(access(1),'t');
  });
  check('SHS excluded unless an applicable rule explicitly includes SHS',()=>{
    sql('update public.student_term_enrollments set is_shs=true where student_id=1;');assert.equal(access(1),'f');
    sql('update public.eligibility_rules set allow_shs=true;');assert.equal(access(1),'t');
    sql('update public.student_term_enrollments set is_shs=false where student_id=1;delete from public.eligibility_rules;');
  });
  check('multiple optional rules use OR, null bounds remain open, and late enrollment needs no freeze',()=>{
    sql("insert into public.eligibility_rules(election_id,program,min_year_level,max_year_level,allow_shs) values(5,'BSCS',null,null,false),(5,'BSIT',null,4,false);");
    assert.equal(access(1),'t');
    sql('delete from public.eligibility_rules;delete from public.student_organization_terms where student_id=4;');assert.equal(access(4),'f');
    sql("insert into public.student_organization_terms values(4,2,1,'active','manual');");assert.equal(access(4),'t');
  });
  for(const [name,rows] of [
    ['inactive position',[{position_id:13,candidate_id:202,is_abstain:false}]],
    ['missing position',[{position_id:11,candidate_id:201,is_abstain:false}]],
    ['foreign candidate',[{position_id:11,candidate_id:202,is_abstain:false},{position_id:12,candidate_id:null,is_abstain:true}]],
    ['abstain mixed with candidate',[{position_id:11,candidate_id:201,is_abstain:false},{position_id:11,candidate_id:null,is_abstain:true},{position_id:12,candidate_id:null,is_abstain:true}]],
    ['duplicate selection',[{position_id:11,candidate_id:201,is_abstain:false},{position_id:11,candidate_id:201,is_abstain:false},{position_id:12,candidate_id:null,is_abstain:true}]],
  ])check(name+' rejected atomically',()=>{sql(service(ballot(1,rows)),false);assert.equal(counts(),baselineCounts);});
  check('candidate plus abstain commits one Ballot V1 with unchanged grouped hash scheme',()=>{
    sql(service(ballot(1)));assert.equal(counts(),'[1, 2]');
    assert.equal(value("select bool_and(hash_version='KANDID_VOTE_V2' and blockchain_anchor_status='ballot_grouped') from public.votes;"),'t');
    assert.equal(value("select hash_version||':'||blockchain_anchor_status from public.vote_ballots;"),'KANDID_BALLOT_V1:pending');
    const b=JSON.parse(value('select to_jsonb(b) from public.vote_ballots b;'));
    const rows=JSON.parse(value('select jsonb_agg(to_jsonb(v) order by p.display_order,v.position_id,v.is_abstain,v.candidate_id nulls last,v.id) from public.votes v join public.positions p on p.id=v.position_id;'));
    const h=s=>'0x'+createHash('sha256').update(s).digest('hex');
    for(const r of rows)assert.equal(r.vote_hash,h(`KANDID_VOTE_V2|vote_id:${r.id}|election_id:5|position_id:${r.position_id}|candidate_id:${r.candidate_id??'null'}|abstain:${r.is_abstain?1:0}|submitted_at:${r.canonical_vote_timestamp}|nonce:${r.vote_nonce}`));
    assert.equal(b.ballot_hash,h(`KANDID_BALLOT_V1|ballot_id:${b.id}|election_id:5|submitted_at:${b.canonical_submitted_at}|ballot_nonce:${b.ballot_nonce}|row_count:2|row_hashes:\n${rows.map(r=>r.vote_hash).join('\n')}`));
  });
  check('duplicate ballot rejected and rule edits cannot change eligibility after voting',()=>{
    assert.match(sql(service(ballot(1)),false).stderr,/already voted/);
    assert.match(sql("insert into public.eligibility_rules(election_id) values(5);",false).stderr,/immutable/);
    assert.equal(counts(),'[1, 2]');
  });
  const both=await Promise.all([parallel(service(ballot(2))),parallel(service(ballot(2)))]);
  check('concurrent duplicates commit one complete ballot',()=>{assert.equal(both.filter(r=>r.status===0).length,1);assert.match(both.find(r=>r.status!==0).stderr,/already voted/);assert.equal(counts(),'[2, 4]');});
  check('all-abstain ballot remains valid',()=>{sql(service(ballot(3,[{position_id:11,candidate_id:null,is_abstain:true},{position_id:12,candidate_id:null,is_abstain:true}])));assert.equal(counts(),'[3, 6]');});
  check('rollback restores exact source without deleting successful ballots',()=>{
    const before=counts();sql(rollback);assert.equal(counts(),before);
    for(const n of ['public.insert_v2_vote_rows','public.kandid_get_student_ballot_candidates','private.kandid_require_locked_electorate_for_ballot','public.kandid_get_board_electorate_preview']){
      const expected=createHash('md5').update(definition(n)).digest('hex');
      const f=fixture.functions.find(f=>f.definition.includes('FUNCTION '+n+'(')).definition;
      const signature=n+'('+ (n.includes('insert_v2')?'integer,integer,jsonb':n.includes('require_locked')?'':'integer')+')';
      assert.ok(f);assert.equal(value(`select md5(pg_get_functiondef('${signature}'::regprocedure));`),expected);
    }
  });
  console.log(`${passed} PostgreSQL 17 checks passed. Production connections: zero.`);
}finally{
  assert.match(db,/^kandid_live_eligibility_[a-f0-9]{12}$/);
  assert.equal(docker(['exec',container,'dropdb','-U','postgres','--force',db]).status,0);
}
