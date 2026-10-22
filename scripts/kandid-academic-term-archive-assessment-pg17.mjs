// Isolated archive-classification assessment. No network, env-file or production connection.
// Fixture construction reuses the captured FK contracts and preservation bodies.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync,spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {getAcademicTermTransitionView} from '../src/utils/academicTermTransitionPresentation.js';
assert.equal(process.argv.length,2,'No connection arguments accepted');
const container='supabase_db_kandid-board-e2e-20261016-8c19';
const prefix='kandid_term_archive_';
const run=(args,input)=>spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,maxBuffer:12*1024*1024});
const inspection=run(['inspect',container]);assert.equal(inspection.status,0,'Verified local Docker container required');
const info=JSON.parse(inspection.stdout)[0];
assert.equal(info.Config.Labels['com.supabase.cli.project'],'kandid-board-e2e-20261016-8c19');
assert.equal(info.HostConfig.PortBindings['5432/tcp'][0].HostPort,'59322');
assert.match(info.Config.Image,/supabase\/postgres:17\./);
const root='.tmp/academic-term-cleanup-investigation/';
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const catalog=json(root+'catalog.json').rows[0].catalog;
const inventory=json(root+'inventory.json').rows;
const evidence=json(root+'evidence.json').rows[0].evidence;
const literal=v=>v===null?'null':typeof v==='number'||typeof v==='boolean'?String(v):"'"+(typeof v==='object'?JSON.stringify(v):String(v)).replaceAll("'","''")+"'";
const ident=v=>{assert.match(v,/^[a-z_][a-z_0-9]*$/);return '"'+v+'"';};
const relation=v=>v.split('.').map(ident).join('.');
const checks=[];
const check=(name,fn)=>{fn();checks.push(name);console.log('PASS '+name);};
const readFunction=(path,name)=>{
  const escaped=name.replaceAll('.','\\.');
  const match=readFileSync(path,'utf8').match(new RegExp('create(?: or replace)? function '+escaped+'\\([\\s\\S]*?\\$function\\$;','i'));
  assert.ok(match,'Actual repository function found: '+name);return match[0];
};
const databases=[];
function fixture(withTarget){
  const db=prefix+randomBytes(6).toString('hex');assert.match(db,/^kandid_term_archive_[0-9a-f]{12}$/);
  assert.equal(run(['exec',container,'createdb','-U','postgres','--template=template0',db]).status,0);databases.push(db);
  const args=['exec','-i',container,'psql','-X','-q','-At','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
  const sql=(text,ok=true)=>{const r=run(args,text);if(ok)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0,'Expected safe refusal');return r;};
  const value=text=>sql(text).stdout.trim().split('\n').at(-1);
  const tables=catalog.relations.filter(t=>['r','p'].includes(t.kind));
  let setup="create schema private;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;";
  for(const t of tables){const columns=catalog.columns.filter(c=>c.schema===t.schema&&c.table===t.table);setup+=`create table ${relation(t.schema+'.'+t.table)}(${columns.map(c=>`${ident(c.column)} ${c.type}`).join(',')});`;}
  // Keep actual primary/unique/FK definitions; nullable fixture fields and
  // omitted unrelated auth/RLS/business triggers are explicitly not certified.
  for(const kind of ['p','u','f'])for(const c of catalog.constraints.filter(c=>c.type===kind)) setup+=`alter table ${relation(c.schema+'.'+c.table)} add constraint ${ident(c.name)} ${c.definition};`;
  setup+="create unique index fixture_single_active_term on public.academic_terms((status)) where status='active';create sequence public.academic_terms_id_seq start 100;alter table public.academic_terms alter column id set default nextval('public.academic_terms_id_seq');create sequence public.audit_logs_id_seq start 1000;alter table public.audit_logs alter column id set default nextval('public.audit_logs_id_seq');";
  sql(setup);
  let seed='';
  const insert=(table,row)=>{
    const columns=catalog.columns.filter(c=>c.schema+'.'+c.table===table).map(c=>c.column);
    const entries=Object.entries(row).filter(([k])=>columns.includes(k));
    seed+=`insert into ${relation(table)}(${entries.map(([k])=>ident(k)).join(',')}) values(${entries.map(([,v])=>literal(v)).join(',')});`;
  };
  for(const t of catalog.terms.filter(t=>withTarget||t.id!==2))insert('public.academic_terms',t);
  insert('public.organizations',{id:1,name:'Synthetic retained organization',organization_type:'non_departmental',membership_scope:'manual'});
  for(const o of evidence.shared_organizations)insert('public.organizations',{id:o.id,name:o.name,organization_type:'departmental',membership_scope:o.membership_scope});
  const studentIds=[1,34,35,36,1000,1001,1002,1003,1004,1005];
  for(const id of studentIds)insert('public.students',{id,student_number:'fixture-'+id,first_name:'Synthetic',last_name:'Fixture',email:'fixture-'+id+'@example.invalid',password:'synthetic-not-a-real-password',status:[34,35,36].includes(id)?'pending':'active',program:'BSIT',year_level:1});
  for(const e of evidence.other_elections)insert('public.elections',e);
  const order=['public.elections','public.positions','public.partylists','public.candidates','public.vote_ballots','public.votes','private.election_eligible_voters','private.ballot_anchor_exclusions','public.masterlist_imports','public.masterlist_import_rows','public.student_term_enrollments','public.student_organization_terms'];
  if(withTarget)for(const table of order)for(const record of inventory.find(r=>r.relation===table).records)insert(table,record);
  for(const a of evidence.all_anchor_evidence.filter(a=>a.relation==='vote_ballots'&&a.election_id!==2))insert('public.vote_ballots',{id:a.id,student_id:1000,election_id:a.election_id,ballot_hash:a.hash,hash_version:'KANDID_BALLOT_V1',blockchain_anchor_status:a.anchor_status,blockchain_tx_id:a.tx_id,blockchain_network:a.network,blockchain_contract_address:a.registry,blockchain_block_number:a.block});
  for(const a of evidence.all_exclusion_keys.filter(a=>a.election_id!==2))insert('private.ballot_anchor_exclusions',{...a,reason:'Synthetic representation of retained preservation evidence'});
  for(const a of evidence.all_anchor_evidence.filter(a=>a.relation==='votes'&&a.election_id!==2)){
    const pid=1000+Number(a.id);insert('public.positions',{id:pid,election_id:a.election_id,name:'Synthetic retained position',display_order:pid});
    insert('public.votes',{id:a.id,student_id:1000,election_id:a.election_id,position_id:pid,is_abstain:true,vote_hash:a.hash,hash_version:'KANDID_VOTE_V2',blockchain_anchor_status:a.anchor_status,
      ballot_id:evidence.all_anchor_evidence.find(b=>b.relation==='vote_ballots'&&b.election_id===a.election_id).id});
  }
  for(const [id,election] of [[8,3],[13,4]]){insert('public.positions',{id:2000+id,election_id:election,name:'Synthetic shared candidacy',display_order:id});insert('public.candidates',{id,student_id:1,position_id:2000+id});}
  for(const id of [1,...studentIds.filter(id=>id>=1000)])insert('public.student_term_enrollments',{id:id===1?1:1000+id,student_id:id,academic_term_id:1,program:'BSIT',year_level:1,enrollment_status:'enrolled',source:'fixture'});
  let membershipId=22;
  insert('public.student_organization_terms',{id:9,student_id:1,organization_id:2,academic_term_id:1,status:'active',source:'system'});
  insert('public.student_organization_terms',{id:10,student_id:1,organization_id:3,academic_term_id:1,status:'active',source:'system'});
  insert('public.student_organization_terms',{id:21,student_id:1,organization_id:1,academic_term_id:1,status:'active',source:'manual'});
  for(const id of studentIds.filter(id=>id>=1000))for(const org of [2,3])insert('public.student_organization_terms',{id:membershipId++,student_id:id,organization_id:org,academic_term_id:1,status:'active',source:'system'});
  const structural=[[1,1,2],[2,1,3],[30,1,1],[3,34,2],[4,34,3],[6,35,2],[7,35,3],[10,36,2],[11,36,3]];
  let linkId=100;for(const id of studentIds.filter(id=>id>=1000))for(const org of [1,2,3])structural.push([linkId++,id,org]);
  for(const [id,student_id,organization_id] of structural)insert('public.student_organizations',{id,student_id,organization_id,role:'member'});
  if(withTarget)for(const a of inventory.find(r=>r.relation==='public.audit_logs').records)insert('public.audit_logs',{...a,metadata:a.election_id?{changed_fields:[]}:{academic_term_id:2}});
  for(const a of evidence.other_related_audits.filter(a=>[2,32].includes(a.id)))insert('public.audit_logs',{...a,metadata:{academic_term_id:1}});
  const uid='00000000-0000-4000-8000-000000000501';
  seed+=`insert into auth.users(id) values('${uid}');`;
  insert('public.admin_users',{id:1,auth_user_id:uid,full_name:'Synthetic Super Admin',role:'super_admin',status:'active'});
  sql(seed);
  let guards=evidence.protection_functions.map(f=>f.definition+';').join('\n');
  guards+=catalog.triggers.filter(t=>t.name.startsWith('kandid_preserve_')).map(t=>t.definition+';').join('\n');
  sql(guards);
  const digest=()=>value(`select md5(jsonb_build_array(${tables.map(t=>`(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${relation(t.schema+'.'+t.table)} t)`).join(',')},(select jsonb_agg(to_jsonb(u) order by id) from auth.users u))::text);`);
  return {db,args,sql,value,digest,uid};
}

