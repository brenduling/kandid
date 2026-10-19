import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  normalizeDeletionReadiness,
  normalizeOrganizationDelete,
} from "../src/utils/organizationDeletionState.js";

const migration = await readFile(
  new URL("../supabase/migrations/20261002160000_trusted_organization_deletion_contract.sql", import.meta.url),
  "utf8",
);
const organizationsPage = await readFile(
  new URL("../src/pages/superadmin/Organizations.jsx", import.meta.url),
  "utf8",
);
const deletionService = await readFile(
  new URL("../src/utils/organizationDeletion.js", import.meta.url),
  "utf8",
);
const deletionState = await readFile(
  new URL("../src/utils/organizationDeletionState.js", import.meta.url),
  "utf8",
);

function functionBody(name) {
  const start = migration.indexOf(`function public.${name}`);
  assert.notEqual(start, -1, `${name} definition exists`);
  const end = migration.indexOf("$function$;", start);
  assert.notEqual(end, -1, `${name} definition is complete`);
  return migration.slice(start, end);
}

test("readiness is Super Admin-only, aggregate-only, and uses a safe definer path", () => {
  const body = functionBody("kandid_get_organization_deletion_readiness");
  assert.match(body, /security definer\s+set search_path = pg_catalog/i);
  assert.match(body, /auth\.uid\(\)/i);
  assert.match(body, /a\.role = 'super_admin'/i);
  assert.match(body, /a\.status = 'active'/i);
  assert.match(body, /active_admin_count <> 1/i);
  assert.match(body, /p_organization_id is null or p_organization_id <= 0/i);
  assert.match(body, /'can_delete', pg_catalog\.jsonb_array_length\(dependencies\) = 0 and not verification_required/i);
  assert.match(body, /'count',null/i);
  assert.match(body, /'verification_required', verification_required/i);
  assert.doesNotMatch(body, /student_id|student_name|ballot|vote_hash|receipt/i);
});

test("FK discovery covers all referenced organization keys and composite relationships", () => {
  const body = functionBody("kandid_get_organization_deletion_readiness");
  assert.match(body, /pg_catalog\.pg_constraint/i);
  assert.match(body, /con\.confrelid = 'public\.organizations'::pg_catalog\.regclass/i);
  assert.doesNotMatch(body, /target_attr\.attname\s*=\s*'id'/i);
  assert.match(body, /generate_subscripts\(fk\.conkey, 1\) pair\(ordinality\)/i);
  assert.match(body, /fk\.conkey\[pair\.ordinality\]/i);
  assert.match(body, /fk\.confkey\[pair\.ordinality\]/i);
  assert.match(body, /array_lower\(fk\.conkey, 1\) is distinct from pg_catalog\.array_lower\(fk\.confkey, 1\)/i);
  assert.doesNotMatch(body, /unnest\(fk\.conkey, fk\.confkey\)/i);
  assert.match(body, /'referenced_columns',referenced_columns/i);
  assert.match(body, /'on_delete'/i);
  assert.match(body, /'system_dependency'/i);
  assert.match(body, /'historical_preserved'/i);
  assert.match(body, /'administratively_resolvable'/i);
  assert.match(body, /where o\.id = \$1[\s\S]*?using organization_row\.id/i);
  assert.doesNotMatch(body, /execute pg_catalog\.format\([\s\S]*?using p_organization_id/i);
  assert.match(body, /if dependency_count > 0 then/i);
  assert.match(body, /exception when others then[\s\S]*?'verification_required'[\s\S]*?'count',null/i);
});

test("final delete rechecks readiness under the parent row lock and never cleans dependencies", () => {
  const body = functionBody("kandid_delete_organization");
  assert.match(body, /security definer\s+set search_path = pg_catalog/i);
  assert.match(body, /auth\.uid\(\)/i);
  assert.match(body, /a\.role = 'super_admin'/i);
  assert.match(body, /a\.status = 'active'/i);
  assert.match(body, /active_admin_count <> 1/i);
  assert.match(body, /for update/i);
  assert.doesNotMatch(body, /lock table/i);
  assert.match(body, /public\.kandid_get_organization_deletion_readiness\(p_organization_id\)/i);
  assert.match(body, /readiness ->> 'can_delete'/i);
  assert.ok(
    body.indexOf("return pg_catalog.jsonb_build_object(\n      'deleted', false") <
      body.indexOf("delete from public.organizations"),
    "blocked readiness returns before any delete statement",
  );
  assert.match(body, /delete from public\.organizations/i);
  assert.doesNotMatch(body, /delete from public\.(student_organizations|organization_programs|elections|officers|partylists)/i);
  assert.doesNotMatch(body, /insert into public\.audit_logs/i);
});

test("direct DELETE grants are revoked while only authenticated can execute the trusted RPCs", () => {
  assert.match(migration, /revoke delete on table public\.organizations from public, anon, authenticated, service_role/i);
  for (const signature of [
    "kandid_get_organization_deletion_readiness(bigint)",
    "kandid_delete_organization(bigint)",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, "\\$&")}\\s+from public, anon, authenticated, service_role`, "i"),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, "\\$&")}\\s+to authenticated`, "i"),
    );
  }
  assert.match(migration, /existing AFTER DELETE trusted audit trigger records exactly one/i);
  assert.match(migration, /organization_deleted event/i);
});

