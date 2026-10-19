-- TEST FIXTURE ONLY. Exact missing schema dependency inspected read-only on
-- fszgdxqxonqqcrzsnkca on 2026-10-18. No application or Auth data copied.
-- This is a production-compatible fixture, not a historical migration source.
DO $isolation$ BEGIN
 IF current_database() NOT LIKE 'kandid_soft_removal_release_%' OR inet_server_addr() IS NOT NULL THEN
  RAISE EXCEPTION 'This fixture may run only in the fresh local release validation database.';
 END IF;
END $isolation$;
-- Official elections ACL already grants authenticated table SELECT. The older
-- disposable source had only column SELECT grants, which do not include a new
-- marker column. Match the official baseline here, never in production.
GRANT SELECT ON public.elections TO authenticated;
CREATE OR REPLACE FUNCTION public.kandid_guard_organization_reference()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
 SET row_security TO 'off'
AS $function$
declare
  raw_id text;
  organization_key bigint;
  parent_exists boolean;
begin
  raw_id := pg_catalog.to_jsonb(new) ->> tg_argv[0];
  if raw_id is null then return new; end if;
  begin
    organization_key := raw_id::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '23503', message = 'Organization reference is invalid.';
  end;
  if organization_key <= 0 then
    raise exception using errcode = '23503', message = 'Organization reference is invalid.';
  end if;
  select true into parent_exists
  from public.organizations o
  where o.id = organization_key
  for key share;
  if not coalesce(parent_exists, false) then
    raise exception using errcode = '23503', message = 'Referenced organization does not exist.';
  end if;
  return new;
end;
$function$;
ALTER FUNCTION public.kandid_guard_organization_reference() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.kandid_guard_organization_reference() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER organization_parent_guard_archived_elections_organization_id
AFTER INSERT OR UPDATE ON public.archived_elections FOR EACH ROW
EXECUTE FUNCTION public.kandid_guard_organization_reference('organization_id');

-- Match the already reviewed production policy definitions in this fresh clone.
DO $policies$
DECLARE item record;
BEGIN
 FOR item IN SELECT p.polname,p.polrelid FROM pg_policy p
 WHERE p.polrelid IN ('public.elections'::regclass,'public.positions'::regclass,'public.candidates'::regclass,'public.candidate_media'::regclass,'public.partylists'::regclass,'public.eligibility_rules'::regclass,'public.election_access_tokens'::regclass,'public.election_campaign_snapshots'::regclass,'public.votes'::regclass,'public.vote_ballots'::regclass,'public.officers'::regclass,'public.officer_new_roster'::regclass,'public.officer_leadership_releases'::regclass,'public.election_officer_publications'::regclass,'public.election_officer_publication_entries'::regclass,'public.archived_elections'::regclass,'private.election_eligible_voters'::regclass)
 LOOP EXECUTE format('DROP POLICY %I ON %s',item.polname,item.polrelid::regclass); END LOOP;
END
$policies$;
CREATE POLICY "archived_elections_super_admin_delete" ON "public"."archived_elections" AS PERMISSIVE FOR DELETE TO "authenticated"
USING ((EXISTS ( SELECT 1
   FROM public.admin_users a
  WHERE ((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text) AND ((a.role)::text = 'super_admin'::text)))));
CREATE POLICY "archived_elections_super_admin_read" ON "public"."archived_elections" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((EXISTS ( SELECT 1
   FROM public.admin_users a
  WHERE ((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text) AND ((a.role)::text = 'super_admin'::text)))));
CREATE POLICY "candidate_media_public_read" ON "public"."candidate_media" AS PERMISSIVE FOR SELECT TO "anon","authenticated"
USING (true);
CREATE POLICY "candidates_delete_authorized_election" ON "public"."candidates" AS PERMISSIVE FOR DELETE TO "authenticated"
USING (((position_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.positions p
  WHERE ((p.id = candidates.position_id) AND public.kandid_can_mutate_election_positions(p.election_id))))));
