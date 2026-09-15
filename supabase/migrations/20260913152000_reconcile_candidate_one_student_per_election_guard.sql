begin;

create or replace function public.prevent_duplicate_candidate_per_election()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  target_election_id integer;
  duplicate_position text;
begin
  if new.student_id is null or new.position_id is null then
    return new;
  end if;

  select p.election_id
    into target_election_id
  from public.positions p
  where p.id = new.position_id;

  if target_election_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(target_election_id::integer, new.student_id::integer);

  select p.name
    into duplicate_position
  from public.candidates c
  join public.positions p
    on p.id = c.position_id
  where c.student_id = new.student_id
    and p.election_id = target_election_id
    and c.id is distinct from new.id
  order by p.id
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

notify pgrst, 'reload schema';

commit;
