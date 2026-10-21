// NO production connections. Rehearse refusal using representative synthetic
// data, captured FK contracts and the actual preservation trigger bodies.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync,spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {getAcademicTermTransitionView} from '../src/utils/academicTermTransitionPresentation.js';
assert.equal(process.argv.length,2,'No connection arguments accepted');
const container='supabase_db_kandid-board-e2e-20261016-8c19';
const prefix='kandid_term_cleanup_';
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
const blocked=readFileSync('supabase/proposals/academic-term-test-cleanup.blocked.sql','utf8');
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
  const db=prefix+randomBytes(6).toString('hex');assert.match(db,/^kandid_term_cleanup_[0-9a-f]{12}$/);
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
try{
  const f=fixture(true),baseline=f.digest();
  const deny=(query,pattern)=>{const r=f.sql(query,false);assert.match(r.stderr,pattern);assert.equal(f.digest(),baseline,'Every table and Auth identity must remain unchanged');};
  check('blocked proposal has no data/schema mutation statements or trigger bypass',()=>{
    const code=blocked.replace(/--[^\n]*/g,'').replace(/'(?:''|[^'])*'/g,"''");
    assert.doesNotMatch(code,/\b(insert|update|delete|truncate|create|alter|drop|grant|revoke|disable)\b|session_replication_role/i);
  });
  check('exact reviewed fixture reaches preservation NO-GO and rolls back with every record unchanged',()=>deny(blocked,/NO_GO: immutable preservation exclusion/));
  const modified=(mutation)=>'begin;'+mutation+blocked.replace(/^[\s\S]*?begin;/i,'');
  check('active term drift refuses the assessment without modifying either term',()=>deny(modified("update public.academic_terms set activated_at=activated_at+interval '1 second' where id=1;"),/Active term 1 changed/));
  check('closed target fingerprint drift refuses the assessment',()=>deny(modified("update public.academic_terms set closed_at=closed_at+interval '1 second' where id=2;"),/Exact closed target term 2/));
  check('same-count identity substitution refuses the assessment',()=>deny(modified('update public.masterlist_import_rows set id=999 where id=1;'),/explicit identity scope changed/));
  check('an unexpected term enrollment refuses the assessment',()=>deny(modified("insert into public.student_term_enrollments(id,student_id,academic_term_id) values(999,1000,2);"),/Record count or explicit identity scope changed/));
  check('a new indirect dependency table refuses the assessment and rolls back its fixture DDL',()=>deny(modified('create table public.unreviewed_dependency(id integer primary key,academic_term_id integer references public.academic_terms(id));'),/Foreign-key dependency contracts changed/));
  check('a disabled preservation trigger is rejected rather than bypassed',()=>deny(modified('alter table public.vote_ballots disable trigger kandid_preserve_excluded_ballot;'),/preservation triggers changed or are disabled/));
  check('direct vote removal is rejected by the actual preservation trigger',()=>deny('delete from public.votes where id=1;',/42501.*|Ballot group is excluded/s));
  check('direct ballot receipt removal is rejected by the actual preservation trigger',()=>deny("delete from public.vote_ballots where id='3c5a6c0f-5c69-49d1-bd66-ee4f97383cc1';",/Ballot group is excluded/));
  check('direct exclusion removal is rejected by the actual immutable-register trigger',()=>deny("delete from private.ballot_anchor_exclusions where ballot_id='3c5a6c0f-5c69-49d1-bd66-ee4f97383cc1';",/immutable; separate approval is required/));
  check('truncation is rejected by the actual immutable-register trigger',()=>deny('truncate private.ballot_anchor_exclusions;',/immutable; separate approval is required/));
  check('parent election and term removal remain blocked by actual FK contracts',()=>{
    deny('delete from public.elections where id=2;',/23503/);deny('delete from public.academic_terms where id=2;',/23503/);
  });
  const view=getAcademicTermTransitionView(catalog.terms);
  check('actual frontend refuses Create Draft while the closed immediate-next term still exists',()=>assert.equal(view.canCreateDraft,false));
  const installDraft=f=>{
    const proposal='supabase/proposals/academic-term-transitions.sql';
    let q=['private.kandid_term_transition_actor','private.kandid_lock_term_transition_inputs','public.kandid_create_next_academic_term'].map(n=>readFunction(proposal,n)).join('\n');
    q+=readFunction('supabase/migrations/20261002130000_trusted_audit_foundation.sql','public.kandid_audit_category_for_event');
    q+=readFunction('supabase/migrations/20261002130000_trusted_audit_foundation.sql','public.kandid_prepare_audit_event');
    q+='create trigger audit_logs_prepare_insert before insert on public.audit_logs for each row execute function public.kandid_prepare_audit_event();';
    q+='revoke all on function public.kandid_create_next_academic_term(uuid,text,integer) from public,anon,authenticated;grant execute on function public.kandid_create_next_academic_term(uuid,text,integer) to service_role;';
    f.sql(q);
  };
  installDraft(f);
  check('actual proposed creation RPC rejects the existing closed next semester instead of reopening it',()=>deny(`begin;set local role service_role;select public.kandid_create_next_academic_term('${f.uid}','2nd Semester',2026);commit;`,/already exists and is not a draft/));
  const clean=fixture(false);installDraft(clean);
  check('counterfactual evidence-free fixture exposes the correct next draft through the actual UI helper',()=>assert.equal(getAcademicTermTransitionView(catalog.terms.filter(t=>t.id!==2)).canCreateDraft,true));
  const activeBefore=clean.value('select to_jsonb(t) from public.academic_terms t where id=1;');
  const draft=JSON.parse(clean.value(`begin;set local role service_role;select public.kandid_create_next_academic_term('${clean.uid}','2nd Semester',2026);commit;`));
  check('counterfactual creation RPC creates a fresh next draft with a new ID and leaves active term 1 unchanged',()=>{
    assert.equal(draft.status,'draft');assert.equal(draft.semester,'2nd Semester');assert.equal(draft.academic_year,'2026-2027');assert.notEqual(draft.id,2);
    assert.equal(clean.value('select to_jsonb(t) from public.academic_terms t where id=1;'),activeBefore);
    assert.equal(clean.value('select count(*) from public.student_notifications;'),'0');
  });
  check('counterfactual draft retry returns the same ID without duplicate draft or audit records',()=>{
    const retry=JSON.parse(clean.value(`begin;set local role service_role;select public.kandid_create_next_academic_term('${clean.uid}','2nd Semester',2026);commit;`));
    assert.equal(retry.id,draft.id);assert.equal(clean.value("select count(*) from public.audit_logs where event_type='academic_term_created';"),'1');
  });
  assert.equal(f.digest(),baseline,'Protected fixture remains unchanged after every refusal');
  const report={project:'fszgdxqxonqqcrzsnkca',testedAt:new Date().toISOString(),passed:checks.length,checks,postgres:info.Config.Image,
    productionMutations:0,recommendation:'NO-GO',cleanupExecuted:false,deletionScope:[],counterfactualCreationPassed:true,
    limitation:'No successful cleanup is claimed. Fresh draft creation was tested only in a separate fixture where target history never existed. Fixture uses catalog-shaped tables, actual FK and preservation bodies; it does not reproduce all production RLS/auth/business triggers.'};
  writeFileSync(root+'local-pg17-tests.json',JSON.stringify(report,null,2)+'\n');console.log(`${checks.length} isolated PostgreSQL checks passed. NO-GO preserved. Production mutations: zero.`);
}finally{
  for(const db of databases){assert.match(db,/^kandid_term_cleanup_[0-9a-f]{12}$/);assert.equal(run(['exec',container,'dropdb','-U','postgres','--force',db]).status,0);}
}
