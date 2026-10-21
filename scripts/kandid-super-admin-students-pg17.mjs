// Synthetic-only tests. This runner cannot accept a production database URL.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
const container='supabase_db_kandid-board-e2e-20261016-8c19';
const run=(args,input)=>spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
const inspection=run(['inspect',container]);assert.equal(inspection.status,0,inspection.stderr);
const info=JSON.parse(inspection.stdout)[0];assert.equal(info.Config.Labels['com.supabase.cli.project'],'kandid-board-e2e-20261016-8c19');assert.equal(info.HostConfig.PortBindings['5432/tcp'][0].HostPort,'59322');
const db='kandid_sa_students_'+randomBytes(6).toString('hex');assert.match(db,/^kandid_sa_students_[a-f0-9]{12}$/);
assert.equal(run(['exec',container,'createdb','-U','postgres','--template=template0',db]).status,0);
const args=['exec','-i',container,'psql','-X','-q','-At','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'];
const sql=(q,ok=true)=>{const r=run(args,q);if(ok)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0);return r;};
const val=q=>sql(q).stdout.trim().split('\n').at(-1);
const baseline=JSON.parse(readFileSync('tests/fixtures/superAdminStudentsProductionContract.json','utf8'));
const get=n=>baseline.functions.find(f=>f.proname===n).definition;
const forward=readFileSync('supabase/proposals/super-admin-students-recovery.sql','utf8'),rollback=readFileSync('supabase/proposals/super-admin-students-recovery.rollback.sql','utf8');
const service=q=>'begin;set local role service_role;'+q+'commit;';
const list=(search='',status='all',ids='null',sort='name_asc',page=1,limit=10)=>`select public.kandid_super_admin_list_students(1,'${search.replaceAll("'","''")}','${status}',${ids},'${sort}',${page},${limit});`;
const data={student_number:'90001',first_name:'Ada',last_name:'Synthetic',email:'ada@example.invalid',photo_url:null,program:'BSIT',year_level:1,precinct_code:null,batch_code:null,status:'active'};
const update=(id=1,fields={})=>`select public.kandid_super_admin_update_student(1,${id},'${JSON.stringify({...data,...fields}).replaceAll("'","''")}'::jsonb);`;
let count=0;const check=(name,f)=>{f();count++;console.log('PASS '+name);};
try{
  sql(`create table public.admin_users(id bigint primary key,full_name text,role text,status text,email text);
    create table public.students(id integer primary key,student_number text unique,first_name text,last_name text,email text,photo_url text,program text,year_level integer,precinct_code text,batch_code text,status text,created_at timestamptz default now(),password text,auth_user_id uuid);
    create table public.audit_logs(user_id bigint,actor_name text,actor_role text,action text,event_type text,event_category text,entity_type text,entity_id text,entity_label text,status text,event_origin text,metadata jsonb);
    create function public.kandid_audit_category_for_event(text) returns text language sql as $$select 'students'::text$$;
    insert into public.admin_users values(1,'Synthetic SA','super_admin','active','sa@example.invalid'),(2,'Synthetic Board','electoral_board','active','board@example.invalid'),(3,'Disabled SA','super_admin','disabled','disabled@example.invalid');
    insert into public.students values(1,'90001','Ada','Synthetic','ada@example.invalid',null,'BSIT',1,null,null,'active',now(),'untouched-password','00000000-0000-4000-8000-000000000001'),
      (2,'90002','Ben','Example','ben@example.invalid',null,'BSIT',2,null,null,'pending',now(),null,null),
      (3,'90003','Percent%','Under_score','third@example.invalid',null,'BSCS',3,null,null,'disabled',now(),null,null);
    alter table public.students enable row level security;
    revoke all on public.students from public,anon,authenticated;`);
  for(const n of ['kandid_super_admin_list_students','kandid_super_admin_update_student']){
    sql(get(n)+';');const sig=n==='kandid_super_admin_list_students'?'bigint,text,text,integer[],text,integer,integer':'bigint,integer,jsonb';
    sql(`revoke all on function public.${n}(${sig}) from public,anon,authenticated;grant execute on function public.${n}(${sig}) to service_role;`);
  }
  check('captured production search accepts a normal name',()=>assert.equal(JSON.parse(val(service(list('Ada')))).total_count,1));
  check('captured production email validation accepts a valid address',()=>{sql('begin;set local role service_role;'+update()+'rollback;');});
  check('captured production search does not recognize a full name',()=>assert.equal(JSON.parse(val(service(list('Ada Synthetic')))).total_count,0));
  const before=val('select md5(string_agg(to_jsonb(s)::text,E\'\\n\' order by id)) from public.students s;');
  sql(forward);
  check('forward installation changes no student data',()=>assert.equal(val('select md5(string_agg(to_jsonb(s)::text,E\'\\n\' order by id)) from public.students s;'),before));
  check('replay stops on reviewed-source guard',()=>assert.match(sql(forward,false).stderr,/source or authorization differs/));
  check('institution-wide listing returns real fixture rows without credentials or Auth UUIDs',()=>{
    const r=JSON.parse(val(service(list())));assert.equal(r.total_count,3);assert.equal(r.data.find(row=>row.id===1).identity_linked,true);for(const row of r.data){assert.equal(Object.hasOwn(row,'password'),false);assert.equal(Object.hasOwn(row,'auth_user_id'),false);}
  });
  for(const search of ['Ada','Ada Synthetic','90001','ada@example.invalid'])check('search '+search,()=>assert.equal(JSON.parse(val(service(list(search)))).total_count,1));
  for(const search of ['%','_'])check('search treats '+search+' literally',()=>assert.equal(JSON.parse(val(service(list(search)))).total_count,1));
  for(const status of ['active','pending','disabled'])check('status '+status,()=>assert.equal(JSON.parse(val(service(list('',status)))).total_count,1));
  for(const sort of ['name_asc','name_desc','newest','oldest','id_asc','id_desc'])check('sort '+sort,()=>assert.equal(JSON.parse(val(service(list('','all','null',sort)))).data.length,3));
  check('organization IDs filter and pagination preserve totals',()=>{const r=JSON.parse(val(service(list('','all','array[2]'))));assert.equal(r.total_count,1);assert.equal(r.data[0].id,2);const p=JSON.parse(val(service(list('','all','null','id_asc',2,1))));assert.equal(p.total_count,3);assert.equal(p.data[0].id,2);});
  check('browser and ordinary Board cannot execute privileged directory RPC',()=>{
    for(const role of ['anon','authenticated'])assert.match(sql(`set role ${role};`+list(),false).stderr,/permission denied/);
    for(const actor of [2,3,999])assert.match(sql(service(list().replace('(1,','('+actor+',')),false).stderr,/Super Admin authorization/);
  });
  check('invalid filters and sorts fail closed',()=>{sql(service(list('','bogus')),false);sql(service(list('','all','null','bogus')),false);});
  check('profile updates preserve linked identity and produce an audit record',()=>{
    sql(service(update(1,{first_name:'Reviewed'})));assert.equal(val("select first_name from public.students where id=1;"),'Reviewed');assert.equal(val("select password||':'||auth_user_id::text from public.students where id=1;"),'untouched-password:00000000-0000-4000-8000-000000000001');assert.equal(val('select count(*) from public.audit_logs;'),'1');
  });
  check('linked Student ID and email substitution fail atomically',()=>{
    for(const fields of [{student_number:'99999'},{email:'other@example.invalid'}])assert.match(sql(service(update(1,fields)),false).stderr,/cannot be changed/);
    assert.equal(val('select count(*) from public.audit_logs;'),'1');
  });
  check('duplicate Student ID cannot overwrite another record',()=>{sql(service(update(2,{student_number:'90001',status:'pending'})),false);assert.equal(val('select count(*) from public.students;'),'3');});
  check('rollback restores exact previous function bodies without reversing records',()=>{
    const saved=val("select first_name from public.students where id=1;");sql(rollback);assert.equal(val("select first_name from public.students where id=1;"),saved);
    for(const n of ['kandid_super_admin_list_students','kandid_super_admin_update_student']){const sig=n==='kandid_super_admin_list_students'?'bigint,text,text,integer[],text,integer,integer':'bigint,integer,jsonb';assert.equal(val(`select md5(pg_get_functiondef('public.${n}(${sig})'::regprocedure));`),createHash('md5').update(get(n)).digest('hex'));}
  });
  sql(`alter table public.students add column is_shs boolean default false;
    create sequence public.synthetic_student_ids start 100;
    alter table public.students alter column id set default nextval('public.synthetic_student_ids');
    create table public.academic_terms(id integer primary key,status text);
    insert into public.academic_terms values(1,'active'),(2,'closed');
    create table public.student_term_enrollments(id serial primary key,student_id integer references public.students(id),academic_term_id integer references public.academic_terms(id),program text check(program<>'ROLLBACK'),year_level integer,is_shs boolean,enrollment_status text,source text,updated_at timestamptz,constraint student_term_enrollments_unique_student_term unique(student_id,academic_term_id));`);
  sql(get('create_manual_student_for_term_v1')+';'+get('enroll_existing_student_for_term_v1')+';');
  const create=(id,program='BSIT',term=1)=>`select outcome from public.create_manual_student_for_term_v1(${term},'${id}','New','Synthetic','new@example.invalid','${program}',1);`;
  check('actual manual RPC creates pending identity and enrolled term together',()=>{assert.equal(val(create('90100')),'NEW_STUDENT_CREATED');assert.equal(val("select count(*) from public.students s join public.student_term_enrollments e on e.student_id=s.id where s.student_number='90100' and s.status='pending' and e.enrollment_status='enrolled';"),'1');});
  check('actual manual duplicate RPC leaves existing identity unchanged',()=>{const before=val("select md5(to_jsonb(s)::text) from public.students s where student_number='90100';");assert.equal(val(create('90100')),'IDENTITY_RECHECK_REQUIRED');assert.equal(val("select md5(to_jsonb(s)::text) from public.students s where student_number='90100';"),before);});
  check('actual manual RPC rolls back identity if term insert fails',()=>{assert.equal(val(create('90101','ROLLBACK')),'SAFE_SERVER_ERROR');assert.equal(val("select count(*) from public.students where student_number='90101';"),'0');});
  check('actual manual RPC rejects a closed academic term',()=>{assert.equal(val(create('90102','BSIT',2)),'INVALID_TERM');assert.equal(val("select count(*) from public.students where student_number='90102';"),'0');});
  check('actual enrollment RPC preserves linked identity and password',()=>{const before=val('select md5(to_jsonb(s)::text) from public.students s where id=1;');assert.equal(val("select outcome from public.enroll_existing_student_for_term_v1(1,1,'BSIT',1);"),'EXISTING_STUDENT_ENROLLED');assert.equal(val('select md5(to_jsonb(s)::text) from public.students s where id=1;'),before);assert.equal(val("select outcome from public.enroll_existing_student_for_term_v1(1,1,'BSIT',1);"),'ALREADY_ENROLLED_CURRENT_TERM');});
  console.log(`${count} isolated PostgreSQL checks passed; production connections: zero.`);
} finally {assert.match(db,/^kandid_sa_students_[a-f0-9]{12}$/);assert.equal(run(['exec',container,'dropdb','-U','postgres','--force',db]).status,0);}
