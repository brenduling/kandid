begin;

create function private.normalize_student_campaign_materials(
  p_materials jsonb,
  p_legacy_urls jsonb
)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $function$
  with material_rows as (
    select
      material.ordinality::integer as source_order,
      case
        when pg_catalog.jsonb_typeof(material.value) = 'object'
         and pg_catalog.jsonb_typeof(material.value -> 'label') = 'string'
          then nullif(pg_catalog.btrim(material.value ->> 'label'), '')
        else null
      end as label,
      case
        when pg_catalog.jsonb_typeof(material.value) = 'object'
         and pg_catalog.jsonb_typeof(material.value -> 'type') = 'string'
         and material.value ->> 'type' in ('document', 'media', 'link')
          then material.value ->> 'type'
        else 'link'
      end as material_type,
      case
        when pg_catalog.jsonb_typeof(material.value) = 'string'
          then nullif(pg_catalog.btrim(material.value #>> '{}'), '')
        when pg_catalog.jsonb_typeof(material.value) = 'object'
         and pg_catalog.jsonb_typeof(material.value -> 'url') = 'string'
          then nullif(pg_catalog.btrim(material.value ->> 'url'), '')
        else null
      end as material_url,
      case
        when pg_catalog.jsonb_typeof(material.value) = 'object'
         and pg_catalog.jsonb_typeof(material.value -> 'downloadable') = 'boolean'
         and material.value -> 'downloadable' = 'true'::jsonb
          then true
        else false
      end as downloadable
    from pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(p_materials) = 'array' then p_materials
        else '[]'::jsonb
      end
    ) with ordinality as material(value, ordinality)
  ),
  legacy_rows as (
    select
      1000000 + legacy_url.ordinality::integer as source_order,
      null::text as label,
      'link'::text as material_type,
      nullif(pg_catalog.btrim(legacy_url.value #>> '{}'), '') as material_url,
      false as downloadable
    from pg_catalog.jsonb_array_elements(
      case
        when pg_catalog.jsonb_typeof(p_legacy_urls) = 'array' then p_legacy_urls
        else '[]'::jsonb
      end
    ) with ordinality as legacy_url(value, ordinality)
    where pg_catalog.jsonb_typeof(legacy_url.value) = 'string'
  ),
  combined as (
    select * from material_rows
    union all
    select * from legacy_rows
  ),
  deduplicated as (
    select distinct on (material_url)
      source_order,
      label,
      material_type,
      material_url,
      downloadable
    from combined
    where material_url is not null
    order by material_url, source_order
  ),
  numbered as (
    select
      source_order,
      label,
      material_type,
      material_url,
      downloadable,
      pg_catalog.row_number() over (
        order by source_order, material_url
      )::integer as material_order
    from deduplicated
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'label', coalesce(label, 'Campaign Material ' || material_order::text),
        'type', material_type,
        'url', material_url,
        'downloadable', downloadable
      )
      order by source_order, material_url
    ),
    '[]'::jsonb
  )
  from numbered;
$function$;

comment on function private.normalize_student_campaign_materials(jsonb, jsonb) is
  'Normalizes Student Campaign materials with strict JSON type guards and a fixed presentation-field allow-list.';

revoke all on function private.normalize_student_campaign_materials(jsonb, jsonb)
  from public;
revoke all on function private.normalize_student_campaign_materials(jsonb, jsonb)
  from anon;
revoke all on function private.normalize_student_campaign_materials(jsonb, jsonb)
  from authenticated;
revoke all on function private.normalize_student_campaign_materials(jsonb, jsonb)
  from service_role;

create function public.get_student_campaign(
  p_election_id integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  caller_uid uuid;
  matched_student_count integer;
  resolved_student_id integer;
  resolved_student_status text;
  active_academic_term_id integer;
  election_record record;
  participation_record record;
  now_manila timestamp without time zone;
  campaign_positions jsonb;
  campaign_candidates jsonb;
  response_data jsonb;
begin
  caller_uid := auth.uid();

  if caller_uid is null then
    return pg_catalog.jsonb_build_object(
      'status', 'UNAUTHORIZED',
      'reason', 'AUTHENTICATION_REQUIRED',
      'data', null
    );
  end if;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.min(s.id)
  into matched_student_count, resolved_student_id
  from public.students s
  where s.auth_user_id = caller_uid;

  if matched_student_count <> 1 then
    return pg_catalog.jsonb_build_object(
      'status', 'UNAUTHORIZED',
      'reason', 'STUDENT_ACCESS_DENIED',
      'data', null
    );
  end if;

  select s.status::text
  into resolved_student_status
  from public.students s
  where s.id = resolved_student_id
    and s.auth_user_id = caller_uid;

  if resolved_student_status is distinct from 'active' then
    return pg_catalog.jsonb_build_object(
      'status', 'UNAUTHORIZED',
      'reason', 'STUDENT_ACCESS_DENIED',
      'data', null
    );
  end if;

  if p_election_id is null then
    return pg_catalog.jsonb_build_object(
      'status', 'UNAVAILABLE',
      'reason', 'ELECTION_NOT_AVAILABLE',
      'data', null
    );
  end if;

  select
    e.id,
    e.title,
    e.cover_url,
    e.organization_id,
    e.campaign_start,
    e.campaign_end,
    e.status::text as election_status,
    o.name as organization_name,
    o.logo_url as organization_logo_url
  into election_record
  from public.elections e
  join public.organizations o
    on o.id = e.organization_id
  where e.id = p_election_id;

  if election_record.id is null
     or election_record.election_status is distinct from 'active' then
    return pg_catalog.jsonb_build_object(
      'status', 'UNAVAILABLE',
      'reason', 'ELECTION_NOT_AVAILABLE',
      'data', null
    );
  end if;

  select at.id
  into active_academic_term_id
  from public.academic_terms at
  where at.status = 'active'
  order by at.created_at desc, at.id desc
  limit 1;

  if active_academic_term_id is null then
    return pg_catalog.jsonb_build_object(
      'status', 'UNAVAILABLE',
      'reason', 'ELECTION_NOT_AVAILABLE',
      'data', null
    );
  end if;

  select participation.*
  into participation_record
  from public.resolve_student_organization_participation(
    resolved_student_id,
    election_record.organization_id,
    active_academic_term_id
  ) participation;

  if participation_record.allowed is distinct from true then
    return pg_catalog.jsonb_build_object(
      'status', 'UNAVAILABLE',
      'reason', 'ELECTION_NOT_AVAILABLE',
      'data', null
    );
  end if;

  if election_record.campaign_start is null
     or election_record.campaign_end is null then
    return pg_catalog.jsonb_build_object(
      'status', 'UNAVAILABLE',
      'reason', 'CAMPAIGN_SCHEDULE_MISSING',
      'data', null
    );
  end if;

  now_manila := pg_catalog.timezone(
    'Asia/Manila',
    pg_catalog.clock_timestamp()
  );

  if now_manila < election_record.campaign_start then
    return pg_catalog.jsonb_build_object(
      'status', 'UNAVAILABLE',
      'reason', 'CAMPAIGN_NOT_STARTED',
      'data', null
    );
  end if;

  if now_manila >= election_record.campaign_end then
    return pg_catalog.jsonb_build_object(
      'status', 'UNAVAILABLE',
      'reason', 'CAMPAIGN_ENDED',
      'data', null
    );
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', ordered_position.id,
        'name', ordered_position.name,
        'display_order', ordered_position.display_order,
        'max_votes', ordered_position.max_votes
      )
      order by ordered_position.display_order, ordered_position.id
    ),
    '[]'::jsonb
  )
  into campaign_positions
  from (
    select p.id, p.name, p.display_order, p.max_votes
    from public.positions p
    where p.election_id = election_record.id
      and p.status = 'active'
  ) ordered_position;

  with candidate_source as (
    select
      c.id,
      c.position_id,
      c.photo,
      c.bio,
      c.platform,
      c.credentials,
      c.campaign_materials,
      c.campaign_media_urls,
      p.display_order as position_display_order,
      s.first_name,
      s.last_name,
      s.photo_url as student_photo_url,
      pl.id as partylist_id,
      pl.name as partylist_name,
      pl.logo_url as partylist_logo_url,
      coalesce(
        nullif(
          pg_catalog.concat_ws(
            ' ',
            nullif(pg_catalog.btrim(s.first_name), ''),
            nullif(pg_catalog.btrim(s.last_name), '')
          ),
          ''
        ),
        'Candidate'
      ) as display_name
    from public.candidates c
    join public.positions p
      on p.id = c.position_id
     and p.election_id = election_record.id
     and p.status = 'active'
    join public.students s
      on s.id = c.student_id
    left join public.partylists pl
      on pl.id = c.partylist_id
     and pl.election_id = election_record.id
  ),
  ordered_candidates as (
    select candidate_source.*
    from candidate_source
    order by
      candidate_source.position_display_order,
      candidate_source.position_id,
      pg_catalog.lower(
        coalesce(candidate_source.partylist_name, 'Independent')
      ) collate "C",
      pg_catalog.lower(candidate_source.display_name) collate "C",
      candidate_source.id
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', ordered_candidate.id,
        'display_name', ordered_candidate.display_name,
        'photo_url', coalesce(
          ordered_candidate.photo,
          ordered_candidate.student_photo_url
        ),
        'position_id', ordered_candidate.position_id,
        'partylist', case
          when ordered_candidate.partylist_id is null then
            pg_catalog.jsonb_build_object(
              'id', null,
              'name', 'Independent',
              'logo_url', null
            )
          else
            pg_catalog.jsonb_build_object(
              'id', ordered_candidate.partylist_id,
              'name', ordered_candidate.partylist_name,
              'logo_url', ordered_candidate.partylist_logo_url
            )
        end,
        'bio', ordered_candidate.bio,
        'platform', ordered_candidate.platform,
        'credentials', ordered_candidate.credentials,
        'campaign_materials', private.normalize_student_campaign_materials(
          ordered_candidate.campaign_materials,
          ordered_candidate.campaign_media_urls
        )
      )
      order by
        ordered_candidate.position_display_order,
        ordered_candidate.position_id,
        pg_catalog.lower(
          coalesce(ordered_candidate.partylist_name, 'Independent')
        ) collate "C",
        pg_catalog.lower(ordered_candidate.display_name) collate "C",
        ordered_candidate.id
    ),
    '[]'::jsonb
  )
  into campaign_candidates
  from ordered_candidates ordered_candidate;

  response_data := pg_catalog.jsonb_build_object(
    'election', pg_catalog.jsonb_build_object(
      'id', election_record.id,
      'title', election_record.title,
      'cover_url', election_record.cover_url,
      'campaign_start', election_record.campaign_start,
      'campaign_end', election_record.campaign_end
    ),
    'organization', pg_catalog.jsonb_build_object(
      'id', election_record.organization_id,
      'name', election_record.organization_name,
      'logo_url', election_record.organization_logo_url
    ),
    'positions', campaign_positions,
    'candidates', campaign_candidates
  );

  if pg_catalog.jsonb_array_length(campaign_candidates) = 0 then
    return pg_catalog.jsonb_build_object(
      'status', 'EMPTY',
      'reason', 'NO_CANDIDATES',
      'data', response_data
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'AVAILABLE',
    'reason', null,
    'data', response_data
  );
end;
$function$;

comment on function public.get_student_campaign(integer) is
  'Authenticated Student Campaign contract. Identity comes from auth.uid(); current-term organization participation and the Manila [campaign_start, campaign_end) window are enforced server-side.';

revoke all on function public.get_student_campaign(integer) from public;
revoke all on function public.get_student_campaign(integer) from anon;
revoke all on function public.get_student_campaign(integer) from service_role;
grant execute on function public.get_student_campaign(integer) to authenticated;

notify pgrst, 'reload schema';

commit;
