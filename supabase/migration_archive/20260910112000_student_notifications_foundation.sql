begin;

create table if not exists public.student_notifications (
  id integer generated always as identity primary key,
  student_id integer not null
    references public.students(id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz null,
  constraint student_notifications_type_check
    check (type in ('organization_removed', 'organization_restored')),
  constraint student_notifications_read_state_check
    check (
      (is_read = false and read_at is null)
      or
      (is_read = true and read_at is not null)
    )
);

create index if not exists student_notifications_student_created_idx
  on public.student_notifications (student_id, created_at desc);

create index if not exists student_notifications_student_read_created_idx
  on public.student_notifications (student_id, is_read, created_at desc);

alter table public.student_notifications enable row level security;

revoke all on table public.student_notifications from public;
revoke all on table public.student_notifications from anon;
revoke all on table public.student_notifications from authenticated;

revoke all on sequence public.student_notifications_id_seq from public;
revoke all on sequence public.student_notifications_id_seq from anon;
revoke all on sequence public.student_notifications_id_seq from authenticated;

grant select, insert, update, delete on table public.student_notifications to service_role;
grant usage, select on sequence public.student_notifications_id_seq to service_role;

commit;
