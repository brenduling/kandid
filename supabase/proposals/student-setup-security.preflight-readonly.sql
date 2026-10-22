-- PREPARED ONLY. Explicit authorization for production catalog SQL is required.
-- No application rows, RPC invocations, writes, OTPs or migrations are performed.
begin transaction isolation level repeatable read read only;
set local statement_timeout='15s';
select jsonb_build_object(
 'database',current_database(), 'server_version',current_setting('server_version'),
 'columns',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
    'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull))
   from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
   where a.attnum>0 and not a.attisdropped and (
    (n.nspname='public' and c.relname='students' and a.attname in
      ('id','student_number','email','status','auth_user_id','first_name','last_name','program','year_level')) or
    (n.nspname='public' and c.relname='admin_users' and a.attname in ('id','email','auth_user_id','status')) or
    (n.nspname='auth' and c.relname='users' and a.attname in ('id','email','email_confirmed_at')))),
 'relations',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,
    'rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner)))
   from pg_class c join pg_namespace n on n.oid=c.relnamespace where
    (n.nspname='public' and c.relname in ('students','admin_users')) or
    (n.nspname='auth' and c.relname='users') or
    (n.nspname='private' and c.relname in ('student_auth_rate_buckets','student_setup_proofs','student_setup_one_unresolved_claim'))),
 'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)))
    from pg_constraint where conrelid='public.students'::regclass),
 'indexes',(select jsonb_agg(indexdef) from pg_indexes where schemaname='public' and tablename='students'),
 'policies',(select jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'roles',roles,'command',cmd,
    'qual_sha256',encode(sha256(convert_to(coalesce(qual,''),'UTF8')),'hex'),
    'check_sha256',encode(sha256(convert_to(coalesce(with_check,''),'UTF8')),'hex')))
    from pg_policies where (schemaname='public' and tablename in ('students','admin_users'))
      or (schemaname='private' and tablename in ('student_auth_rate_buckets','student_setup_proofs'))),
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
    'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'settings',p.proconfig,
    'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),
    'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'service_execute',has_function_privilege('service_role',p.oid,'EXECUTE'),
    'definition_sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex')))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
    (n.nspname='public' and p.proname in ('kandid_consume_student_auth_rate_limit',
       'kandid_student_setup_admission_v1','kandid_student_setup_issue_v1',
       'kandid_student_setup_claim_v1','kandid_student_setup_finish_v1')) or
    (n.nspname='private' and p.proname='kandid_setup_record_v1')),
 'triggers',(select jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,
    'definition',pg_get_triggerdef(oid),'function_sha256',encode(sha256(convert_to(pg_get_functiondef(tgfoid),'UTF8')),'hex')))
    from pg_trigger where tgrelid='public.students'::regclass and not tgisinternal)
) as setup_catalog_preflight;
rollback;
