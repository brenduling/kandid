begin;

-- The updated enrollment/import Edge Functions now resolve catalog entries
-- through kandid_ensure_program_catalog_entry_for_server_actor. Retain the
-- service-role read used by Board enrollment validation, but remove its
-- temporary direct write and sequence privileges from the expand phase.
revoke all on table public.programs from service_role;
grant select on table public.programs to service_role;
revoke all on sequence public.programs_id_seq from service_role;

-- Execute permission on the audited server RPC remains granted to service_role
-- by the expand migration and is intentionally unchanged here.

commit;
