create table if not exists public.programs (
  id bigserial primary key,
  code text not null unique,
  name text,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_programs (
  organization_id bigint not null references public.organizations(id) on delete cascade,
  program_id bigint not null references public.programs(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, program_id)
);

create index if not exists organization_programs_program_id_idx
  on public.organization_programs(program_id);

create index if not exists student_organizations_student_id_idx
  on public.student_organizations(student_id);

create index if not exists student_organizations_organization_id_idx
  on public.student_organizations(organization_id);

delete from public.student_organizations a
using public.student_organizations b
where a.ctid < b.ctid
  and a.student_id = b.student_id
  and a.organization_id = b.organization_id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'student_organizations_student_org_unique'
  ) then
    alter table public.student_organizations
      add constraint student_organizations_student_org_unique
      unique (student_id, organization_id);
  end if;
end $$;

insert into public.programs (code, name)
select distinct upper(trim(program)), upper(trim(program))
from public.students
where nullif(trim(coalesce(program, '')), '') is not null
on conflict (code) do nothing;

-- Legacy bootstrap only: converts the existing production naming convention
-- into explicit program coverage so runtime code no longer depends on names.
with legacy_map(organization_name, program_code) as (
  values
    ('PSITS', 'BSIT'),
    ('JPIA', 'BSA'),
    ('JMA', 'BSBA'),
    ('SHS', 'SHS'),
    ('JEHMS', 'BSHM')
)
insert into public.organization_programs (organization_id, program_id)
select organizations.id, programs.id
from legacy_map
join public.organizations
  on upper(trim(organizations.name)) = legacy_map.organization_name
join public.programs
  on upper(trim(programs.code)) = legacy_map.program_code
on conflict do nothing;

insert into public.student_organizations (student_id, organization_id, role)
select students.id, organizations.id, 'member'
from public.students
cross join public.organizations
where organizations.organization_type = 'non_departmental'
on conflict (student_id, organization_id) do nothing;

insert into public.student_organizations (student_id, organization_id, role)
select students.id, organization_programs.organization_id, 'member'
from public.students
join public.programs
  on upper(trim(students.program)) = upper(trim(programs.code))
join public.organization_programs
  on organization_programs.program_id = programs.id
on conflict (student_id, organization_id) do nothing;