test("explicit registry preserves elections, memberships, assignments, partylists, and officer history", () => {
  const registry = functionBody("kandid_organization_deletion_registry");
  for (const [table, category] of [
    ["student_organizations", "student_memberships"],
    ["organization_programs", "program_coverage"],
    ["elections", "election_history"],
    ["archived_elections", "archived_election_history"],
    ["admin_users", "board_assignments"],
    ["partylists", "partylists"],
    ["officer_new_roster", "prepared_officers"],
    ["officers", "officer_history"],
    ["officer_leadership_releases", "leadership_releases"],
    ["election_campaign_snapshots", "campaign_snapshots"],
    ["election_officer_publications", "officer_publications"],
  ]) {
    assert.match(registry, new RegExp(`'${table}','organization_id',[^,]*,'${category}'`));
  }
  assert.match(registry, /historical_preserved/i);
  assert.match(registry, /administratively_resolvable/i);
});

test("typed organization registry matches mixed production identifier widths", () => {
  const registry = functionBody("kandid_organization_deletion_registry");
  const expectedTypes = new Map([
    ["elections", "integer"],
    ["archived_elections", "integer"],
    ["admin_users", "integer"],
    ["officers", "integer"],
    ["organization_programs", "bigint"],
    ["student_organizations", "integer"],
    ["student_organization_terms", "integer"],
    ["partylists", "bigint"],
    ["officer_new_roster", "bigint"],
    ["officer_leadership_releases", "bigint"],
    ["election_campaign_snapshots", "integer"],
    ["election_officer_publications", "integer"],
  ]);

  for (const [table, type] of expectedTypes) {
    assert.match(
      registry,
      new RegExp(`'public','${table}','organization_id','${type}'`),
      `${table}.organization_id is represented as ${type}`,
    );
  }
  assert.doesNotMatch(registry, /'public','officers','organization_id','bigint'/);
  assert.doesNotMatch(registry, /integer-family/);
  assert.match(migration, /if actual_type is null or actual_type <> r\.expected_type then/i);
  assert.match(migration, /format_type\(a\.atttypid, a\.atttypmod\) = ref\.expected_type/i);
});

test("registry validation rejects missing/non-table objects and installs non-FK guards on the correct relation", () => {
  assert.match(migration, /actual_type is null/i);
  assert.match(migration, /c\.relkind in \('r','p'\)/i);
  assert.match(migration, /con\.confrelid = 'public\.organizations'::pg_catalog\.regclass/i);
  assert.match(migration, /if not coalesce\(has_fk, false\) then/i);
  assert.match(
    migration,
    /create trigger %I after insert or update on %I\.%I[\s\S]*?trigger_name, r\.schema_name, r\.table_name, r\.column_name/i,
  );
  assert.match(migration, /for key share/i);
  assert.doesNotMatch(migration, /lock table .*share row exclusive mode/i);
});

test("A–K: empty organizations succeed only when every known relationship is empty; connected history blocks", () => {
  const readiness = functionBody("kandid_get_organization_deletion_readiness");
  const registry = functionBody("kandid_organization_deletion_registry");
  assert.match(readiness, /dependencies jsonb := '\[\]'::jsonb/i);
  assert.match(readiness, /pg_catalog\.jsonb_array_length\(dependencies\) = 0 and not verification_required/i);
  assert.match(readiness, /if dependency_count > 0 then/i);
  for (const key of ["election_history", "archived_election_history", "student_memberships", "board_assignments", "partylists", "officer_history", "prepared_officers", "leadership_releases", "campaign_snapshots", "officer_publications"]) {
    assert.match(registry, new RegExp(`'${key}'`));
  }
  assert.match(registry, /'current_term_participation'/);
  assert.match(registry, /'historical_term_participation'/);
  assert.match(readiness, /s\.status = ''active'' and t\.status = ''active''/i);
});

