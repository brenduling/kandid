begin;

alter table public.students
  add column if not exists auth_user_id uuid
    references auth.users(id) on delete set null;

create unique index if not exists students_auth_user_id_unique_idx
  on public.students (auth_user_id)
  where auth_user_id is not null;

comment on column public.students.auth_user_id is
  'Nullable Supabase Auth identity link for student accounts. Legacy password login remains available during migration.';

notify pgrst, 'reload schema';

commit;