const proposal=readFileSync('supabase/proposals/academic-term-archived-test.prototype.sql','utf8');
const transitionSource='supabase/proposals/academic-term-transitions.sql';
const membershipSource='supabase/migrations/20261003130000_term_scoped_membership_activation_sync.sql';
const latestMembershipSource='supabase/migrations/20261021120000_board_verified_student_registration.sql';
const actor='00000000-0000-4000-8000-000000000501';
const reason='Owner-confirmed historical test semester; all protected evidence retained.';
const service=q=>'begin;set local role service_role;'+q+'commit;';
const create=q=>`select public.kandid_create_next_academic_term('${actor}','2nd Semester',2026);${q||''}`;
const canonicalCreate=()=>{
  const source=readFunction(transitionSource,'public.kandid_create_next_academic_term');
  const old="where academic_year=expected_year::text||'-'||(expected_year+1)::text and semester=expected_semester";
  assert.equal(source.split(old).length,2,'Patch exactly the reviewed natural-key lookup');
  return source.replace('create function','create or replace function')
    .replace(old,"where term_classification='official' and academic_year=expected_year::text||'-'||(expected_year+1)::text and semester=expected_semester");
};
const canonicalPrevious=()=>readFunction(membershipSource,'public.kandid_previous_academic_term_id')
  .replace("and t.status = 'closed'","and t.status = 'closed' and t.term_classification = 'official'");

