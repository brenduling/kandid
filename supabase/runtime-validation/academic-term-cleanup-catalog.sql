-- Authorized read-only inventory of the official project. No cleanup execution.
begin transaction isolation level repeatable read read only;
set local statement_timeout='20s';
set local lock_timeout='2s';
select jsonb_build_object(
  'database',current_database(),'server_version',current_setting('server_version'),
  'read_only',current_setting('transaction_read_only'),
  'terms',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.academic_terms t),
  'relations',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'kind',c.relkind,'rls',c.relrowsecurity) order by n.nspname,c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('r','p','v','m')),
  'columns',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull) order by n.nspname,c.relname,a.attnum)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    where n.nspname in ('public','private') and c.relkind in ('r','p') and a.attnum>0 and not a.attisdropped),
  'constraints',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'type',k.contype,
    'parent',case when k.confrelid<>0 then k.confrelid::regclass::text end,'definition',pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname)
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and k.contype in ('p','f','u')),
  'triggers',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text) order by n.nspname,c.relname,t.tgname)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and not t.tgisinternal),
  'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'md5',md5(pg_get_functiondef(p.oid))) order by p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'
      and (p.proname like '%academic_term%' or p.proname like '%term_transition%' or p.proname like '%anchor%' or p.proname like '%delete%' or p.proname like '%audit%'))
) as catalog;
rollback;
