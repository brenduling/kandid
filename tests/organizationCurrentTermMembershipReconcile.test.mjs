import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20261016000000_reconcile_membership_after_organization_configuration.sql",
    import.meta.url,
  ),
  "utf8",
);
const organizations = await readFile(
  new URL("../src/pages/superadmin/Organizations.jsx", import.meta.url),
  "utf8",
);
const organizationAccess = await readFile(
  new URL("../src/utils/organizationAccess.js", import.meta.url),
  "utf8",
);
const eligibility = await readFile(
  new URL("../supabase/functions/organization-eligibility/index.ts", import.meta.url),
  "utf8",
);

function functionBody(source, name, endMarker) {
  const start = source.indexOf(`create or replace function public.${name}(`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${name} is defined`);
  assert.notEqual(end, -1, `${name} end marker exists`);
  return source.slice(start, end);
}

test("organization coverage save reconciles only the target organization's active-term eligible students", () => {
  const sync = functionBody(
    migration,
    "kandid_sync_organization_memberships_for_current_term",
    "alter function public.kandid_sync_organization_memberships_for_current_term",
  );
  const replace = functionBody(
    migration,
    "kandid_replace_organization_program_coverage",
    "alter function public.kandid_replace_organization_program_coverage",
  );

  assert.match(sync, /a\.role = 'super_admin'[\s\S]*?a\.status = 'active'/i);
  assert.match(sync, /set search_path = pg_catalog/i);
  assert.match(sync, /t\.status = 'active'/i);
  assert.match(sync, /ste\.academic_term_id = active_term_id[\s\S]*?ste\.enrollment_status = 'enrolled'/i);
  assert.match(sync, /kandid_resolve_program_catalog_id\(e\.program\)/i);
  assert.match(sync, /organization_scope = 'institution'[\s\S]*?organization_scope = 'program'[\s\S]*?organization_programs op[\s\S]*?op\.organization_id = p_organization_id/i);
  assert.match(sync, /'active', 'system'[\s\S]*?on conflict \(student_id, organization_id, academic_term_id\) do nothing/i);
  assert.match(sync, /kandid\.membership_activation_term_id[\s\S]*?active_term_id::text/i);
  assert.match(sync, /on conflict \(student_id, organization_id\) do nothing/i);
  assert.doesNotMatch(sync, /delete from public\.(?:student_organization_terms|student_organizations)|update public\.(?:student_organization_terms|student_organizations)/i);

  assert.match(replace, /kandid_sync_organization_memberships_for_current_term\(organization_row\.id\)/i);
  assert.match(replace, /synchronized_membership_insert_count/i);
  assert.match(replace, /a\.role = 'super_admin'/i);
  assert.match(migration, /revoke all on function public\.kandid_sync_organization_memberships_for_current_term\(bigint\)[\s\S]*?from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant execute on function public\.kandid_replace_organization_program_coverage\(bigint, bigint\[\]\)[\s\S]*?to authenticated/i);
});

test("the existing Super Admin editor invokes the trusted configuration RPC and Student eligibility reads canonical term rows", () => {
  assert.match(organizations, /await saveOrganizationConfiguration\(/);
  assert.match(organizationAccess, /supabase\.rpc\(\s*"kandid_save_organization_configuration"/);
  assert.match(organizationAccess, /supabase\.rpc\(\s*"kandid_replace_organization_program_coverage"/);
  assert.match(eligibility, /from\("student_organization_terms"\)[\s\S]*?academic_term_id[\s\S]*?status", "active"/i);
  assert.match(eligibility, /resolve_student_organization_participation/);
  assert.match(migration, /^begin;[\s\S]*commit;\s*$/i);
  assert.doesNotMatch(migration, /public\.(?:elections|votes|vote_ballots|election_eligible_voters)/i);
});
