-- Additional SYNTHETIC fixture objects, only in the runner's new isolated DB.
CREATE TABLE public.student_notifications (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id integer NOT NULL REFERENCES public.students(id),
  type text NOT NULL, title text NOT NULL, message text NOT NULL, metadata jsonb
);
INSERT INTO public.organizations VALUES (106,'Synthetic Manual Organization','non_departmental','manual');
INSERT INTO public.admin_users VALUES (6,'Synthetic Manual Board','electoral_board','active',106);

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_term_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_organization_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT ON public.students, public.academic_terms, public.admin_users,
  public.organizations, public.programs, public.organization_programs,
  public.student_term_enrollments, public.student_organization_terms TO service_role;
GRANT UPDATE (first_name,last_name) ON public.students TO service_role;
GRANT UPDATE ON public.student_organization_terms TO service_role;
GRANT INSERT ON public.student_notifications, public.audit_logs TO service_role;
-- INSERT ... RETURNING id in the participation RPC also requires SELECT. This
-- permission is already present in the verified production catalog.
GRANT SELECT ON public.student_notifications TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
REVOKE ALL ON public.students, public.student_term_enrollments,
  public.student_organization_terms, public.audit_logs FROM anon,authenticated;