try {
  const f=fixture(true);
  f.sql("alter table public.academic_terms add constraint fixture_status_check check(status in('draft','active','closed'));alter table public.academic_terms add constraint fixture_timestamps_check check((status<>'active' or activated_at is not null) and (status<>'closed' or closed_at is not null));");
  f.sql(['private.kandid_term_transition_actor','private.kandid_lock_term_transition_inputs','public.kandid_create_next_academic_term']
    .map(n=>readFunction(transitionSource,n)).join('\n'));
  f.sql("revoke all on function public.kandid_create_next_academic_term(uuid,text,integer) from public,anon,authenticated;grant execute on function public.kandid_create_next_academic_term(uuid,text,integer) to service_role;");
  f.sql(['public.kandid_audit_category_for_event','public.kandid_prepare_audit_event'].map(n=>readFunction('supabase/migrations/20261002130000_trusted_audit_foundation.sql',n)).join('\n')+
    'create trigger audit_logs_prepare_insert before insert on public.audit_logs for each row execute function public.kandid_prepare_audit_event();');
  const oldTerm=f.value('select to_jsonb(t) from public.academic_terms t where id=2;');
  const activeOriginal=f.value('select to_jsonb(t) from public.academic_terms t where id=1;');
  const auditIds=JSON.parse(f.value('select jsonb_agg(id) from public.audit_logs;'));
  const historyTables=catalog.relations.filter(t=>['r','p'].includes(t.kind)&&!['academic_terms','audit_logs'].includes(t.table));
  const history=()=>f.value(`select md5(jsonb_build_array(${historyTables.map(t=>`(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]') from ${relation(t.schema+'.'+t.table)} r)`).join(',')},(select jsonb_agg(to_jsonb(a) order by id) from public.audit_logs a where id=any(array[${auditIds.join(',')}])),(select jsonb_agg(to_jsonb(u) order by id) from auth.users u))::text);`);
  const baseline=history();
  const fkBefore=f.value("select md5(jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid)) order by conrelid::regclass::text,conname)::text) from pg_constraint where contype='f';");
  const originalProtections=f.value("select md5(jsonb_agg(jsonb_build_array(tgname,tgenabled,pg_get_functiondef(tgfoid)) order by tgname)::text) from pg_trigger where tgname like 'kandid_preserve_%';");
  const unchanged=()=>assert.equal(history(),baseline,'Every original history/Auth/shared record must remain unchanged');
  const deny=(q,re)=>{assert.match(f.sql(q,false).stderr,re);unchanged();};
  check('existing uniqueness refuses a second ordinary term for the same period',()=>deny("insert into public.academic_terms(id,academic_year,semester,status) values(900,'2026-2027','2nd Semester','draft');",/23505/));
  check('transaction rollback of prototype installation restores the original schema and data',()=>{
    const before=f.digest();f.sql(proposal.replace(/commit;\s*$/i,'rollback;'));assert.equal(f.digest(),before);
    assert.equal(f.value("select count(*) from information_schema.columns where table_schema='public' and table_name='academic_terms' and column_name='term_classification';"),'0');
  });
  check('a newly discovered indirect dependency aborts prototype installation before classification',()=>{
    const q='begin;create table public.unreviewed_term_child(id integer primary key,academic_term_id integer references public.academic_terms(id));'+proposal.replace(/^.*?begin;/s,'');
    deny(q,/Unreviewed academic-term dependency/);
    assert.equal(f.value("select to_regclass('public.unreviewed_term_child') is null;"),'t');
  });
  f.sql(proposal);
  check('classification schema changes no original term field, history row, FK or preservation trigger',()=>{
    unchanged();assert.equal(f.value("select to_jsonb(t)-'term_classification' from public.academic_terms t where id=2;"),oldTerm);
    assert.equal(f.value("select to_jsonb(t)-'term_classification' from public.academic_terms t where id=1;"),activeOriginal);
    assert.equal(f.value("select md5(jsonb_agg(jsonb_build_array(conrelid::regclass::text,conname,pg_get_constraintdef(oid)) order by conrelid::regclass::text,conname)::text) from pg_constraint where contype='f';"),fkBefore);
    assert.equal(f.value("select md5(jsonb_agg(jsonb_build_array(tgname,tgenabled,pg_get_functiondef(tgfoid)) order by tgname)::text) from pg_trigger where tgname like 'kandid_preserve_%';"),originalProtections);
  });
  const active=f.value('select to_jsonb(t) from public.academic_terms t where id=1;');
  const target=f.value('select to_jsonb(t) from public.academic_terms t where id=2;');
  const archive=(uid=actor,expected=target)=>`select private.kandid_archive_test_term_2_prototype('${uid}',${literal(JSON.parse(active))}::jsonb,${literal(JSON.parse(expected))}::jsonb,${literal(reason)});`;
  check('archive metadata cannot be forged by directly changing classification',()=>deny("update public.academic_terms set term_classification='archived_test' where id=2;",/Exact reviewed term-2 archive audit required/));
  check('unknown actors and stale target snapshots refuse archive without partial audit',()=>{
    deny(archive('00000000-0000-4000-8000-000000000999'),/Super Admin identity/);
    deny(archive(actor,JSON.stringify({...JSON.parse(target),semester:'1st Semester'})),/Exact closed term 2/);
    assert.equal(f.value("select count(*) from public.audit_logs where event_type='academic_term_test_archived';"),'0');
  });
  check('browser and service roles cannot call the operator-only archive helper',()=>{
    deny('begin;set local role authenticated;'+archive()+'commit;',/42501/);
    deny('begin;set local role service_role;'+archive()+'commit;',/42501/);
  });
  const archived=JSON.parse(f.value(archive()));
  check('audited archive retains term 2 Closed and term 1 as the only Active term',()=>{
    assert.equal(archived.term_classification,'archived_test');assert.equal(archived.status,'closed');
    const {term_classification,...core}=archived;assert.deepEqual(core,JSON.parse(oldTerm));
    assert.equal(f.value("select jsonb_agg(id order by id) from public.academic_terms where status='active';"),'[1]');
    assert.equal(f.value('select to_jsonb(t) from public.academic_terms t where id=1;'),active);
    assert.equal(f.value("select count(*) from public.audit_logs where event_type='academic_term_test_archived' and user_id=1 and metadata->>'reason'="+literal(reason)+';'),'1');unchanged();
  });
  check('an archive marker alone does not repair the existing creator or frontend natural-key lookup',()=>{
    deny(service(create()),/already exists and is not a draft/);
    const rows=JSON.parse(f.value('select jsonb_agg(to_jsonb(t)) from public.academic_terms t;'));
    assert.equal(getAcademicTermTransitionView(rows).canCreateDraft,false);
    assert.equal(getAcademicTermTransitionView(rows.filter(t=>t.term_classification==='official')).canCreateDraft,true);
  });
  f.sql(canonicalCreate());
  const responses=await Promise.all([0,1].map(()=>new Promise((accept,reject)=>{
    const p=spawn('docker',f.args,{windowsHide:true});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);
    p.on('error',reject);p.on('close',status=>accept({status,stdout,stderr}));p.stdin.end(service(create()));
  })));
  check('concurrent guarded creators produce exactly one official next draft without conflicting rows',()=>{
    assert.ok(responses.some(r=>r.status===0));for(const r of responses.filter(r=>r.status!==0))assert.match(r.stderr,/busy|55P03/);
    assert.equal(f.value("select count(*) from public.academic_terms where academic_year='2026-2027' and semester='2nd Semester' and term_classification='official';"),'1');
  });
  const draft=JSON.parse(f.value("select to_jsonb(t) from public.academic_terms t where term_classification='official' and semester='2nd Semester';"));
  check('fresh draft has a different ID, null lifecycle timestamps and no inherited enrollment or membership',()=>{
    assert.notEqual(draft.id,2);assert.equal(draft.status,'draft');assert.equal(draft.activated_at,null);assert.equal(draft.closed_at,null);
    for(const table of ['student_term_enrollments','student_organization_terms','elections','masterlist_imports'])assert.equal(f.value(`select count(*) from public.${table} where academic_term_id=${draft.id};`),'0');
    assert.equal(f.value('select count(*) from public.student_notifications;'),'0');unchanged();
  });
  check('draft retry returns the same ID without duplicate creation audit',()=>{
    assert.equal(JSON.parse(f.value(service(create()))).id,draft.id);
    assert.equal(f.value("select count(*) from public.audit_logs where event_type='academic_term_created';"),'1');
  });
  check('canonical period uniqueness and the single-active index remain enforced',()=>{
    deny("insert into public.academic_terms(id,academic_year,semester,status) values(901,'2026-2027','2nd Semester','draft');",/23505/);
    deny(`update public.academic_terms set status='active',activated_at=now() where id=${draft.id};`,/23505/);
  });
  check('archived term cannot become Draft, Active, official again, or be relabelled',()=>{
    for(const assignment of ["status='draft'","status='active'","term_classification='official'","academic_year='2099-2100'"])deny('update public.academic_terms set '+assignment+' where id=2;',/immutable/);
  });
  check('old election schedules, candidate participation and ballot writes are frozen without changing historical status',()=>{
    deny("update public.elections set end_date=end_date+interval '1 day' where id=2;",/Archived test history is read-only/);
    deny(`update public.elections set academic_term_id=${draft.id} where id=2;`,/Archived test history is read-only/);
    deny('insert into public.candidates(id,position_id,student_id) values(901,1,1000);',/Archived test history is read-only/);
    deny("insert into public.vote_ballots(id,student_id,election_id) values('00000000-0000-4000-8000-000000000901',1000,1);",/Archived test history is read-only/);
  });
  check('old enrollment, membership and import records cannot be moved into the new official term',()=>{
    for(const [table,id] of [['student_term_enrollments',2],['student_organization_terms',1],['masterlist_imports',1]])deny(`update public.${table} set academic_term_id=${draft.id} where id=${id};`,/Archived test history is read-only/);
    deny("insert into public.student_term_enrollments(id,student_id,academic_term_id,enrollment_status) values(901,1000,2,'enrolled');",/Archived test history is read-only/);
  });
  f.sql(readFunction(membershipSource,'public.kandid_previous_academic_term_id'));
  f.sql("insert into public.academic_terms(id,academic_year,semester,status) values(902,'2027-2028','1st Semester','draft');");
  check('unchanged predecessor helper incorrectly returns the archived test term as an official predecessor',()=>assert.equal(f.value('select public.kandid_previous_academic_term_id(902);'),'2'));
  f.sql(canonicalPrevious());
  check('canonical predecessor excludes archived history and selects the replacement when it is genuinely Closed',()=>{
    assert.equal(f.value('select public.kandid_previous_academic_term_id(902);'),'');
    assert.equal(f.value(`begin;update public.academic_terms set status='closed',closed_at=now() where id=${draft.id};select public.kandid_previous_academic_term_id(902);rollback;`),String(draft.id));
  });
  const admission=readFunction(latestMembershipSource,'public.guard_student_organization_term_admission');
  check('current membership admission guard also requires a canonical predecessor filter',()=>{
    assert.equal(admission.split("and t.status = 'closed'").length,2);
    const patched=admission.replace("and t.status = 'closed'","and t.status = 'closed' and t.term_classification = 'official'");f.sql(patched);
  });
  f.sql(readFunction(membershipSource,'public.kandid_resolve_program_catalog_id'));
  f.sql(readFunction(membershipSource,'public.resolve_student_organization_participation'));
  f.sql(readFunction('supabase/migrations/20261015110620_term1_membership_bootstrap_history_guard.sql','public.sync_organization_term_participation_for_activation')
    .replace('where t.id <> p_target_term_id',"where t.term_classification = 'official' and t.id <> p_target_term_id"));
  f.sql(readFunction(membershipSource,'public.activate_academic_term'));
  check('actual activation still rejects term 2',()=>deny('select public.activate_academic_term(2);',/Only draft academic terms/));
  check('transactional activation rehearsal cannot turn historical enrollment into current participation',()=>{
    const result=JSON.parse(f.value(`begin;select public.activate_academic_term(${draft.id});select jsonb_build_object('active',(select min(id) from public.academic_terms where status='active'),'new_enrollments',(select count(*) from public.student_term_enrollments where academic_term_id=${draft.id}),'new_memberships',(select count(*) from public.student_organization_terms where academic_term_id=${draft.id}),'allowed',(select allowed from public.resolve_student_organization_participation(1,2,${draft.id})));rollback;`));
    assert.equal(result.active,draft.id);assert.equal(result.new_enrollments,0);assert.equal(result.new_memberships,0);assert.equal(result.allowed,false);
    assert.equal(f.value('select to_jsonb(t) from public.academic_terms t where id=1;'),active);unchanged();
  });
  check('rollback to the original uniqueness contract is refused while a replacement exists',()=>deny("do $$begin if exists(select 1 from public.academic_terms where academic_year='2026-2027' and semester='2nd Semester' and id<>2) then raise exception 'RECOVERY_REFUSED: replacement exists; roll forward without deleting history';end if;end$$;",/RECOVERY_REFUSED/));
  check('all 22 captured dependent relations have archive write guards; historical reads and original immutable evidence remain intact',()=>{
    assert.equal(f.value("select count(*) from pg_trigger where tgname='aaa_archived_test_history_guard' and tgenabled='O';"),'22');
    assert.equal(f.value('select count(*) from public.vote_ballots where election_id=2;'),'1');
    assert.equal(f.value("select md5(jsonb_agg(jsonb_build_array(tgname,tgenabled,pg_get_functiondef(tgfoid)) order by tgname)::text) from pg_trigger where tgname like 'kandid_preserve_%';"),originalProtections);unchanged();
  });
  const report={testedAt:new Date().toISOString(),productionConnections:0,productionSqlExecuted:false,postgres:info.Config.Image,passed:checks.length,checks,
    recommendation:'CONDITIONAL GO for design; NO-GO for production until canonical lookup, UI, deployment parity and operator migration review are complete',
    limitations:'Catalog-shaped synthetic fixture with captured FK/protection bodies and selected actual RPCs; not a full deployed Supabase Auth/RLS, masterlist, ballot or UI regression. Actual term activation rehearsal rolled back; active term 1 stayed unchanged in persisted fixture state.'};
  writeFileSync('.tmp/academic-term-archive-assessment.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
} finally {
  for(const db of databases){assert.match(db,/^kandid_term_archive_[0-9a-f]{12}$/);const r=run(['exec',container,'dropdb','-U','postgres','--force',db]);assert.equal(r.status,0,r.stderr);}
}
