begin;

-- Board Reports reads only the records belonging to the caller's active
-- Electoral Board organization. The election selector and report package use
-- separate RPCs so listing election context never returns report contents.
create or replace function public.kandid_list_board_report_elections()
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
  elections_result jsonb;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'title', e.title,
        'status', e.status,
        'campaign_start', e.campaign_start,
        'campaign_end', e.campaign_end,
        'start_date', e.start_date,
        'end_date', e.end_date,
        'created_at', e.created_at
      ) order by e.created_at desc, e.id desc
    ),
    '[]'::jsonb
  )
  into elections_result
  from public.elections e
  where e.organization_id = organization_id_value;

  return jsonb_build_object('elections', elections_result);
end;
$function$;

create or replace function public.kandid_get_board_election_report_package(
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
  organization_id_value bigint;
  assignment_count integer := 0;
  election_row public.elections%rowtype;
  election_report jsonb;
  position_report jsonb;
  candidate_report jsonb;
  voting_summary jsonb;
  ballot_record_count bigint := 0;
  legacy_vote_row_count bigint := 0;
  ballot_count_availability text;
  authoritative_ballot_count bigint;
begin
  if caller_uid is null then
    raise exception using errcode = '28000', message = 'Authentication required.';
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

  -- Treat a missing, invalid, or foreign election identically so this endpoint
  -- does not reveal whether an out-of-scope election ID exists.
  select e.*
    into election_row
  from public.elections e
  where p_election_id is not null
    and p_election_id > 0
    and e.id = p_election_id
    and e.organization_id = organization_id_value;

  if not found then
    raise exception using errcode = '42501', message = 'Election is unavailable.';
  end if;

  election_report := jsonb_build_object(
    'election_id', election_row.id,
    'title', election_row.title,
    'organization_id', election_row.organization_id,
    'campaign_start', election_row.campaign_start,
    'campaign_end', election_row.campaign_end,
    'start_date', election_row.start_date,
    'end_date', election_row.end_date,
    'status', election_row.status,
    'location_label', election_row.location_label,
    'created_at', election_row.created_at
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'position_id', p.id,
        'election_id', p.election_id,
        'position_name', p.name,
        'max_votes', p.max_votes
      ) order by p.display_order asc, p.id asc
    ),
    '[]'::jsonb
  )
  into position_report
  from public.positions p
  where p.election_id = election_row.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'candidate_id', c.id,
        'position_name', p.name,
        'student_id', c.student_id,
        'candidate_name', nullif(
          pg_catalog.btrim(pg_catalog.concat_ws(' ', s.first_name, s.last_name)),
          ''
        ),
        'student_number', s.student_number,
        'partylist_id', pl.id,
        'partylist_name', pl.name,
        'platform', c.platform,
        'photo', c.photo,
        'campaign_status', c.campaign_status,
        'created_at', c.created_at
      ) order by p.display_order asc, p.id asc, c.id asc
    ),
    '[]'::jsonb
  )
  into candidate_report
  from public.candidates c
  join public.positions p
    on p.id = c.position_id
   and p.election_id = election_row.id
  left join public.students s
    on s.id = c.student_id
  left join public.partylists pl
    on pl.id = c.partylist_id
   and pl.organization_id = election_row.organization_id;

  select count(*)
    into ballot_record_count
  from public.vote_ballots b
  where b.election_id = election_row.id;

  select count(*)
    into legacy_vote_row_count
  from public.votes v
  where v.election_id = election_row.id
    and v.ballot_id is null;

  if ballot_record_count > 0 and legacy_vote_row_count > 0 then
    ballot_count_availability := 'mixed_ballot_and_legacy';
    authoritative_ballot_count := ballot_record_count;
  elsif ballot_record_count > 0 then
    ballot_count_availability := 'authoritative';
    authoritative_ballot_count := ballot_record_count;
  elsif legacy_vote_row_count > 0 then
    ballot_count_availability := 'legacy_unavailable';
    authoritative_ballot_count := null;
  else
    -- No legacy vote rows exist, so zero ballot records is an authoritative
    -- zero for the stored election record set.
    ballot_count_availability := 'authoritative';
    authoritative_ballot_count := 0;
  end if;

  select jsonb_build_object(
    'election', jsonb_build_object(
      'election_id', election_row.id,
      'title', election_row.title
    ),
    'ballot_count_source', 'vote_ballots',
    'ballot_count_availability', ballot_count_availability,
    'authoritative_ballot_count', authoritative_ballot_count,
    'legacy_vote_rows_without_ballot', legacy_vote_row_count,
    'positions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'position_id', p.id,
          'position_name', p.name,
          'candidates', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'candidate_id', c.id,
                'candidate_name', nullif(
                  pg_catalog.btrim(pg_catalog.concat_ws(' ', s.first_name, s.last_name)),
                  ''
                ),
                'vote_total', coalesce(t.vote_total, 0)
              ) order by p.display_order asc, c.id asc
            )
            from public.candidates c
            left join public.students s
              on s.id = c.student_id
            left join lateral (
              select count(*)::bigint as vote_total
              from public.votes v
              where v.election_id = election_row.id
                and v.position_id = p.id
                and v.candidate_id = c.id
                and v.is_abstain is false
            ) t on true
            where c.position_id = p.id
          ), '[]'::jsonb),
          'abstention_total', (
            select count(*)::bigint
            from public.votes v
            where v.election_id = election_row.id
              and v.position_id = p.id
              and v.is_abstain is true
          )
        ) order by p.display_order asc, p.id asc
      )
      from public.positions p
      where p.election_id = election_row.id
    ), '[]'::jsonb)
  )
  into voting_summary;

  return jsonb_build_object(
    'election_report', election_report,
    'position_report', position_report,
    'candidate_report', candidate_report,
    'voting_summary', voting_summary
  );
end;
$function$;

revoke all on function public.kandid_list_board_report_elections()
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_list_board_report_elections()
  to authenticated;

revoke all on function public.kandid_get_board_election_report_package(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_get_board_election_report_package(integer)
  to authenticated;

comment on function public.kandid_list_board_report_elections() is
  'Lists election context for the active Electoral Board organization only; returns no report datasets.';
comment on function public.kandid_get_board_election_report_package(integer) is
  'Returns election-scoped Board report datasets after deriving and verifying the active Electoral Board organization; Voting Summary contains aggregates only.';

notify pgrst, 'reload schema';
commit;
