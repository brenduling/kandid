import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  organizationMembershipScopeLabel,
  resolveOrganizationMembershipScope,
} from "../src/utils/organizationMembershipScope.js";

const migration = await readFile(
  new URL("../supabase/migrations/20261003110000_organization_membership_scope.sql", import.meta.url),
  "utf8",
);
const organizationsPage = await readFile(
  new URL("../src/pages/superadmin/Organizations.jsx", import.meta.url),
  "utf8",
);
const organizationAccess = await readFile(
  new URL("../src/utils/organizationAccess.js", import.meta.url),
  "utf8",
);
const boardProfile = await readFile(
  new URL("../src/pages/shared/Profile.jsx", import.meta.url),
  "utf8",
);

const approvedCoverage = [1, 2, 3, 4, 5, 6, 12, 16];

function assertApprovedWitsgPrestate({ id = 2, name = "WITSG", description = "Western Institute of Technology Student Government", type = "departmental", coverage = approvedCoverage }) {
  assert.equal(id, 2);
  assert.equal(name, "WITSG");
  assert.equal(description, "Western Institute of Technology Student Government");
  assert.equal(type, "departmental");
  assert.equal(coverage.length, 8);
  assert.deepEqual([...coverage].sort((left, right) => left - right), approvedCoverage);
}

test("approved WITSG migration fixture passes and unexpected pre-states fail closed", () => {
  assert.doesNotThrow(() => assertApprovedWitsgPrestate({}));
  assert.throws(() => assertApprovedWitsgPrestate({ coverage: approvedCoverage.slice(1) }));
  assert.throws(() => assertApprovedWitsgPrestate({ coverage: [...approvedCoverage, 99] }));
  assert.throws(() => assertApprovedWitsgPrestate({ name: "Other Organization" }));
  assert.throws(() => assertApprovedWitsgPrestate({ id: 20 }));
  assert.throws(() => assertApprovedWitsgPrestate({ description: "Different identity" }));
  assert.throws(() => assertApprovedWitsgPrestate({ type: "non_departmental" }));

  assert.match(migration, /witsg_row\.name is distinct from 'WITSG'/i);
  assert.match(migration, /witsg_row\.description is distinct from 'Western Institute of Technology Student Government'/i);
  assert.match(migration, /witsg_row\.organization_type is distinct from 'departmental'/i);
  assert.match(migration, /witsg_candidate_count <> 1/i);
  assert.match(migration, /witsg_coverage_count <> 8/i);
  assert.match(migration, /\(1::bigint, 'BSHM'::text, 'BSHM'::text\)[\s\S]*?\(16::bigint, 'BSBA'::text, 'BSBA'::text\)/i);
  assert.match(migration, /p\.code is distinct from expected\.program_code[\s\S]*?p\.name is distinct from expected\.program_name/i);
  assert.match(migration, /op\.program_id not in \(1, 2, 3, 4, 5, 6, 12, 16\)/i);
  assert.match(migration, /delete from public\.organization_programs op[\s\S]*?op\.organization_id = 2[\s\S]*?op\.program_id in \(1, 2, 3, 4, 5, 6, 12, 16\)/i);
  assert.match(migration, /get diagnostics witsg_deleted_count = row_count[\s\S]*?witsg_deleted_count <> 8/i);
  assert.match(migration, /when o\.id = 2 then 'institution'/i);
  assert.match(migration, /institution-scoped organizations cannot have program coverage/i);
});

