begin;

grant insert on table public.audit_logs to service_role;
grant usage on sequence public.audit_logs_id_seq to service_role;

commit;
