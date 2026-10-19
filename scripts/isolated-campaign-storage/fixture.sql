\set ON_ERROR_STOP on
create schema private;
create schema storage;
create schema auth;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.admin_users (
 id integer primary key, auth_user_id uuid not null, role text not null,
 status text not null, organization_id bigint
);
create table public.elections (
 id integer primary key, organization_id bigint not null,
 status text not null default 'active', removed_at timestamptz
);
create table public.positions (id integer primary key, election_id integer not null);
create table public.candidates (
 id integer primary key, position_id integer not null,
 campaign_materials jsonb not null default '[]'::jsonb,
 campaign_media_urls jsonb not null default '[]'::jsonb
);
create table public.synthetic_student_campaign_access (
 auth_user_id uuid not null, election_id integer not null, allowed boolean not null,
 primary key(auth_user_id,election_id)
);
create table storage.buckets (
 id text primary key, name text not null, public boolean not null default false,
 file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
 id bigint generated always as identity primary key, bucket_id text not null,
 name text not null, owner_id text, metadata jsonb default '{}'::jsonb,
 unique(bucket_id,name)
);
alter table storage.objects enable row level security;
grant usage on schema public,storage,auth,private to authenticated,anon,service_role;
grant select,insert,update,delete on storage.objects to authenticated,anon,service_role;

create function private.kandid_active_admin_can_access_organization(p_org bigint)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select count(*)=1 and coalesce(bool_or(role='super_admin' or (role='electoral_board' and organization_id=p_org)),false)
 from public.admin_users where auth_user_id=auth.uid() and status='active'
$$;
create function public.kandid_can_mutate_election_positions(p_election integer)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.admin_users a join public.elections e on e.id=p_election
  where a.auth_user_id=auth.uid() and a.status='active'
   and (a.role='super_admin' or (a.role='electoral_board' and a.organization_id=e.organization_id))
   and e.removed_at is null and e.status in ('draft','active'))
$$;
create function public.get_student_campaign(p_election integer)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if exists(select 1 from public.synthetic_student_campaign_access a
   where a.auth_user_id=auth.uid() and a.election_id=p_election and a.allowed) then
  return jsonb_build_object('status','AVAILABLE','data',jsonb_build_object('candidates',coalesce((
   select jsonb_agg(jsonb_build_object('campaign_materials',c.campaign_materials))
   from public.candidates c join public.positions p on p.id=c.position_id where p.election_id=p_election
  ),'[]'::jsonb)));
 end if;
 return jsonb_build_object('status','UNAVAILABLE','data',null);
end $$;
grant execute on function private.kandid_active_admin_can_access_organization(bigint) to postgres;
grant execute on function public.kandid_can_mutate_election_positions(integer) to authenticated,postgres;
grant execute on function public.get_student_campaign(integer) to authenticated,postgres;

insert into public.admin_users values
 (1,'00000000-0000-4000-8000-000000000001','electoral_board','active',2),
 (2,'00000000-0000-4000-8000-000000000002','electoral_board','active',9),
 (3,'00000000-0000-4000-8000-000000000003','super_admin','active',null);
insert into public.elections(id,organization_id,status,removed_at) values
 (3,2,'active',null),(4,9,'active',null),(5,2,'active',now()),(6,2,'closed',null);
insert into public.positions values (30,3),(40,4),(50,5),(60,6);
insert into public.candidates(id,position_id) values (300,30),(400,40),(500,50),(600,60);
insert into public.synthetic_student_campaign_access values
 ('00000000-0000-4000-8000-000000000004',3,true),
 ('00000000-0000-4000-8000-000000000005',3,false);
