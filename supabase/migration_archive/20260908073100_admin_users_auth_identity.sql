alter table public.admin_users
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists admin_users_auth_user_id_unique_idx
  on public.admin_users (auth_user_id)
  where auth_user_id is not null;

create index if not exists admin_users_email_idx
  on public.admin_users (lower(email));

comment on column public.admin_users.password is
  'Legacy custom password field. Admin and board login must use Supabase Auth after secure identity migration.';

comment on column public.admin_users.auth_user_id is
  'Supabase Auth identity linked after secure onboarding. Nullable during staged migration.';

grant execute on function public.activate_academic_term(integer) to service_role;

notify pgrst, 'reload schema';
