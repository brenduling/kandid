begin;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;
grant usage on schema private to service_role;

alter table public.officers
  add column if not exists selection_type text;

alter table public.officers
  alter column selection_type drop default;

alter table public.officers
  drop constraint if exists officers_selection_type_check;

-- Preserve every approved stored classification. Missing or unsupported
-- legacy values remain unresolved rather than receiving inferred provenance.
update public.officers
set selection_type = 'legacy_unknown'
where selection_type is null
   or pg_catalog.btrim(selection_type) = ''
   or selection_type not in ('elected', 'appointed', 'other', 'legacy_unknown');

alter table public.officers
  alter column selection_type set default 'legacy_unknown',
  alter column selection_type set not null;

alter table public.officers
  add constraint officers_selection_type_check
  check (
    selection_type in (
      'elected',
      'appointed',
      'other',
      'legacy_unknown'
    )
  );

alter table public.officers
  add column if not exists election_id integer null;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conname = 'officers_election_id_fkey'
      and c.conrelid = 'public.officers'::pg_catalog.regclass
  ) then
    alter table public.officers
      add constraint officers_election_id_fkey
      foreign key (election_id)
      references public.elections(id)
      on delete set null;
  end if;
end
$$;

create index if not exists officers_election_id_idx
  on public.officers (election_id)
  where election_id is not null;

create table public.election_campaign_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  election_id integer not null,
  organization_id integer not null,
  schema_version text not null,
  capture_kind text not null,
  campaign_start timestamp without time zone not null,
  campaign_end timestamp without time zone not null,
  snapshot_data jsonb not null,
  content_hash text not null,
  captured_at timestamptz not null default pg_catalog.now(),
  constraint election_campaign_snapshots_election_fkey
    foreign key (election_id)
    references public.elections(id)
    on delete restrict,
  constraint election_campaign_snapshots_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,
  constraint election_campaign_snapshots_schema_version_check
    check (schema_version = 'KANDID_CAMPAIGN_SNAPSHOT_V1'),
  constraint election_campaign_snapshots_capture_kind_check
    check (capture_kind in ('official_campaign_end', 'legacy_current_state')),
  constraint election_campaign_snapshots_schedule_check
    check (campaign_end >= campaign_start),
  constraint election_campaign_snapshots_data_check
    check (pg_catalog.jsonb_typeof(snapshot_data) = 'object'),
  constraint election_campaign_snapshots_content_hash_check
    check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint election_campaign_snapshots_election_capture_unique
    unique (election_id, capture_kind),
  constraint election_campaign_snapshots_identity_scope_unique
    unique (id, election_id, organization_id)
);

create index election_campaign_snapshots_organization_captured_idx
  on public.election_campaign_snapshots (organization_id, captured_at desc);

create table public.election_officer_publications (
  id uuid primary key default extensions.gen_random_uuid(),
  election_id integer not null,
  organization_id integer not null,
  campaign_snapshot_id uuid not null,
  published_by_admin_user_id integer not null,
  schema_version text not null,
  content_hash text not null,
  published_at timestamptz not null default pg_catalog.now(),
  constraint election_officer_publications_election_fkey
    foreign key (election_id)
    references public.elections(id)
    on delete restrict,
  constraint election_officer_publications_organization_fkey
    foreign key (organization_id)
    references public.organizations(id)
    on delete restrict,
  constraint election_officer_publications_snapshot_scope_fkey
    foreign key (campaign_snapshot_id, election_id, organization_id)
    references public.election_campaign_snapshots(id, election_id, organization_id)
    on delete restrict,
  constraint election_officer_publications_actor_fkey
    foreign key (published_by_admin_user_id)
    references public.admin_users(id)
    on delete restrict,
  constraint election_officer_publications_schema_version_check
    check (schema_version = 'KANDID_OFFICER_PUBLICATION_V1'),
  constraint election_officer_publications_content_hash_check
    check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint election_officer_publications_election_unique
    unique (election_id),
  constraint election_officer_publications_snapshot_unique
    unique (campaign_snapshot_id)
);

create index election_officer_publications_organization_published_idx
  on public.election_officer_publications (organization_id, published_at desc);

create table public.election_officer_publication_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  publication_id uuid not null,
  source_officer_id integer null,
  display_order integer not null,
  display_name text not null,
  position_title text not null,
  photo_url text null,
  term_label text null,
  term_start date null,
  term_end date null,
  selection_type text not null,
  constraint election_officer_publication_entries_publication_fkey
    foreign key (publication_id)
    references public.election_officer_publications(id)
    on delete restrict,
  constraint election_officer_publication_entries_source_officer_fkey
    foreign key (source_officer_id)
    references public.officers(id)
    on delete set null,
  constraint election_officer_publication_entries_display_order_check
    check (display_order >= 0),
  constraint election_officer_publication_entries_display_name_check
    check (pg_catalog.btrim(display_name) <> ''),
  constraint election_officer_publication_entries_position_title_check
    check (pg_catalog.btrim(position_title) <> ''),
  constraint election_officer_publication_entries_selection_type_check
    check (
      selection_type in (
        'elected',
        'appointed',
        'other',
        'legacy_unknown'
      )
    ),
  constraint election_officer_publication_entries_order_unique
    unique (publication_id, display_order)
);

