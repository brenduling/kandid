begin;

-- Expose only the exact frozen-electorate row count needed by the Electoral
-- Board's read-only election deletion review. The source table remains private;
-- no student identifiers or rows are returned.
create function public.kandid_get_board_election_delete_dependency_count(
  p_election_id integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  assignment_count integer := 0;
  organization_id_value bigint;
  election_organization_id bigint;
  frozen_electorate_count bigint;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  if p_election_id is null or p_election_id <= 0 then
    raise exception using errcode = '22023', message = 'A valid election is required.';
  end if;

  select count(*)::integer, min(a.organization_id)
    into assignment_count, organization_id_value
  from public.admin_users a
  where a.auth_user_id = caller_uid
    and a.role = 'electoral_board'
    and a.status = 'active';

  if assignment_count <> 1 or organization_id_value is null then
    raise exception using errcode = '42501', message = 'Active Electoral Board organization authorization required.';
  end if;

  select e.organization_id
    into election_organization_id
  from public.elections e
  where e.id = p_election_id;

  if not found or election_organization_id is distinct from organization_id_value then
    raise exception using errcode = '42501', message = 'Election is unavailable.';
  end if;

  select count(*)
    into frozen_electorate_count
  from private.election_eligible_voters v
  where v.election_id = p_election_id;

  return pg_catalog.jsonb_build_object(
    'election_id', p_election_id,
    'frozen_electorate_records', frozen_electorate_count
  );
end;
$function$;

alter function public.kandid_get_board_election_delete_dependency_count(integer)
  owner to postgres;

revoke all on function public.kandid_get_board_election_delete_dependency_count(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_board_election_delete_dependency_count(integer)
  to authenticated;

comment on function public.kandid_get_board_election_delete_dependency_count(integer) is
  'Read-only Electoral Board scoped count of private frozen electorate rows for one assigned-organization election; returns no student identifiers.';

notify pgrst, 'reload schema';
commit;