CREATE POLICY "candidates_insert_authorized_election" ON "public"."candidates" AS PERMISSIVE FOR INSERT TO "authenticated"
WITH CHECK (((position_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM public.positions p
  WHERE ((p.id = candidates.position_id) AND public.kandid_can_mutate_election_positions(p.election_id))))));
CREATE POLICY "candidates_public_read" ON "public"."candidates" AS PERMISSIVE FOR SELECT TO "anon","authenticated"
USING (true);
CREATE POLICY "candidates_update_authorized_election" ON "public"."candidates" AS PERMISSIVE FOR UPDATE TO "authenticated"
USING (((position_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.positions p
  WHERE ((p.id = candidates.position_id) AND public.kandid_can_mutate_election_positions(p.election_id))))))
WITH CHECK (((position_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.positions p
  WHERE ((p.id = candidates.position_id) AND public.kandid_can_mutate_election_positions(p.election_id))))));
CREATE POLICY "election_access_tokens_insert_admin_scope" ON "public"."election_access_tokens" AS PERMISSIVE FOR INSERT TO "authenticated"
WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.elections e
     JOIN public.admin_users a ON (((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text))))
  WHERE ((e.id = election_access_tokens.election_id) AND (((a.role)::text = 'super_admin'::text) OR (((a.role)::text = 'electoral_board'::text) AND (a.organization_id = e.organization_id)))))));
CREATE POLICY "election_access_tokens_read_admin_scope" ON "public"."election_access_tokens" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((EXISTS ( SELECT 1
   FROM (public.elections e
     JOIN public.admin_users a ON (((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text))))
  WHERE ((e.id = election_access_tokens.election_id) AND (((a.role)::text = 'super_admin'::text) OR (((a.role)::text = 'electoral_board'::text) AND (a.organization_id = e.organization_id)))))));
CREATE POLICY "election_access_tokens_update_admin_scope" ON "public"."election_access_tokens" AS PERMISSIVE FOR UPDATE TO "authenticated"
USING ((EXISTS ( SELECT 1
   FROM (public.elections e
     JOIN public.admin_users a ON (((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text))))
  WHERE ((e.id = election_access_tokens.election_id) AND (((a.role)::text = 'super_admin'::text) OR (((a.role)::text = 'electoral_board'::text) AND (a.organization_id = e.organization_id)))))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.elections e
     JOIN public.admin_users a ON (((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text))))
  WHERE ((e.id = election_access_tokens.election_id) AND (((a.role)::text = 'super_admin'::text) OR (((a.role)::text = 'electoral_board'::text) AND (a.organization_id = e.organization_id)))))));
CREATE POLICY "elections_delete_active_admin_scope" ON "public"."elections" AS PERMISSIVE FOR DELETE TO "authenticated"
USING ((EXISTS ( SELECT 1
   FROM public.admin_users a
  WHERE ((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text) AND (((a.role)::text = 'super_admin'::text) OR (((a.role)::text = 'electoral_board'::text) AND (a.organization_id = elections.organization_id)))))));
CREATE POLICY "elections_insert_active_admin_scope" ON "public"."elections" AS PERMISSIVE FOR INSERT TO "authenticated"
WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admin_users a
  WHERE ((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text) AND (((a.role)::text = 'super_admin'::text) OR (((a.role)::text = 'electoral_board'::text) AND (a.organization_id = elections.organization_id)))))));
CREATE POLICY "elections_public_read" ON "public"."elections" AS PERMISSIVE FOR SELECT TO "anon","authenticated"
USING (true);
CREATE POLICY "elections_update_active_admin_scope" ON "public"."elections" AS PERMISSIVE FOR UPDATE TO "authenticated"
USING ((EXISTS ( SELECT 1
   FROM public.admin_users a
  WHERE ((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text) AND (((a.role)::text = 'super_admin'::text) OR (((a.role)::text = 'electoral_board'::text) AND (a.organization_id = elections.organization_id)))))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM public.admin_users a
  WHERE ((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text) AND (((a.role)::text = 'super_admin'::text) OR (((a.role)::text = 'electoral_board'::text) AND (a.organization_id = elections.organization_id)))))));
