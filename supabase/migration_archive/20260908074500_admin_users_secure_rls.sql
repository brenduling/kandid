alter table public.admin_users enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_users'
  loop
    execute format(
      'drop policy if exists %I on public.admin_users',
      policy_record.policyname
    );
  end loop;
end
$$;

revoke all on table public.admin_users from anon, authenticated;
grant select on table public.admin_users to authenticated;

create policy "Linked admins can read own safe profile"
  on public.admin_users
  for select
  to authenticated
  using (auth_user_id = auth.uid());

comment on table public.admin_users is
  'Administrative profiles. Direct browser writes are blocked after secure auth cutover; privileged mutations must use server-authorized Edge Functions.';

notify pgrst, 'reload schema';
