// Local-only validation. No network database URL, cloud CLI, or production API.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repository = resolve(import.meta.dirname, "..");
const evidence = resolve(repository, "deploy/election-soft-removal-review/evidence/uuid-compatibility");
mkdirSync(evidence, { recursive: true });
const container = "supabase_db_kandid-board-e2e-20261016-8c19";
const project = "kandid-board-e2e-20261016-8c19";
const expectedId = "6bd024cac2ec0f8ffac8ec31b322f5fa581b51f9e8139edfdb4fd0c30d2c4676";
const docker = args => execFileSync("docker", ["--context", "desktop-linux", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const info = JSON.parse(docker(["inspect", container]))[0];
assert.equal(info.Id, expectedId);
assert.equal(info.State.Running, true);
assert.equal(info.Config.Labels["com.supabase.cli.project"], project);
assert.equal(info.HostConfig.PortBindings["5432/tcp"][0].HostPort, "59322");
assert.equal(info.Mounts.find(item => item.Destination === "/var/lib/postgresql/data")?.Name, container);
assert.deepEqual(Object.keys(info.NetworkSettings.Networks), ["supabase_network_" + project]);
const database = "kandid_soft_removal_release_" + randomBytes(6).toString("hex");
const stage = "/tmp/" + database;
assert.match(database, /^kandid_soft_removal_release_[a-f0-9]{12}$/);
docker(["exec", container, "mkdir", "-p", stage]);
docker(["exec", container, "pg_dump", "-U", "supabase_admin", "-d", "postgres", "--schema-only", "--no-publications", "--no-subscriptions", "-f", stage + "/schema.sql"]);
docker(["exec", container, "createdb", "-U", "supabase_admin", "--owner=postgres", "--template=template0", database]);
docker(["exec", container, "psql", "-X", "-U", "supabase_admin", "-d", database, "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", stage + "/schema.sql"]);

const outcomes = [];
function sql(text, { context = true, user = "postgres" } = {}) {
  const prefix = context ? `SELECT set_config('kandid.soft_removal_test_database',current_database(),false);\n` : "";
  return spawnSync("docker", ["--context", "desktop-linux", "exec", "-i", container,
    "psql", "-X", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-At"],
  { input: prefix + text, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}
function check(name, text, expectedError = null, options = {}) {
  const result = sql(text, options);
  const safe = { name, exit: result.status, stdout: result.stdout, stderr: result.stderr };
  writeFileSync(resolve(evidence, name + ".json"), JSON.stringify(safe, null, 2));
  if (expectedError) {
    assert.notEqual(result.status, 0, name + " must fail");
    assert.match(result.stderr, expectedError, name);
  } else assert.equal(result.status, 0, name + ": " + result.stderr);
  outcomes.push({ name, result: "PASS", expected_failure: Boolean(expectedError) });
  console.log("PASS " + name);
  return result.stdout;
}
const script = name => readFileSync(resolve(repository, "deploy/election-soft-removal-review/" + name), "utf8");
const versions = ["20261013180621", "20261013180713", "20261014021234", "20261014113000", "20261015110620", "20261018120000", "20261021120000"];
const target = "20261018130000";
const migration = readFileSync(resolve(repository, "supabase/migrations/20261018130000_password_protected_election_soft_removal.sql"));
const migrationSha256 = createHash("sha256").update(migration).digest("hex").toUpperCase();
const reviewedManifest = JSON.parse(script("SHA256SUMS.json"));
assert.equal(migrationSha256, reviewedManifest.find(item => item.path === "candidate/supabase/migrations/20261018130000_password_protected_election_soft_removal.sql").sha256);
check("local-identity", `DO $$ BEGIN IF current_database() <> '${database}' OR inet_server_addr() IS NOT NULL OR current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION 'isolation mismatch'; END IF; END $$;`);
check("production-compatible-schema-dependency", readFileSync(resolve(repository,"supabase/runtime-validation/election-soft-removal-release-baseline.sql"),"utf8"));
check("identifier-type-audit", `SELECT current_setting('server_version') AS postgresql_version; SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.oid IN ('public.elections'::regclass,'public.positions'::regclass,'public.candidates'::regclass,'public.candidate_media'::regclass,'public.admin_users'::regclass,'public.election_officer_publications'::regclass,'public.election_officer_publication_entries'::regclass,'public.officer_leadership_releases'::regclass) AND a.attname IN ('id','election_id','position_id','candidate_id','publication_id','source_officer_id','organization_id','auth_user_id') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attname;`);
// This ledger is synthetic test metadata, not reconstructed migration sources.
check("synthetic-ledger-baseline", `CREATE SCHEMA supabase_migrations AUTHORIZATION postgres; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[]); INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ${versions.map(version => `('${version}','synthetic reviewed baseline')`).join(",")};`);
check("synthetic-historical-records", readFileSync(resolve(repository,"supabase/runtime-validation/election-soft-removal-release-records.sql"),"utf8"),null,{user:"supabase_admin"});
const preserved = ["students","student_term_enrollments","student_organization_terms","academic_terms","organizations","elections","positions","candidates","candidate_media","partylists","eligibility_rules","election_access_tokens","votes","vote_ballots","officers","officer_new_roster","officer_leadership_releases","election_officer_publications","election_officer_publication_entries","election_campaign_snapshots","archived_elections","audit_logs"];
const preservationQuery = "SELECT jsonb_build_object(" + [...preserved.map(name=>[name,"public."+name]),["frozen_electorate","private.election_eligible_voters"]].map(([name,relation])=>`'${name}',(SELECT jsonb_build_object('rows',count(*),'digest',md5(coalesce(string_agg(row_data,E'\\n' ORDER BY row_data),''))) FROM (SELECT ${name === "elections" ? "(to_jsonb(t)-'removed_at')" : "to_jsonb(t)"}::text row_data FROM ${relation} t) records)`).join(",")+");";
const snapshot = name => JSON.parse(check(name,preservationQuery).trim().split("\n").at(-1));
const before = snapshot("preservation-before");
check("preflight-rejects-missing-test-context", script("PREFLIGHT.sql"), /Unexpected database/, { context: false });
check("preflight-rejects-ledger-drift", "BEGIN; DELETE FROM supabase_migrations.schema_migrations WHERE version='20261018120000';\n"+script("PREFLIGHT.sql"), /ledger baseline differs/);
check("preflight-rejects-trigger-drift", "BEGIN; ALTER TABLE public.positions DISABLE TRIGGER audit_positions_mutations;\n"+script("PREFLIGHT.sql"), /trigger baseline drifted/);
check("postflight-rejects-missing-migration", script("POSTFLIGHT.sql"), /column or partial index missing/);
check("preflight", script("PREFLIGHT.sql"));
// The source schema already uses the real production UUID/integer types.
// Type-drift checks run in aborted transactions and leave that schema intact.
check("preflight-rejects-publication-type-drift", "BEGIN; ALTER TABLE public.election_officer_publication_entries ADD COLUMN unexpected_id bigint; ALTER TABLE public.election_officer_publication_entries RENAME COLUMN id TO original_id; ALTER TABLE public.election_officer_publication_entries RENAME COLUMN unexpected_id TO id;\n"+script("PREFLIGHT.sql"), /identifier types do not match/);
check("migration-rejects-publication-type-drift", "BEGIN; ALTER TABLE public.election_officer_publication_entries ADD COLUMN unexpected_id bigint; ALTER TABLE public.election_officer_publication_entries RENAME COLUMN id TO original_id; ALTER TABLE public.election_officer_publication_entries RENAME COLUMN unexpected_id TO id;\n"+migration.toString("utf8"), /identifier types do not match/);
check("migration-install", migration.toString("utf8"));
check("structural-postflight", script("POSTFLIGHT.sql"));
check("structural-postflight-repeat", script("POSTFLIGHT.sql"));
assert.deepEqual(snapshot("preservation-after-install"),before);
check("postflight-rejects-publication-type-drift", "BEGIN; ALTER TABLE public.election_officer_publication_entries ADD COLUMN unexpected_id bigint; ALTER TABLE public.election_officer_publication_entries RENAME COLUMN id TO original_id; ALTER TABLE public.election_officer_publication_entries RENAME COLUMN unexpected_id TO id;\n"+script("POSTFLIGHT.sql"), /identifier types do not match/);
const entryId = "50000000-0000-4000-8000-000000000002";
const publicationId = "40000000-0000-4000-8000-000000000001";
const insertEntry = `INSERT INTO public.election_officer_publication_entries(id,publication_id,source_officer_id,display_order,display_name,position_title,selection_type) VALUES ('${entryId}','${publicationId}',null,1,'Synthetic UUID Student','Synthetic Secretary','other');`;
const service = "SET LOCAL ROLE service_role;";
const remove = `SELECT public.kandid_soft_remove_election(91101,'10000000-0000-4000-8000-000000000001');`;
const restore = `SELECT public.kandid_restore_removed_election(91101,'10000000-0000-4000-8000-000000000001');`;
// Recreate only the former function-body bug inside an aborted scratch transaction.
// This proves the regression fails with the old cast; no security trigger is disabled.
check("old-bigint-guard-reproduces-uuid-insert-failure", `BEGIN; DO $$ DECLARE body text; BEGIN body:=pg_get_functiondef('private.kandid_guard_removed_election_child_mutation()'::regprocedure); body:=replace(replace(body,'target_publication_id uuid;','target_publication_id bigint;'),'''publication_id'', '''')::uuid;','''publication_id'', '''')::bigint;'); EXECUTE body; END $$; ${service} ${insertEntry}`, /invalid input syntax for type bigint/);
check("postflight-rejects-former-bigint-guard", "BEGIN; DO $$ BEGIN EXECUTE replace(pg_get_functiondef('private.kandid_guard_removed_election_child_mutation()'::regprocedure),'target_publication_id uuid;','target_publication_id bigint;'); END $$;\n"+script("POSTFLIGHT.sql"), /not the reviewed UUID-safe/);
check("uuid-entry-insert-nonremoved-election", `BEGIN; ${service} ${insertEntry} DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.election_officer_publication_entries WHERE id='${entryId}' AND publication_id='${publicationId}' AND source_officer_id IS NULL) THEN RAISE EXCEPTION 'UUID entry not inserted'; END IF; END $$; ROLLBACK;`);
check("uuid-entry-duplicate-id-denied", `BEGIN; ${service} ${insertEntry} ${insertEntry}`, /duplicate key/);
check("uuid-entry-duplicate-order-denied", `BEGIN; ${service} ${insertEntry} ${insertEntry.replace(entryId,"50000000-0000-4000-8000-000000000003")}`, /order_unique/);
check("uuid-entry-duplicate-source-officer-denied", `BEGIN; ${service} ${insertEntry.replace(",null,1,",",91101,1,")}`, /source_unique_idx/);
for (const [table,id] of [["election_officer_publications",publicationId],["election_officer_publication_entries","50000000-0000-4000-8000-000000000001"]]) {
  for (const removed of [false,true]) {
    for (const action of ["UPDATE","DELETE"]) {
      const statement = action === "UPDATE" ? `UPDATE public.${table} SET id=id WHERE id='${id}';` : `DELETE FROM public.${table} WHERE id='${id}';`;
      check(`uuid-${table}-${removed?"removed":"nonremoved"}-${action.toLowerCase()}-immutable`, `BEGIN; ${service} ${removed?remove:""} ${statement}`, /records are immutable/);
    }
  }
}
check("uuid-entry-insert-removed-election-denied", `BEGIN; ${service} ${remove} ${insertEntry}`, /related records are read-only/);
const otherPublication = `INSERT INTO public.election_campaign_snapshots(id,election_id,organization_id,schema_version,capture_kind,campaign_start,campaign_end,snapshot_data,content_hash) SELECT '20000000-0000-4000-8000-000000000002',91103,902,schema_version,capture_kind,campaign_start,campaign_end,snapshot_data,content_hash FROM public.election_campaign_snapshots WHERE election_id=91101;
INSERT INTO public.election_officer_publications(id,election_id,organization_id,campaign_snapshot_id,published_by_admin_user_id,schema_version,content_hash) VALUES ('40000000-0000-4000-8000-000000000002',91103,902,'20000000-0000-4000-8000-000000000002',903,'KANDID_OFFICER_PUBLICATION_V1',repeat('2',64));
INSERT INTO public.election_officer_publication_entries(id,publication_id,source_officer_id,display_order,display_name,position_title,selection_type) VALUES ('50000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000002',null,0,'Synthetic Other Student','Synthetic President','other');`;
check("uuid-publication-and-entry-insert-unrelated-election", `BEGIN; ${service} ${remove} ${otherPublication} DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.election_officer_publication_entries WHERE id='50000000-0000-4000-8000-000000000003') THEN RAISE EXCEPTION 'unrelated publication entry missing'; END IF; END $$; ROLLBACK;`);
check("uuid-publication-on-removed-election-denied", `BEGIN; ${service} ${otherPublication} SELECT public.kandid_soft_remove_election(91103,'10000000-0000-4000-8000-000000000003'); INSERT INTO public.election_officer_publications(id,election_id,organization_id,campaign_snapshot_id,published_by_admin_user_id,schema_version,content_hash) SELECT '40000000-0000-4000-8000-000000000003',election_id,organization_id,campaign_snapshot_id,published_by_admin_user_id,schema_version,content_hash FROM public.election_officer_publications WHERE election_id=91103;`, /related records are read-only/);
check("uuid-entry-insert-after-restore", `BEGIN; ${service} ${remove} ${restore} ${insertEntry} DO $$ BEGIN IF (SELECT count(*) FROM public.audit_logs WHERE election_id=91101 AND action IN ('election_soft_removed','election_restored')) <> 2 THEN RAISE EXCEPTION 'removal and restoration attribution missing'; END IF; IF EXISTS(SELECT 1 FROM public.elections WHERE id=91101 AND removed_at IS NOT NULL) THEN RAISE EXCEPTION 'restore not applied'; END IF; END $$; ROLLBACK;`);
check("uuid-entry-direct-authenticated-insert-denied", `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claim.sub='10000000-0000-4000-8000-000000000002'; ${insertEntry}`, /permission denied|row-level security/);
assert.deepEqual(snapshot("preservation-after-uuid-operations"),before);
check("postflight-rejects-grant-drift", "BEGIN; GRANT EXECUTE ON FUNCTION public.kandid_soft_remove_election(integer,uuid) TO authenticated;\n"+script("POSTFLIGHT.sql"),/EXECUTE grants/);
check("postflight-rejects-function-drift", "BEGIN; ALTER FUNCTION public.kandid_soft_remove_election(integer,uuid) SECURITY INVOKER;\n"+script("POSTFLIGHT.sql"),/Function owner, SECURITY DEFINER/);
check("postflight-rejects-trigger-drift", "BEGIN; ALTER TABLE public.positions DISABLE TRIGGER audit_positions_mutations;\n"+script("POSTFLIGHT.sql"),/trigger baseline drifted/);
check("preflight-rejects-installed-schema", script("PREFLIGHT.sql"), /partially or fully installed/);
check("migration-rejects-repeat", migration.toString("utf8"), /already exist/);
check("ledger-postflight-before-recording", script("LEDGER_POSTFLIGHT.sql"), /Migration history differs/);
check("rollback-rejects-unrecorded-install", script("ROLLBACK.sql"), /Target migration is not recorded/);
check("synthetic-target-only-recording", `INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ('${target}','password_protected_election_soft_removal');`);
check("ledger-postflight", script("LEDGER_POSTFLIGHT.sql"));
check("ledger-postflight-repeat", script("LEDGER_POSTFLIGHT.sql"));
check("ledger-postflight-rejects-unexpected-version", "BEGIN; INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('20990101000000');\n"+script("LEDGER_POSTFLIGHT.sql"), /Migration history differs/);
check("rollback-rejects-removed-election", "BEGIN; SET LOCAL session_replication_role=replica; UPDATE public.elections SET removed_at=clock_timestamp() WHERE id=91101; SET LOCAL session_replication_role=origin; SET LOCAL ROLE postgres;\n"+script("ROLLBACK.sql"), /At least one election is removed/, {user:"supabase_admin"});
check("rollback-rejects-restoration-history", "BEGIN; INSERT INTO public.audit_logs(user_id,actor_name,actor_role,action,event_type,event_category,entity_type,entity_id,entity_label,organization_id,organization_name,election_id,status,event_origin,metadata) SELECT user_id,actor_name,actor_role,'election_restored','election_restored',event_category,entity_type,entity_id,entity_label,organization_id,organization_name,election_id,status,event_origin,metadata FROM public.audit_logs WHERE election_id=91101;\n"+script("ROLLBACK.sql"), /audit history exists/);
check("rollback", script("ROLLBACK.sql"));
assert.deepEqual(snapshot("preservation-after-rollback"),before);
check("rollback-rejects-repeat", script("ROLLBACK.sql"), /Soft-removal schema is absent/);
check("synthetic-target-only-revert", `DELETE FROM supabase_migrations.schema_migrations WHERE version='${target}';`);
check("preflight-after-rollback", script("PREFLIGHT.sql"));
const report = { database, container, isolated_project: project, migrationSha256, outcomes };
writeFileSync(resolve(evidence, "sql-results.json"), JSON.stringify(report, null, 2));
writeFileSync(resolve(evidence, "../sql-results.json"), JSON.stringify({ ...report, detailDirectory:"uuid-compatibility" }, null, 2));
console.log(JSON.stringify({ database, passed: outcomes.length }));