test("L–N: alternate/composite keys are discovered and uncountable relationships are unknown", () => {
  const readiness = functionBody("kandid_get_organization_deletion_readiness");
  assert.match(readiness, /con\.confrelid = 'public\.organizations'::pg_catalog\.regclass/i);
  assert.match(readiness, /generate_subscripts\(fk\.conkey, 1\) pair\(ordinality\)/i);
  assert.match(readiness, /fk\.conkey\[pair\.ordinality\]/i);
  assert.match(readiness, /fk\.confkey\[pair\.ordinality\]/i);
  assert.match(readiness, /array_lower\(fk\.conkey, 1\) is distinct from pg_catalog\.array_lower\(fk\.confkey, 1\)/i);
  assert.doesNotMatch(readiness, /unnest\(fk\.conkey, fk\.confkey\)/i);
  assert.match(readiness, /where o\.id = \$1/i);
  assert.match(readiness, /where o\.id = \$1[\s\S]*?using organization_row\.id/i);
  assert.doesNotMatch(readiness, /execute pg_catalog\.format\([\s\S]*?using p_organization_id/i);
  assert.match(readiness, /Unregistered organization reference requires review/i);
  assert.match(readiness, /a\.attname ~\* '\(organization\|org\)'/i);
  assert.match(readiness, /registered scalar reference is missing or has unsupported type/i);
  assert.match(readiness, /'count',null/i);
});

test("O–P: non-FK writes coordinate on the parent row and audit absence blocks deletion", () => {
  const guard = functionBody("kandid_guard_organization_reference");
  const readiness = functionBody("kandid_get_organization_deletion_readiness");
  const deletion = functionBody("kandid_delete_organization");
  assert.match(guard, /for key share/i);
  assert.match(migration, /create trigger %I after insert or update on %I\.%I/i);
  assert.match(readiness, /if not public\.kandid_organization_deletion_audit_ready\(\) then/i);
  assert.match(migration, /if not public\.kandid_organization_deletion_audit_ready\(\) then[\s\S]*?raise exception/i);
  assert.match(deletion, /if not public\.kandid_organization_deletion_audit_ready\(\) then/i);
  const auditReady = functionBody("kandid_organization_deletion_audit_ready");
  assert.match(auditReady, /audit_organization_mutations/i);
  assert.match(auditReady, /kandid_audit_admin_row_change/i);
  assert.match(auditReady, /\('election_id'\)/i);
  assert.match(migration, /if not public\.kandid_organization_deletion_audit_ready\(\) then[\s\S]*?raise exception/i);
});

test("Q–S: direct delete is revoked, late FK children are rechecked, and no broad table locks remain", () => {
  const deletion = functionBody("kandid_delete_organization");
  assert.match(migration, /revoke delete on table public\.organizations from public, anon, authenticated, service_role/i);
  assert.match(deletion, /for update/i);
  assert.match(deletion, /readiness := public\.kandid_get_organization_deletion_readiness\(p_organization_id\)/i);
  assert.ok(deletion.indexOf("readiness := public.kandid_get_organization_deletion_readiness") < deletion.indexOf("delete from public.organizations"));
  assert.doesNotMatch(migration, /lock table .*share row exclusive mode/i);
  assert.doesNotMatch(migration, /20261003100000|nondepartmental_membership_admission/i);
});

test("Super Admin organization page uses the trusted read and atomic-delete RPCs", () => {
  assert.match(deletionService, /kandid_get_organization_deletion_readiness/);
  assert.match(deletionService, /kandid_delete_organization/);
  assert.match(deletionService, /if \(!ORGANIZATION_DELETION_CONTRACT_ENABLED\)/g);
  assert.match(deletionState, /ORGANIZATION_DELETION_CONTRACT_ENABLED = false/);
  assert.match(deletionService, /p_organization_id: id/);
  assert.doesNotMatch(organizationsPage, /from\(["']organizations["']\)\s*\.delete\(/);
  assert.match(organizationsPage, /getOrganizationDeletionReadiness\(organization\.id\)/);
  assert.match(organizationsPage, /deleteOrganizationSafely\(organization\.id\)/);
  assert.match(organizationsPage, /Open deletion review/);
  assert.match(organizationsPage, /deletionReview \? renderDeletionReview\(\)/);
  assert.match(organizationsPage, /trustedStatus !== "ready"/);
  assert.doesNotMatch(organizationsPage, /Organization Deletion Unavailable/);
  assert.doesNotMatch(organizationsPage, /from\(["']organizations["']\)\s*\.delete\(/);
});

test("delete entry opens review for the selected organization with advisory counts only", () => {
  assert.match(organizationsPage, /const organization = organizations\.find\(\(org\) => org\.id === id\)/);
  assert.match(organizationsPage, /setDeletionEntry\(\{ organization, loading: true/);
  assert.match(organizationsPage, /setDeletionReview\(deletionEntry\.review\)/);
  assert.match(organizationsPage, /count: "exact", head: true/);
  assert.match(organizationsPage, /Review what is connected before considering permanent deletion/);
  assert.match(organizationsPage, /Organization deletion \/ readiness/);
  assert.match(organizationsPage, /Known connected records are shown below/);
  assert.match(organizationsPage, /RETURN TO ORGANIZATIONS|Return to Organizations/);
  assert.match(organizationsPage, /Return to deletion review/);
});

test("management destinations are non-destructive and historical sections have no delete shortcut", () => {
  assert.match(organizationsPage, /openOrganizationDetails\(organization\)/);
  assert.match(organizationsPage, /openEditForm\(organization\)/);
  assert.match(organizationsPage, /target="_blank" rel="noreferrer"/);
  assert.match(organizationsPage, /Preserved history/);
  assert.match(organizationsPage, /VIEW|View records/);
  assert.doesNotMatch(organizationsPage, /Delete these|Delete related records/i);
  assert.match(organizationsPage, /Return to Organizations/);
});

test("known-unavailable contract never calls readiness or delete RPCs from the browser", () => {
  const readinessGuard = deletionService.indexOf("if (!ORGANIZATION_DELETION_CONTRACT_ENABLED)");
  const readinessRpc = deletionService.indexOf('supabase.rpc("kandid_get_organization_deletion_readiness"');
  const deleteGuard = deletionService.lastIndexOf("if (!ORGANIZATION_DELETION_CONTRACT_ENABLED)");
  const deleteRpc = deletionService.indexOf('supabase.rpc("kandid_delete_organization"');
  assert.ok(readinessGuard !== -1 && readinessGuard < readinessRpc);
  assert.ok(deleteGuard !== -1 && deleteGuard < deleteRpc);
  assert.match(deletionState, /ORGANIZATION_DELETION_CONTRACT_ENABLED = false/);
});

test("RPC unavailable, dependency blocked, and unexpected failures remain distinct", () => {
  assert.equal(normalizeDeletionReadiness({ can_delete: true }).status, "ready");
  assert.equal(normalizeDeletionReadiness({ can_delete: false, dependencies: [] }).status, "blocked");
  assert.equal(normalizeDeletionReadiness({ can_delete: false, verification_required: true, dependencies: [{ count: null }] }).status, "verification_required");
  assert.equal(normalizeDeletionReadiness({ can_delete: false, dependencies: [{ count: null }] }).status, "verification_required");
  assert.equal(normalizeDeletionReadiness(null, { code: "PGRST202" }).status, "unavailable");
  assert.equal(normalizeDeletionReadiness(null, { code: "42883" }).status, "unavailable");
  assert.equal(normalizeDeletionReadiness(null, { code: "42501" }).status, "error");
  assert.equal(normalizeDeletionReadiness({ unexpected: true }).status, "error");

  assert.equal(normalizeOrganizationDelete({ deleted: true }).status, "deleted");
  assert.equal(
    normalizeOrganizationDelete({ deleted: false, readiness: { can_delete: false, dependencies: [] } }).status,
    "blocked",
  );
  assert.equal(normalizeOrganizationDelete({ deleted: false, readiness: { can_delete: false, verification_required: true, dependencies: [{ count: null }] } }).status, "verification_required");
  assert.equal(normalizeOrganizationDelete(null, { code: "PGRST202" }).status, "unavailable");
  assert.equal(normalizeOrganizationDelete(null, { code: "XX000" }).status, "error");
});
