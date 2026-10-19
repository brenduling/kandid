// Runs the reviewed production Partylist RLS predicate/policies against real
// PostgreSQL with synthetic records in a fresh, disposable LOCAL database.
// No production connection, credentials, records or schema changes are used.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = resolve(root, ".tmp/partylist-validation/docker");
mkdirSync(config, { recursive: true });
const container = "supabase_db_kandid-board-e2e-20261016-8c19";
const dockerArgs = ["--config", config, "--host", "npipe:////./pipe/dockerDesktopLinuxEngine"];
function docker(args, input) {
  return spawnSync("docker", [...dockerArgs, ...args], { input, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true });
}
const inspected = docker(["inspect", container]);
assert.equal(inspected.status, 0, inspected.stderr);
const info = JSON.parse(inspected.stdout)[0];
assert.equal(info.Name, "/" + container);
assert.equal(info.Config.Labels["com.supabase.cli.project"], "kandid-board-e2e-20261016-8c19");
assert.equal(info.HostConfig.PortBindings["5432/tcp"][0].HostPort, "59322");
const database = "kandid_partylist_check_" + randomBytes(6).toString("hex");
assert.match(database, /^kandid_partylist_check_[a-f0-9]{12}$/);
const created = docker(["exec", container, "createdb", "-U", "postgres", "--template=template0", database]);
assert.equal(created.status, 0, created.stderr);
function sql(text, expected = true) {
  const result = docker(["exec", "-i", container, "psql", "-X", "-q", "-At", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"], text);
  if (expected) assert.equal(result.status, 0, result.stderr);
  else assert.notEqual(result.status, 0, "Expected database authorization failure");
  return result;
}
const actor = (number) => `begin; set local role authenticated; select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-${String(number).padStart(12, "0")}',true);`;
const pass = (name) => console.log("PASS " + name);
try {
  assert.equal(sql("select current_database();").stdout.trim(), database);
  sql(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon, authenticated;
    create table public.organizations(id bigint primary key);
    create table public.admin_users(auth_user_id uuid, role text, status text, organization_id bigint references public.organizations);
    create table public.elections(id integer primary key, organization_id bigint references public.organizations);
    create table public.partylists(id serial primary key, organization_id bigint not null references public.organizations,
      election_id integer references public.elections, name varchar(100), description text, logo_url text);
    create table public.candidates(id serial primary key, partylist_id integer references public.partylists);
    insert into public.organizations values (9101),(9102);
    insert into public.elections values (9111,9101),(9112,9101),(9113,9102);
    insert into public.admin_users values
      ('10000000-0000-4000-8000-000000000001','electoral_board','active',9101),
      ('10000000-0000-4000-8000-000000000002','electoral_board','active',9102),
      ('10000000-0000-4000-8000-000000000003','electoral_board','disabled',9101),
      ('10000000-0000-4000-8000-000000000004','super_admin','active',null);
    grant select on public.partylists to anon, authenticated;
    grant insert,update,delete on public.partylists to authenticated;
    grant usage on sequence public.partylists_id_seq to authenticated;
  `);
  const source = readFileSync(resolve(root, "supabase/migrations/20261002090000_partylists_organization_level_expand.sql"), "utf8");
  const begin = source.indexOf("create or replace function public.kandid_can_mutate_organization_partylists(");
  const end = source.indexOf("-- 9. Grants.", begin);
  assert.ok(begin >= 0 && end > begin);
  sql(source.slice(begin, end));
  assert.equal(sql("select count(*) from pg_policies where schemaname='public' and tablename='partylists';").stdout.trim(), "4");
  pass("Reviewed bigint authorization helper and four live-compatible RLS policies run in disposable PostgreSQL");

  const own = sql(`${actor(1)}insert into public.partylists(organization_id,name) values(9101,'Synthetic Forward') returning id;commit;`).stdout.trim().split("\n").at(-1);
  assert.match(own, /^[1-9][0-9]*$/);
  assert.equal(sql(`select election_id is null from public.partylists where id=${own};`).stdout.trim(), "t");
  pass("JWT-linked active Board creates its own organization-wide partylist without an election");
  sql(`${actor(1)}update public.partylists set description='Synthetic updated' where id=${own} and organization_id=9101 returning id;commit;`);
  assert.equal(sql(`select description from public.partylists where id=${own};`).stdout.trim(), "Synthetic updated");
  pass("Authorized Board update persists");
  const foreign = sql(`${actor(2)}insert into public.partylists(organization_id,name) values(9102,'Synthetic Other') returning id;commit;`).stdout.trim().split("\n").at(-1);
  assert.match(sql(`${actor(1)}insert into public.partylists(organization_id,name) values(9102,'Forbidden');commit;`, false).stderr, /row-level security/);
  const changed = sql(`${actor(1)}with changed as(update public.partylists set name='Forbidden' where id=${foreign} returning id) select count(*) from changed;commit;`).stdout.trim().split("\n").at(-1);
  assert.equal(changed, "0");
  const deleted = sql(`${actor(1)}with changed as(delete from public.partylists where id=${foreign} returning id) select count(*) from changed;commit;`).stdout.trim().split("\n").at(-1);
  assert.equal(deleted, "0");
  assert.equal(sql(`select name from public.partylists where id=${foreign};`).stdout.trim(), "Synthetic Other");
  pass("Foreign organization INSERT denied and UPDATE/DELETE affect zero rows");
  assert.match(sql(`${actor(1)}update public.partylists set organization_id=9102 where id=${own};commit;`, false).stderr, /row-level security/);
  pass("UPDATE WITH CHECK prevents moving ownership to another organization");
  for (const number of [3, 5]) assert.match(sql(`${actor(number)}insert into public.partylists(organization_id,name) values(9101,'Forbidden');commit;`, false).stderr, /row-level security/);
  assert.match(sql("begin;set local role authenticated;insert into public.partylists(organization_id,name) values(9101,'Forbidden');commit;", false).stderr, /row-level security/);
  assert.match(sql("begin;set local role anon;insert into public.partylists(organization_id,name) values(9101,'Forbidden');commit;", false).stderr, /permission denied/);
  pass("Disabled, unlinked, missing-JWT and anonymous writers are denied");
  assert.equal(sql(`select count(*) from public.elections e join public.partylists pl on pl.organization_id=e.organization_id and (pl.election_id is null or pl.election_id=e.id) where pl.id=${own};`).stdout.trim(), "2");
  pass("The organization-wide row is reusable in two same-organization elections and excluded from the foreign election");
  sql(`insert into public.candidates(partylist_id) values(${own});`);
  assert.match(sql(`${actor(1)}delete from public.partylists where id=${own};commit;`, false).stderr, /foreign key constraint/);
  pass("Candidate FK prevents deletion of linked partylist records");
  sql(`delete from public.candidates where partylist_id=${own};`);
  sql(`${actor(1)}delete from public.partylists where id=${own} and organization_id=9101 returning id;commit;`);
  assert.equal(sql(`select count(*) from public.partylists where id=${own};`).stdout.trim(), "0");
  pass("Authorized Board deletes an unreferenced partylist");
  sql(`${actor(4)}update public.partylists set description='Synthetic Super Admin' where id=${foreign};commit;`);
  assert.equal(sql(`select description from public.partylists where id=${foreign};`).stdout.trim(), "Synthetic Super Admin");
  pass("Existing Super Admin database authority is preserved");
} finally {
  // Only the randomly named database successfully created above may be removed.
  assert.match(database, /^kandid_partylist_check_[a-f0-9]{12}$/);
  const dropped = docker(["exec", container, "dropdb", "-U", "postgres", database]);
  assert.equal(dropped.status, 0, dropped.stderr);
  console.log("Disposable local database removed; production was never contacted.");
}