create unique index election_officer_publication_entries_source_unique_idx
  on public.election_officer_publication_entries (publication_id, source_officer_id)
  where source_officer_id is not null;

alter table public.election_campaign_snapshots enable row level security;
alter table public.election_officer_publications enable row level security;
alter table public.election_officer_publication_entries enable row level security;

revoke all on table public.election_campaign_snapshots from public;
revoke all on table public.election_campaign_snapshots from anon;
revoke all on table public.election_campaign_snapshots from authenticated;
revoke all on table public.election_campaign_snapshots from service_role;
revoke all on table public.election_officer_publications from public;
revoke all on table public.election_officer_publications from anon;
revoke all on table public.election_officer_publications from authenticated;
revoke all on table public.election_officer_publications from service_role;
revoke all on table public.election_officer_publication_entries from public;
revoke all on table public.election_officer_publication_entries from anon;
revoke all on table public.election_officer_publication_entries from authenticated;
revoke all on table public.election_officer_publication_entries from service_role;

create function private.reject_historical_record_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using
    errcode = '55000',
    message = pg_catalog.format(
      '%s records are immutable; use a reviewed migration for exceptional maintenance.',
      tg_table_name
    );
end;
$function$;

revoke all on function private.reject_historical_record_mutation() from public;
revoke all on function private.reject_historical_record_mutation() from anon;
revoke all on function private.reject_historical_record_mutation() from authenticated;
revoke all on function private.reject_historical_record_mutation() from service_role;

create trigger election_campaign_snapshots_immutable
before update or delete on public.election_campaign_snapshots
for each row execute function private.reject_historical_record_mutation();

create trigger election_officer_publications_immutable
before update or delete on public.election_officer_publications
for each row execute function private.reject_historical_record_mutation();

create trigger election_officer_publication_entries_immutable
before update or delete on public.election_officer_publication_entries
for each row execute function private.reject_historical_record_mutation();