test("WITSG coverage retirement is transaction-audited and does not touch participation or elections", () => {
  const migrationBlock = migration.slice(migration.indexOf("do $migration$"), migration.indexOf("$migration$;"));
  const capture = migrationBlock.indexOf("into witsg_before_coverage");
  const audit = migrationBlock.indexOf("insert into public.audit_logs");
  const retirement = migrationBlock.indexOf("delete from public.organization_programs");
  assert.ok(capture >= 0 && capture < audit && audit < retirement, "capture and audit precede the targeted retirement");
  assert.match(migration, /begin;[\s\S]*?do \$migration\$/i);
  assert.match(migrationBlock, /'system_migration'[\s\S]*?'organization_program_coverage_retired'[\s\S]*?'trusted_database'/i);
  assert.match(migrationBlock, /'before_programs', witsg_before_coverage[\s\S]*?'after_programs', '\[\]'::jsonb/i);
  assert.match(migrationBlock, /if exists \([\s\S]*?organization_programs op[\s\S]*?op\.organization_id = 2[\s\S]*?raise exception/i);
  assert.doesNotMatch(migrationBlock, /(?:insert|update|delete|truncate)\s+(?:into\s+)?public\.(?:student_organizations|student_organization_terms|elections|election_electorates|frozen_electorates)/i);
  assert.doesNotMatch(migrationBlock, /public\.student_organizations|public\.student_organization_terms|public\.elections|public\.election_electorates|public\.frozen_electorates/i);
});

test("configuration RPC enforces program counts by resolved membership scope", () => {
  const rpc = migration.slice(
    migration.indexOf("create or replace function public.kandid_save_organization_configuration"),
    migration.indexOf("$function$;", migration.indexOf("create or replace function public.kandid_save_organization_configuration")),
  );
  assert.match(rpc, /when organization_row\.membership_scope = 'institution' then 'institution'/i);
  assert.match(rpc, /return query select organization_row\.id::bigint/i);
  assert.match(rpc, /requested_scope = 'program'[\s\S]*?cardinality\(normalized_program_ids\), 0\) = 0/i);
  assert.match(rpc, /requested_scope in \('manual', 'institution'\)[\s\S]*?cardinality\(normalized_program_ids\), 0\) <> 0/i);
  assert.match(rpc, /perform public\.kandid_replace_organization_program_coverage/i);
  assert.doesNotMatch(rpc, /p_name\s*=\s*'WITSG'|p_organization_id\s*=\s*2/i);

  assert.equal(resolveOrganizationMembershipScope(null, "departmental"), "program");
  assert.equal(resolveOrganizationMembershipScope(null, "non_departmental"), "manual");
  assert.equal(resolveOrganizationMembershipScope({ membership_scope: "institution" }, "departmental"), "institution");
  assert.equal(resolveOrganizationMembershipScope({ membership_scope: "program" }), "program");
  assert.equal(resolveOrganizationMembershipScope({ membership_scope: "manual" }), "manual");
  assert.equal(resolveOrganizationMembershipScope({ membership_scope: "unknown" }), null);
});

test("organization configuration and read surfaces present institutional scope without empty coverage", () => {
  assert.match(organizationsPage, /membership_scope, created_at/);
  assert.match(organizationsPage, /programIds: membershipScope === "program" \? selectedProgramIds : \[\]/);
  assert.match(organizationsPage, /formMembershipScope === "program" \?/);
  assert.match(organizationsPage, /formMembershipScope === "institution"[\s\S]*?Institution-wide eligibility[\s\S]*?Program coverage does not apply/);
  assert.match(organizationsPage, /getOrganizationMembershipScopeLabel\(org\)/);
  assert.match(organizationAccess, /select\("id, name, description, organization_type, membership_scope"\)/);
  assert.match(boardProfile, /boardOrganization\.membership_scope === "institution"[\s\S]*?organizationMembershipScopeLabel\("institution"\)[\s\S]*?program coverage is not applicable/i);
  assert.doesNotMatch(organizationsPage + organizationAccess + boardProfile, /WITSG|WIT-SG|WIT SG|Western Institute of Technology Student Government/i);
});

test("scope labels communicate each membership model", () => {
  assert.equal(organizationMembershipScopeLabel("institution"), "Institution-wide eligibility");
  assert.equal(organizationMembershipScopeLabel("program"), "Program coverage");
  assert.equal(organizationMembershipScopeLabel("manual"), "Manually managed membership");
});
