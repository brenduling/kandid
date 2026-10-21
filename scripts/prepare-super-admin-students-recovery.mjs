// Generates local review artifacts from captured production source. No network.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const baseline=JSON.parse(readFileSync('tests/fixtures/superAdminStudentsProductionContract.json','utf8'));
const md5=s=>createHash('md5').update(s).digest('hex');
const get=name=>baseline.functions.find(f=>f.proname===name).definition;
const originalList=get('kandid_super_admin_list_students');
const list=originalList
  .replace('s.batch_code, s.status, s.created_at','s.batch_code, s.status, s.created_at, (s.auth_user_id is not null) as identity_linked')
  .replace("s.last_name ilike '%' || escaped_search", "(coalesce(s.first_name,'') || ' ' || coalesce(s.last_name,'')) ilike '%' || escaped_search")
  .replace("'batch_code', p.batch_code, 'status', p.status, 'created_at', p.created_at", "'batch_code', p.batch_code, 'status', p.status, 'created_at', p.created_at,\n             'identity_linked',p.identity_linked");
const originalUpdate=get('kandid_super_admin_update_student');
const update=originalUpdate
  .replace('  update public.students s\n',`  -- Account identity changes require the existing trusted identity workflow.
  if original_row.auth_user_id is not null and (
    btrim(p_student->>'student_number') is distinct from original_row.student_number
    or nullif(lower(btrim(p_student->>'email')),'') is distinct from nullif(lower(btrim(original_row.email)),'')) then
    raise exception using errcode='22023',message='Linked Student ID and email cannot be changed through directory editing.';
  end if;

  update public.students s
`);
if(list===originalList||update===originalUpdate||!list.includes('identity_linked'))throw Error('Unexpected captured baseline');
const signatures=[['kandid_super_admin_list_students','bigint,text,text,integer[],text,integer,integer',originalList,list],['kandid_super_admin_update_student','bigint,integer,jsonb',originalUpdate,update]];
const guards=(rollback=false)=>`do $guard$ declare item record; begin
  for item in select * from (values ${signatures.map(([n,a,old,next])=>`('public.${n}(${a})','${md5(rollback?next.match(/AS \$function\$([\s\S]*?)\$function\$/)[1]:old)}')`).join(',')}) expected(signature,digest) loop
    if to_regprocedure(item.signature) is null or
      ${rollback?"(select md5(prosrc) from pg_proc where oid=to_regprocedure(item.signature))":"md5(pg_get_functiondef(to_regprocedure(item.signature)))"} is distinct from item.digest or
      not exists(select 1 from pg_proc p where p.oid=to_regprocedure(item.signature) and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef and p.proconfig=array['search_path=pg_catalog']) or
      has_function_privilege('anon',to_regprocedure(item.signature),'EXECUTE') or
      has_function_privilege('authenticated',to_regprocedure(item.signature),'EXECUTE') or
      not has_function_privilege('service_role',to_regprocedure(item.signature),'EXECUTE') then
      raise exception 'Student directory source or authorization differs: %. Stop.',item.signature;
    end if;
  end loop;
end $guard$;`;
for(const rollback of [false,true])writeFileSync(`supabase/proposals/super-admin-students-recovery${rollback?'.rollback':''}.sql`,
  '-- LOCAL REVIEW ONLY. No table grants/RLS changes or data updates at installation.\nbegin;\nset local lock_timeout=\'5s\';\n'+guards(rollback)+'\n'+signatures.map(s=>s[rollback?2:3]+';').join('\n')+'\ncommit;\n');
console.log('Prepared two-function recovery and guarded exact-source rollback.');
