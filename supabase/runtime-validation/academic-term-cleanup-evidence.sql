-- Authorized read-only preservation/provenance checks. No worker or application RPC calls.
begin transaction isolation level repeatable read read only;
set local statement_timeout='25s';
set local lock_timeout='2s';
with recursive dependency_relations(oid) as (
  select 'public.academic_terms'::regclass::oid
  union
  select c.conrelid from pg_constraint c join dependency_relations r on c.confrelid=r.oid where c.contype='f'
), target_students(id) as (values(1),(34),(35),(36))
select jsonb_build_object(
  'all_schema_dependencies',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname) order by n.nspname,c.relname)
    from dependency_relations d join pg_class c on c.oid=d.oid join pg_namespace n on n.oid=c.relnamespace),
  'term_reference_columns',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'column',a.attname) order by n.nspname,c.relname,a.attname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    where c.relkind in('r','p') and a.attnum>0 and not a.attisdropped and n.nspname not in('pg_catalog','information_schema')
      and (a.attname ilike '%academic_term%' or a.attname in('source_term_id','target_term_id','previous_term_id','term_id'))),
  'shared_accounts',(select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'created_at',s.created_at,
    'test_marker_fields',array_remove(array[
      case when s.student_number ~* '(synthetic|test|local)' then 'student_number' end,
      case when s.first_name ~* '(synthetic|test|local)' then 'first_name' end,
      case when s.last_name ~* '(synthetic|test|local)' then 'last_name' end,
      case when s.email ~* '(synthetic|test|local|example\.invalid)' then 'email' end],null),
    'other_enrollment_ids',(select coalesce(jsonb_agg(e.id order by e.id),'[]') from public.student_term_enrollments e where e.student_id=s.id and e.academic_term_id<>2),
    'other_membership_ids',(select coalesce(jsonb_agg(m.id order by m.id),'[]') from public.student_organization_terms m where m.student_id=s.id and m.academic_term_id<>2),
    'structural_membership_ids',(select coalesce(jsonb_agg(m.id order by m.id),'[]') from public.student_organizations m where m.student_id=s.id),
    'other_vote_ids',(select coalesce(jsonb_agg(v.id order by v.id),'[]') from public.votes v join public.elections e on e.id=v.election_id where v.student_id=s.id and e.academic_term_id is distinct from 2),
    'other_candidate_ids',(select coalesce(jsonb_agg(c.id order by c.id),'[]') from public.candidates c join public.positions p on p.id=c.position_id join public.elections e on e.id=p.election_id where c.student_id=s.id and e.academic_term_id is distinct from 2)
    ) order by s.id) from public.students s join target_students target on target.id=s.id),
  'shared_organizations',(select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'membership_scope',o.membership_scope,
    'other_election_ids',(select coalesce(jsonb_agg(e.id order by id),'[]') from public.elections e where e.organization_id=o.id and e.academic_term_id is distinct from 2),
    'other_term_membership_count',(select count(*) from public.student_organization_terms m where m.organization_id=o.id and m.academic_term_id<>2)) order by o.id)
    from public.organizations o where o.id in(2,3)),
  'other_elections',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'academic_term_id',academic_term_id,'organization_id',organization_id,'title',title,'status',status) order by id),'[]') from public.elections where academic_term_id is distinct from 2),
  'all_anchor_evidence',(select jsonb_agg(j order by j->>'relation',j->>'id') from (
    select jsonb_build_object('relation','vote_ballots','id',id,'election_id',election_id,'hash',ballot_hash,'anchor_status',blockchain_anchor_status,'tx_id',blockchain_tx_id,'network',blockchain_network,'registry',blockchain_contract_address,'block',blockchain_block_number) j from public.vote_ballots
    union all
    select jsonb_build_object('relation','votes','id',id,'election_id',election_id,'hash',vote_hash,'anchor_status',blockchain_anchor_status,'tx_id',blockchain_tx_id,'network',blockchain_network,'registry',blockchain_contract_address,'block',blockchain_block_number) from public.votes) x),
  'all_exclusion_keys',(select jsonb_agg(jsonb_build_object('ballot_id',ballot_id,'election_id',election_id,'ballot_hash',ballot_hash,'recorded_at',recorded_at) order by ballot_id) from private.ballot_anchor_exclusions),
  'protection_functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid)) order by p.oid::regprocedure::text)
    from pg_proc p where p.oid in('private.kandid_guard_excluded_ballot()'::regprocedure,'private.kandid_guard_excluded_ballot_votes()'::regprocedure,'private.kandid_guard_anchor_exclusion_register()'::regprocedure)),
  'other_related_audits',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'event_type',event_type,'entity_type',entity_type,'entity_id',entity_id,'election_id',election_id,'created_at',created_at) order by id),'[]') from public.audit_logs t
    where (t.entity_type in('academic_term','academic_terms') and t.entity_id='2')
      or (t.entity_type in('election','position','candidate') and t.entity_id in('1','2'))
      or (t.entity_type in('masterlist_import','masterlist') and t.entity_id in('1','2','3'))
      or (t.entity_type='student' and t.entity_id in('1','34','35','36'))
      or (t.metadata @? '$.**.target_academic_term_id ? (@ == 2 || @ == "2")')
      or (t.metadata @? '$.**.source_academic_term_id ? (@ == 2 || @ == "2")')
      or (t.metadata @? '$.**.previous_term_id ? (@ == 2 || @ == "2")')),
  'all_notification_identifiers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'student_id',student_id,'type',type,'created_at',created_at,
    'metadata_keys',(select coalesce(jsonb_agg(k),'[]') from jsonb_object_keys(t.metadata) k)) order by id),'[]') from public.student_notifications t),
  'possible_media_references',jsonb_build_object(
    'candidate_ids',(select coalesce(jsonb_agg(c.id),'[]') from public.candidates c join public.positions p on p.id=c.position_id join public.elections e on e.id=p.election_id
      where e.academic_term_id=2 and (coalesce(c.photo,'')<>'' or c.campaign_media_urls is not null or c.campaign_materials is not null)),
    'election_ids',(select coalesce(jsonb_agg(id),'[]') from public.elections where academic_term_id=2 and coalesce(cover_url,'')<>'')),
  'storage_objects',(select count(*) from storage.objects),
  'read_only',current_setting('transaction_read_only')
) as evidence;
rollback;
