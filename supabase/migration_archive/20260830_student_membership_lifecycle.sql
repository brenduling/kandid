alter table public.student_organizations
  add column if not exists membership_status text not null default 'active',
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivation_reason text,
  add column if not exists reactivated_at timestamptz,
  add column if not exists removed_at timestamptz;

update public.student_organizations
set membership_status = 'active'
where membership_status is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'student_organizations_membership_status_check'
  ) then
    alter table public.student_organizations
      add constraint student_organizations_membership_status_check
      check (membership_status in ('active', 'inactive', 'removed'));
  end if;
end $$;

create index if not exists student_organizations_membership_status_idx
  on public.student_organizations(membership_status);

create index if not exists student_organizations_active_membership_idx
  on public.student_organizations(student_id, organization_id)
  where membership_status = 'active';
