begin;

-- Board Voting Monitor reads one record per submitted ballot without exposing
-- the position-level choices stored in public.votes. The caller's organization
-- always comes from its active Electoral Board assignment.
create or replace function public.kandid_get_board_voting_monitor(
  p_election_id integer default null,
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid := auth.uid();
  organization_id_value bigint;
  assignment_count integer := 0;
  monitor_result jsonb;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
  end if;

  if p_offset is null or p_offset < 0 or p_offset > 1000000
     or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023',
      message = 'Valid ballot monitor pagination is required.';
  end if;

  select count(distinct a.organization_id)::integer,
         min(a.organization_id)
    into assignment_count, organization_id_value
  from public.admin_users a
  where a.auth_user_id = caller_uid
    and a.role = 'electoral_board'
    and a.status = 'active'
    and a.organization_id is not null;

  if assignment_count <> 1 or organization_id_value is null then
    raise exception using errcode = '42501',
      message = 'Active Electoral Board organization authorization required.';
  end if;

  -- Do not reveal whether an arbitrary ID exists outside the caller's scope.
  if p_election_id is not null and not exists (
    select 1
    from public.elections e
    where e.id = p_election_id
      and e.organization_id = organization_id_value
  ) then
    raise exception using errcode = '42501', message = 'Election is unavailable.';
  end if;

  with scoped_ballots as materialized (
    select
      b.id,
      b.student_id,
      b.election_id,
      e.title as election_title,
      s.student_number,
      s.first_name,
      s.last_name,
      b.canonical_submitted_at as submitted_at,
      b.blockchain_anchor_status
    from public.vote_ballots b
    join public.elections e
      on e.id = b.election_id
     and e.organization_id = organization_id_value
    left join public.students s
      on s.id = b.student_id
    where p_election_id is null
       or b.election_id = p_election_id
  ), summary as (
    select
      count(*)::integer as ballots_submitted,
      count(distinct student_id)::integer as students_voted,
      count(*) filter (where blockchain_anchor_status = 'anchored')::integer as anchored,
      count(*) filter (
        where blockchain_anchor_status in ('pending', 'anchoring', 'submitted')
      )::integer as processing,
      count(*) filter (
        where blockchain_anchor_status in ('anchor_failed', 'manual_review')
      )::integer as needs_attention
    from scoped_ballots
  ), ballot_rows as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', page.id,
          'student_number', page.student_number,
          'first_name', page.first_name,
          'last_name', page.last_name,
          'election_id', page.election_id,
          'election_title', page.election_title,
          'submitted_at', page.submitted_at,
          'blockchain_anchor_status', page.blockchain_anchor_status
      ) order by page.submitted_at desc, page.id desc
      ),
      '[]'::jsonb
    ) as ballots
    from (
      select *
      from scoped_ballots
      order by submitted_at desc, id desc
      limit p_limit
      offset p_offset
    ) page
  )
  select jsonb_build_object(
    'elections', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', e.id, 'title', e.title)
        order by e.created_at desc, e.id desc
      )
      from public.elections e
      where e.organization_id = organization_id_value
    ), '[]'::jsonb),
    'summary', jsonb_build_object(
      'ballots_submitted', summary.ballots_submitted,
      'students_voted', summary.students_voted,
      'anchored', summary.anchored,
      'processing', summary.processing,
      'needs_attention', summary.needs_attention
    ),
    'page', jsonb_build_object(
      'offset', p_offset,
      'limit', p_limit,
      'has_more', summary.ballots_submitted > p_offset + jsonb_array_length(ballot_rows.ballots)
    ),
    'ballots', ballot_rows.ballots
  )
  into monitor_result
  from summary
  cross join ballot_rows;

  return monitor_result;
end;
$function$;

revoke all on function public.kandid_get_board_voting_monitor(integer, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_board_voting_monitor(integer, integer, integer)
  to authenticated;

comment on function public.kandid_get_board_voting_monitor(integer, integer, integer) is
  'Read-only Board-scoped ballot activity and anchor summary; returns no vote rows, candidate choices, hashes, or transaction details.';

notify pgrst, 'reload schema';
commit;
