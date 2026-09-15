alter table public.elections
  add column if not exists results_released_at timestamp with time zone,
  add column if not exists results_released_by uuid;

create or replace function public.kandid_server_time()
returns timestamp with time zone
language sql
stable
as $$
  select now();
$$;

grant execute on function public.kandid_server_time() to anon, authenticated;

create index if not exists elections_results_released_at_idx
  on public.elections (results_released_at);

create or replace function public.prevent_duplicate_candidate_per_election()
returns trigger
language plpgsql
as $$
declare
  target_election_id bigint;
  duplicate_position text;
begin
  if new.student_id is null or new.position_id is null then
    return new;
  end if;

  select election_id
    into target_election_id
  from public.positions
  where id = new.position_id;

  select positions.name
    into duplicate_position
  from public.candidates candidate
  join public.positions positions
    on positions.id = candidate.position_id
  where candidate.student_id = new.student_id
    and positions.election_id = target_election_id
    and candidate.id is distinct from new.id
  limit 1;

  if duplicate_position is not null then
    raise exception
      'This student is already a candidate for % in this election.',
      duplicate_position;
  end if;

  return new;
end;
$$;

drop trigger if exists candidates_one_student_per_election_guard
  on public.candidates;

create trigger candidates_one_student_per_election_guard
  before insert or update of student_id, position_id
  on public.candidates
  for each row
  execute function public.prevent_duplicate_candidate_per_election();