CREATE POLICY "eligibility_rules_admin_delete" ON "public"."eligibility_rules" AS PERMISSIVE FOR DELETE TO "authenticated"
USING ((EXISTS ( SELECT 1
   FROM (public.elections e
     JOIN public.admin_users a ON (((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text))))
  WHERE ((e.id = eligibility_rules.election_id) AND (((a.role)::text = 'super_admin'::text) OR (((a.role)::text = 'electoral_board'::text) AND (a.organization_id = e.organization_id)))))));
CREATE POLICY "eligibility_rules_admin_insert" ON "public"."eligibility_rules" AS PERMISSIVE FOR INSERT TO "authenticated"
WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.elections e
     JOIN public.admin_users a ON (((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text))))
  WHERE ((e.id = eligibility_rules.election_id) AND (((a.role)::text = 'super_admin'::text) OR (((a.role)::text = 'electoral_board'::text) AND (a.organization_id = e.organization_id)))))));
CREATE POLICY "eligibility_rules_admin_update" ON "public"."eligibility_rules" AS PERMISSIVE FOR UPDATE TO "authenticated"
USING ((EXISTS ( SELECT 1
   FROM (public.elections e
     JOIN public.admin_users a ON (((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text))))
  WHERE ((e.id = eligibility_rules.election_id) AND (((a.role)::text = 'super_admin'::text) OR (((a.role)::text = 'electoral_board'::text) AND (a.organization_id = e.organization_id)))))))
WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.elections e
     JOIN public.admin_users a ON (((a.auth_user_id = auth.uid()) AND ((a.status)::text = 'active'::text))))
  WHERE ((e.id = eligibility_rules.election_id) AND (((a.role)::text = 'super_admin'::text) OR (((a.role)::text = 'electoral_board'::text) AND (a.organization_id = e.organization_id)))))));
CREATE POLICY "eligibility_rules_signed_in_read" ON "public"."eligibility_rules" AS PERMISSIVE FOR SELECT TO "authenticated"
USING ((auth.uid() IS NOT NULL));
CREATE POLICY "partylists_delete_authorized_organization" ON "public"."partylists" AS PERMISSIVE FOR DELETE TO "authenticated"
USING (public.kandid_can_mutate_organization_partylists(organization_id));
CREATE POLICY "partylists_insert_authorized_organization" ON "public"."partylists" AS PERMISSIVE FOR INSERT TO "authenticated"
WITH CHECK (((organization_id IS NOT NULL) AND public.kandid_can_mutate_organization_partylists(organization_id)));
CREATE POLICY "partylists_public_read" ON "public"."partylists" AS PERMISSIVE FOR SELECT TO "anon","authenticated"
USING (true);
CREATE POLICY "partylists_update_authorized_organization" ON "public"."partylists" AS PERMISSIVE FOR UPDATE TO "authenticated"
USING (public.kandid_can_mutate_organization_partylists(organization_id))
WITH CHECK (public.kandid_can_mutate_organization_partylists(organization_id));
CREATE POLICY "positions_delete_authorized_election" ON "public"."positions" AS PERMISSIVE FOR DELETE TO "authenticated"
USING (public.kandid_can_mutate_election_positions(election_id));
CREATE POLICY "positions_insert_authorized_election" ON "public"."positions" AS PERMISSIVE FOR INSERT TO "authenticated"
WITH CHECK (public.kandid_can_mutate_election_positions(election_id));
CREATE POLICY "positions_public_read" ON "public"."positions" AS PERMISSIVE FOR SELECT TO "anon","authenticated"
USING (true);
CREATE POLICY "positions_update_authorized_election" ON "public"."positions" AS PERMISSIVE FOR UPDATE TO "authenticated"
USING (public.kandid_can_mutate_election_positions(election_id))
WITH CHECK (public.kandid_can_mutate_election_positions(election_id));