create function private.normalize_campaign_materials(
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
          then nullif(pg_catalog.btrim(material.value ->> 'label'), '')
        else null
      end as label,
      case
        when pg_catalog.jsonb_typeof(material.value) = 'object'
         and material.value ->> 'type' in ('document', 'media', 'link')
          then material.value ->> 'type'
        else 'link'
      end as material_type,
      case
        when pg_catalog.jsonb_typeof(material.value) = 'string'
          then nullif(pg_catalog.btrim(material.value #>> '{}'), '')
        when pg_catalog.jsonb_typeof(material.value) = 'object'
          then nullif(pg_catalog.btrim(material.value ->> 'url'), '')
        else null
      end as material_url,
      case
        when pg_catalog.jsonb_typeof(material.value) = 'object'
         and pg_catalog.lower(coalesce(material.value ->> 'downloadable', '')) = 'true'
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

revoke all on function private.normalize_campaign_materials(jsonb, jsonb) from public;
revoke all on function private.normalize_campaign_materials(jsonb, jsonb) from anon;
revoke all on function private.normalize_campaign_materials(jsonb, jsonb) from authenticated;
revoke all on function private.normalize_campaign_materials(jsonb, jsonb) from service_role;

create function private.create_election_campaign_snapshot(
  p_election_id integer,
  p_capture_kind text default 'official_campaign_end'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  existing_snapshot_id uuid;
  snapshot_id uuid;
  election_record record;
  snapshot_positions jsonb;
  snapshot_candidates jsonb;
  snapshot_data jsonb;
  snapshot_hash text;
  now_manila timestamp without time zone;
begin
  if p_election_id is null then
    raise exception 'Election is required.';
  end if;

  if p_capture_kind is null
     or p_capture_kind not in ('official_campaign_end', 'legacy_current_state') then
    raise exception 'Unsupported campaign snapshot capture kind.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(5101, p_election_id);

  select s.id
  into existing_snapshot_id
  from public.election_campaign_snapshots s
  where s.election_id = p_election_id
    and s.capture_kind = p_capture_kind;

  if existing_snapshot_id is not null then
    return existing_snapshot_id;
  end if;

  select
    e.id,
    e.title,
    e.organization_id,
    e.campaign_start,
    e.campaign_end,
    o.name as organization_name,
    o.logo_url as organization_logo_url
  into election_record
  from public.elections e
  join public.organizations o
    on o.id = e.organization_id
  where e.id = p_election_id
  for share of e, o;

  if election_record.id is null then
    raise exception 'Election not found.';
  end if;

  if election_record.campaign_start is null
     or election_record.campaign_end is null then
    raise exception 'Election campaign schedule is incomplete.';
  end if;

  now_manila := pg_catalog.timezone('Asia/Manila', pg_catalog.clock_timestamp());

  if p_capture_kind = 'official_campaign_end'
     and now_manila < election_record.campaign_end then
    raise exception 'Official campaign snapshot cannot be captured before campaign end.';
  end if;

  with ordered_positions as (
    select
      p.id,
      p.name,
      p.display_order,
      pg_catalog.row_number() over (
        order by p.display_order, p.id
      )::integer as archive_ordinal
    from public.positions p
    where p.election_id = p_election_id
      and p.status = 'active'
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'source_position_id', op.id,
        'name', op.name,
        'display_order', op.display_order,
        'archive_ordinal', op.archive_ordinal
      )
      order by op.archive_ordinal
    ),
    '[]'::jsonb
  )
  into snapshot_positions
  from ordered_positions op;

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
      p.name as position_name,
      p.display_order as position_display_order,
      s.first_name,
      s.last_name,
      s.photo_url as student_photo_url,
      pl.id as partylist_id,
      pl.name as partylist_name,
      pl.logo_url as partylist_logo_url,
      pg_catalog.concat_ws(' ', nullif(pg_catalog.btrim(s.first_name), ''), nullif(pg_catalog.btrim(s.last_name), '')) as display_name
    from public.candidates c
    join public.positions p
      on p.id = c.position_id
    join public.students s
      on s.id = c.student_id
    left join public.partylists pl
      on pl.id = c.partylist_id
    where p.election_id = p_election_id
      and p.status = 'active'
  ),
  ordered_candidates as (
    select
      cs.*,
      pg_catalog.row_number() over (
        order by
          cs.position_display_order,
          cs.position_id,
          pg_catalog.lower(coalesce(cs.partylist_name, 'Independent')) collate "C",
          pg_catalog.lower(cs.display_name) collate "C",
          cs.id
      )::integer as archive_ordinal
    from candidate_source cs
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'source_candidate_id', oc.id,
        'archive_ordinal', oc.archive_ordinal,
        'display_name', oc.display_name,
        'photo_url', coalesce(oc.photo, oc.student_photo_url),
        'position', pg_catalog.jsonb_build_object(
          'source_position_id', oc.position_id,
          'name', oc.position_name,
          'display_order', oc.position_display_order
        ),
        'partylist', case
          when oc.partylist_id is null then pg_catalog.jsonb_build_object(
            'source_partylist_id', null,
            'name', 'Independent',
            'logo_url', null
          )
          else pg_catalog.jsonb_build_object(
            'source_partylist_id', oc.partylist_id,
            'name', oc.partylist_name,
            'logo_url', oc.partylist_logo_url
          )
        end,
        'bio', oc.bio,
        'platform', oc.platform,
        'credentials', oc.credentials,
        'campaign_materials', private.normalize_campaign_materials(
          oc.campaign_materials,
          oc.campaign_media_urls
        )
      )
      order by oc.archive_ordinal
    ),
    '[]'::jsonb
  )
  into snapshot_candidates
  from ordered_candidates oc;

  snapshot_data := pg_catalog.jsonb_build_object(
    'schema_version', 'KANDID_CAMPAIGN_SNAPSHOT_V1',
    'capture_kind', p_capture_kind,
    'election', pg_catalog.jsonb_build_object(
      'source_election_id', election_record.id,
      'title', election_record.title,
      'campaign_start', election_record.campaign_start,
      'campaign_end', election_record.campaign_end
    ),
    'organization', pg_catalog.jsonb_build_object(
      'source_organization_id', election_record.organization_id,
      'name', election_record.organization_name,
      'logo_url', election_record.organization_logo_url
    ),
    'positions', snapshot_positions,
    'candidates', snapshot_candidates
  );

  snapshot_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(snapshot_data::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into public.election_campaign_snapshots (
    election_id,
    organization_id,
    schema_version,
    capture_kind,
    campaign_start,
    campaign_end,
    snapshot_data,
    content_hash
  ) values (
    election_record.id,
    election_record.organization_id,
    'KANDID_CAMPAIGN_SNAPSHOT_V1',
    p_capture_kind,
    election_record.campaign_start,
    election_record.campaign_end,
    snapshot_data,
    snapshot_hash
  )
  returning id into snapshot_id;

  return snapshot_id;
end;
$function$;

revoke all on function private.create_election_campaign_snapshot(integer, text)
  from public;
revoke all on function private.create_election_campaign_snapshot(integer, text)
  from anon;
revoke all on function private.create_election_campaign_snapshot(integer, text)
  from authenticated;
grant execute on function private.create_election_campaign_snapshot(integer, text)
  to service_role;

notify pgrst, 'reload schema';

commit;
