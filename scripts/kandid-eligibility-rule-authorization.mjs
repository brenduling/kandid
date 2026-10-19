// Replays read-only production policy/function metadata with synthetic records
// in a new LOCAL PostgreSQL database. Never connects to a production database.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = resolve(root, ".tmp/eligibility-rule-validation/docker");
mkdirSync(config, { recursive: true });
const container = "supabase_db_kandid-board-e2e-20261016-8c19";
function docker(args, input) {
  return spawnSync("docker", ["--config", config, "--host", "npipe:////./pipe/dockerDesktopLinuxEngine", ...args], { input, encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true });
}
const inspected = docker(["inspect", container]); assert.equal(inspected.status, 0, inspected.stderr);
const info = JSON.parse(inspected.stdout)[0];
assert.equal(info.Name, "/" + container);
assert.equal(info.Config.Labels["com.supabase.cli.project"], "kandid-board-e2e-20261016-8c19");
assert.equal(info.HostConfig.PortBindings["5432/tcp"][0].HostPort, "59322");
const database = "kandid_rule_check_" + randomBytes(6).toString("hex");
assert.match(database, /^kandid_rule_check_[a-f0-9]{12}$/);
const created = docker(["exec", container, "createdb", "-U", "postgres", "--template=template0", database]);
assert.equal(created.status, 0, created.stderr);
function sql(text, expected = true) {
  const result = docker(["exec", "-i", container, "psql", "-X", "-q", "-At", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"], text);
  if (expected) assert.equal(result.status, 0, result.stderr); else assert.notEqual(result.status, 0, "Expected database denial");
  return result;
}
const actor = (number) => `begin;set local role authenticated;select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-${String(number).padStart(12, "0")}',true);`;
const last = (result) => result.stdout.trim().split("\n").at(-1);
const pass = (message) => console.log("PASS " + message);
try {
  assert.equal(last(sql("select current_database();")), database);
  sql(`
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    grant usage on schema auth to authenticated,anon;
    create table public.organizations(id integer primary key,membership_scope text,organization_type text);
    create table public.admin_users(auth_user_id uuid,role text,status text,organization_id integer);
    create table public.academic_terms(id integer primary key,status text,created_at timestamptz default now());
    create table public.elections(id integer primary key,organization_id integer references public.organizations,academic_term_id integer references public.academic_terms,
      status text,start_date timestamp,end_date timestamp,removed_at timestamptz,electorate_policy_version integer,electorate_frozen_at timestamptz);
    create table public.eligibility_rules(id serial primary key,election_id integer references public.elections,program varchar(100),min_year_level integer,max_year_level integer,allow_shs boolean);
    create table public.students(id integer primary key,auth_user_id uuid,status text,first_name text,last_name text,photo_url text);
    create table public.student_term_enrollments(student_id integer,academic_term_id integer,enrollment_status text,program text,year_level integer);
    create table public.student_organization_terms(student_id integer,organization_id integer,academic_term_id integer,status text,source text);
    create table private.election_eligible_voters(election_id integer,student_id integer,primary key(election_id,student_id));
    create table public.positions(id integer primary key,election_id integer,status text,display_order integer);
    create table public.partylists(id integer primary key,organization_id integer,election_id integer,name text,logo_url text);
    create table public.candidates(id integer primary key,position_id integer,student_id integer,partylist_id integer,photo text);
    create table public.votes(election_id integer,student_id integer);
    insert into public.organizations values(901,'institution','departmental'),(902,'program','departmental');
    insert into public.academic_terms(id,status) values(901,'active'),(902,'archived');
    insert into public.elections values
      (9301,901,901,'active',timezone('Asia/Manila',now())-interval '1 hour',timezone('Asia/Manila',now())+interval '1 hour',null,1,now()),
      (9302,902,901,'active',null,null,null,1,null),
      (9303,901,901,'active',null,null,now(),1,null),
      (9304,901,902,'active',timezone('Asia/Manila',now())-interval '1 hour',timezone('Asia/Manila',now())+interval '1 hour',null,1,now());
    insert into public.admin_users values
      ('10000000-0000-4000-8000-000000000001','electoral_board','active',901),
      ('10000000-0000-4000-8000-000000000002','electoral_board','active',902),
      ('10000000-0000-4000-8000-000000000003','electoral_board','disabled',901);
    insert into public.students select n,('10000000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,'active','Synthetic','Student',null from generate_series(1,5) n;
    insert into public.student_term_enrollments values(1,901,'enrolled','BSIT',2),(2,901,'enrolled','BSCS',3),(3,901,'enrolled','SHS',11),(4,902,'enrolled','BSIT',2),(5,901,'enrolled','BSIT',2);
    insert into public.student_organization_terms values(1,901,901,'active','institution'),(2,901,901,'active','institution'),(3,901,901,'active','institution'),(4,901,902,'active','institution'),(5,901,901,'removed','institution');
    insert into private.election_eligible_voters select 9301,n from generate_series(1,5) n;
    insert into public.positions values(1,9301,'active',1);
    insert into public.candidates values(1,1,1,null,null);
    insert into public.eligibility_rules values(9999,9303,'BSIT',1,4,false);
    grant select on public.admin_users,public.elections to authenticated;
    grant select,insert,update,delete on public.eligibility_rules to authenticated;
    grant usage on sequence public.eligibility_rules_id_seq to authenticated;
    alter table public.eligibility_rules enable row level security;
  `);
  const snapshot = JSON.parse(readFileSync(resolve(root, "tests/fixtures/eligibilityRulesProductionContract.json"), "utf8"));
  assert.equal(snapshot.project_ref, "fszgdxqxonqqcrzsnkca");
  for (const fn of snapshot.functions) {
    assert.ok(["resolve_student_organization_participation", "kandid_get_student_ballot_candidates", "kandid_is_locked_electorate_member", "kandid_guard_removed_election_child_mutation"].includes(fn.name));
    sql(fn.definition);
  }
  for (const policy of snapshot.policies) {
    assert.match(policy.name, /^eligibility_rules_[a-z_]+$/);
    assert.ok(["SELECT", "INSERT", "UPDATE", "DELETE"].includes(policy.cmd));
    assert.deepEqual(policy.roles, ["authenticated"]);
    sql(`create policy ${policy.name} on public.eligibility_rules for ${policy.cmd} to authenticated ${policy.using ? `using (${policy.using})` : ""} ${policy.check ? `with check (${policy.check})` : ""};`);
  }
  const removed = snapshot.triggers.find((trigger) => trigger.includes("guard_removed_election_mutation"));
  assert.ok(removed); sql(removed);
  assert.ok(snapshot.triggers.some((trigger) => trigger.includes("audit_eligibility_rules_mutations")));
  pass("Exact reviewed production RLS, membership resolver, ballot RPC and removed-election trigger installed in disposable local PostgreSQL");
  const choices = (student, election = 9301) => last(sql(`${actor(100 + student)}select jsonb_array_length(public.kandid_get_student_ballot_candidates(${election}));commit;`));
  const baseline = [1,2,3].map((student) => choices(student));
  assert.deepEqual(baseline, ["1","1","1"]);
  const roster = last(sql("select md5(string_agg(to_jsonb(v)::text,'' order by election_id,student_id)) from private.election_eligible_voters v;"));
  const id = last(sql(`${actor(1)}insert into public.eligibility_rules(election_id,program,min_year_level,max_year_level,allow_shs) values(9301,'BSIT',1,4,false) returning id;commit;`));
  assert.match(id, /^[1-9][0-9]*$/);
  pass("Authorized Board creates a BSIT Years 1–4 / SHS-not-included declaration");
  assert.deepEqual([1,2,3].map((student) => choices(student)), baseline);
  pass("BSIT-only declaration leaves eligible BSCS and SHS ballot access unchanged for institution-wide membership");
  sql("insert into public.votes values(9301,1);");
  sql(`${actor(1)}update public.eligibility_rules set program='BSCS',min_year_level=2,max_year_level=3,allow_shs=true where id=${id} and election_id=9301 returning id;commit;`);
  assert.deepEqual([1,2,3].map((student) => choices(student)), baseline);
  assert.equal(last(sql("select md5(string_agg(to_jsonb(v)::text,'' order by election_id,student_id)) from private.election_eligible_voters v;")), roster);
  assert.equal(last(sql("select count(*) from public.votes;")), "1");
  pass("Editing during voting with existing synthetic votes changes metadata only; locked roster, ballot access and vote records are preserved");
  for (const student of [4,5]) assert.match(sql(`${actor(100 + student)}select public.kandid_get_student_ballot_candidates(9301);commit;`, false).stderr, /Ballot choices are unavailable/);
  assert.match(sql(`${actor(102)}select public.kandid_get_student_ballot_candidates(9304);commit;`, false).stderr, /Ballot choices are unavailable/);
  pass("Missing current enrollment, removed participation and wrong-term elections remain denied");
  const foreign = last(sql(`${actor(2)}insert into public.eligibility_rules(election_id,program,allow_shs) values(9302,'BSIT',false) returning id;commit;`));
  assert.match(sql(`${actor(1)}insert into public.eligibility_rules(election_id,program) values(9302,'BSIT');commit;`, false).stderr, /row-level security/);
  assert.equal(last(sql(`${actor(1)}with changed as(update public.eligibility_rules set program='BSCS' where id=${foreign} returning id) select count(*) from changed;commit;`)), "0");
  assert.equal(last(sql(`${actor(1)}with changed as(delete from public.eligibility_rules where id=${foreign} returning id) select count(*) from changed;commit;`)), "0");
  assert.match(sql(`${actor(1)}update public.eligibility_rules set election_id=9302 where id=${id};commit;`, false).stderr, /row-level security/);
  pass("Cross-organization INSERT and parent movement denied; foreign UPDATE/DELETE affect zero rows");
  for (const command of ["insert into public.eligibility_rules(election_id) values(9303)", "update public.eligibility_rules set program='BSCS' where id=9999", "delete from public.eligibility_rules where id=9999"]) assert.match(sql(`${actor(1)}${command};commit;`, false).stderr, /removed/);
  pass("Existing removed-election trigger blocks Create, Edit and Delete");
  assert.match(sql(`${actor(3)}insert into public.eligibility_rules(election_id) values(9301);commit;`, false).stderr, /row-level security/);
  assert.match(sql("begin;set local role anon;insert into public.eligibility_rules(election_id) values(9301);commit;", false).stderr, /permission denied/);
  pass("Disabled Board and anonymous writers are denied");
  // Production has no history trigger for these descriptive rows. Preserve that
  // behavior; the UI's existing historical-delete checks are tested separately.
  sql(`${actor(1)}delete from public.eligibility_rules where id=${id} and election_id=9301 returning id;commit;`);
  assert.equal(last(sql(`select count(*) from public.eligibility_rules where id=${id};`)), "0");
  assert.deepEqual([1,2,3].map((student) => choices(student)), baseline);
  pass("Authorized database Delete removes metadata without changing ballot access; no new lifecycle policy was introduced");
} finally {
  assert.match(database, /^kandid_rule_check_[a-f0-9]{12}$/);
  const dropped = docker(["exec", container, "dropdb", "-U", "postgres", database]);
  assert.equal(dropped.status, 0, dropped.stderr);
  console.log("Disposable local database removed; no production connection was used.");
}
