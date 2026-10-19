begin;

create schema if not exists private;

create table if not exists private.student_auth_rate_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint student_auth_rate_bucket_key_shape
    check (bucket_key ~ '^(ip|login|setup|verify):[0-9a-f]{64}$')
);
alter table private.student_auth_rate_buckets enable row level security;
create index if not exists student_auth_rate_buckets_updated_at_idx
  on private.student_auth_rate_buckets (updated_at);

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
revoke all on table private.student_auth_rate_buckets from public, anon, authenticated, service_role;

create or replace function public.kandid_consume_student_auth_rate_limit(
  p_requester_fingerprint text,
  p_student_fingerprint text,
  p_operation text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_allowed boolean;
begin
  if p_requester_fingerprint is null
     or p_student_fingerprint is null
     or p_requester_fingerprint !~ '^[0-9a-f]{64}$'
     or p_student_fingerprint !~ '^[0-9a-f]{64}$'
     or p_operation is null
     or p_operation not in ('login', 'setup', 'verify') then
    raise exception using errcode = '22023', message = 'Invalid rate-limit fingerprint.';
  end if;

  with limits(bucket_key, max_attempts) as (
    values
      ('ip:' || p_requester_fingerprint, 40)
    union all
    select p_operation || ':' || p_student_fingerprint,
      case when p_operation = 'setup' then 3 else 8 end
  ),
  upserted as (
    insert into private.student_auth_rate_buckets as buckets
      (bucket_key, window_started_at, attempts, updated_at)
    select limits.bucket_key, pg_catalog.clock_timestamp(), 1, pg_catalog.clock_timestamp()
    from limits
    order by limits.bucket_key
    on conflict (bucket_key) do update
      set attempts = case
            when buckets.window_started_at <= pg_catalog.clock_timestamp() - interval '15 minutes' then 1
            else buckets.attempts + 1
          end,
          window_started_at = case
            when buckets.window_started_at <= pg_catalog.clock_timestamp() - interval '15 minutes'
              then pg_catalog.clock_timestamp()
            else buckets.window_started_at
          end,
          updated_at = pg_catalog.clock_timestamp()
    returning buckets.bucket_key, buckets.attempts
  )
  select pg_catalog.bool_and(upserted.attempts <= limits.max_attempts)
    into v_allowed
  from upserted
  join limits using (bucket_key);

  delete from private.student_auth_rate_buckets
  where updated_at < pg_catalog.clock_timestamp() - interval '2 days';

  return coalesce(v_allowed, false);
end;
$function$;

alter function public.kandid_consume_student_auth_rate_limit(text, text, text) owner to postgres;
revoke all on function public.kandid_consume_student_auth_rate_limit(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.kandid_consume_student_auth_rate_limit(text, text, text)
  to service_role;

comment on function public.kandid_consume_student_auth_rate_limit(text, text, text) is
  'Atomically applies 15-minute server-side student-auth request limits using HMAC fingerprints; service_role only.';

notify pgrst, 'reload schema';

commit;
