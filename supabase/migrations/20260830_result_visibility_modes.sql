alter table public.elections
  add column if not exists student_result_visibility text not null default 'after_close',
  add column if not exists results_released_at timestamp with time zone,
  add column if not exists results_released_by uuid;

update public.elections
set student_result_visibility = 'after_close'
where student_result_visibility is null
   or student_result_visibility = 'hidden';

alter table public.elections
  alter column student_result_visibility set default 'after_close';

alter table public.elections
  drop constraint if exists elections_student_result_visibility_check;

alter table public.elections
  add constraint elections_student_result_visibility_check
  check (student_result_visibility in ('realtime', 'after_close', 'manual'));

create index if not exists elections_results_released_at_idx
  on public.elections (results_released_at);
