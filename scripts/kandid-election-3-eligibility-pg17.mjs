// Synthetic PostgreSQL 17 regression suite. No production connection or credentials.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = resolve(root, ".tmp/election-3-rule-validation/docker");
mkdirSync(config, { recursive: true });
const container = "supabase_db_kandid-board-e2e-20261016-8c19";
const project = "kandid-board-e2e-20261016-8c19";
const database = "kandid_e3_rules_" + randomBytes(6).toString("hex");
const migrationPath = "supabase/proposals/20261020114248_election_3_program_year_eligibility_historical-proposal.sql";
const contract = JSON.parse(readFileSync(resolve(root, "tests/fixtures/election3ElectorateProductionContract.json"), "utf8"));
assert.equal(contract.project_ref, "fszgdxqxonqqcrzsnkca");
function docker(args, input) {
  return spawnSync("docker", ["--config", config, "--host", "npipe:////./pipe/dockerDesktopLinuxEngine", ...args],
    { input, encoding: "utf8", maxBuffer: 12 * 1024 * 1024, windowsHide: true });
}
const inspection = docker(["inspect", container]);
assert.equal(inspection.status, 0, inspection.stderr);
const info = JSON.parse(inspection.stdout)[0];
assert.equal(info.Name, "/" + container);
assert.equal(info.Config.Labels["com.supabase.cli.project"], project);
assert.equal(info.HostConfig.PortBindings["5432/tcp"][0].HostPort, "59322");
assert.match(database, /^kandid_e3_rules_[a-f0-9]{12}$/);
assert.equal(docker(["exec", container, "createdb", "-U", "postgres", "--template=template0", database]).status, 0);
function sql(text, expected = true) {
  const result = docker(["exec", "-i", container, "psql", "-X", "-q", "-At", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"], text);
  if (expected) assert.equal(result.status, 0, result.stderr);
  else assert.notEqual(result.status, 0, "Expected database rejection");
  return result;
}
const last = result => result.stdout.trim().split("\n").at(-1);
const actor = n => `begin;set local role authenticated;select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-${String(n).padStart(12,"0")}',true);`;
const board = query => last(sql(actor(1) + query + ";commit;"));
const student = (n, query) => last(sql(actor(100+n) + query + ";commit;"));
const service = query => last(sql("begin;set local role service_role;select set_config('request.jwt.claim.role','service_role',true);" + query + ";commit;"));
const count = table => Number(last(sql("select count(*) from " + table + " where election_id=3;")));
const preview = () => JSON.parse(board("select public.kandid_get_board_electorate_preview(3)"));
const pass = message => console.log("PASS " + message);
const baselineSource = name => contract.functions.find(fn => fn.name === name).definition;
const migration = readFileSync(resolve(root, migrationPath), "utf8");
let checks = 0;
function check(message, fn) { fn(); checks++; pass(message); }
async function checkAsync(message, fn) { await fn(); checks++; pass(message); }
const preserved = () => last(sql(`select md5(jsonb_build_object(
 'other_election',(select jsonb_agg(to_jsonb(e) order by id) from public.elections e where id<>3),
 'other_rules',(select jsonb_agg(to_jsonb(r) order by id) from public.eligibility_rules r where election_id<>3),
 'other_snapshot',(select jsonb_agg(to_jsonb(v) order by election_id,student_id) from private.election_eligible_voters v where election_id<>3),
 'other_ballots',(select jsonb_agg(to_jsonb(b) order by id) from public.vote_ballots b where election_id<>3),
 'other_votes',(select jsonb_agg(to_jsonb(v) order by id) from public.votes v where election_id<>3),
 'students',(select jsonb_agg(to_jsonb(s) order by id) from public.students s),
 'enrollments',(select jsonb_agg(to_jsonb(s) order by student_id,academic_term_id) from public.student_term_enrollments s)
 )::text);`));
// Only synthetic fixture setup may move the clock window after verifying that
// ordinary authenticated changes are blocked. Never used against production.
function fixtureWindow(kind) {
  const start = kind === "open" ? "-interval '1 hour'" : kind === "future" ? "+interval '1 hour'" : "-interval '2 hours'";
  const end = kind === "ended" ? "-interval '1 hour'" : "+interval '2 hours'";
  sql(`begin;alter table public.elections disable trigger elections_guard_frozen_electorate;
    update public.elections set start_date=timezone('Asia/Manila',now())${start},end_date=timezone('Asia/Manila',now())${end} where id=3;
    alter table public.elections enable trigger elections_guard_frozen_electorate;commit;`);
}
try {
  assert.equal(last(sql("select current_database();")), database);
  assert.match(last(sql("show server_version;")), /^17\./);
  sql(readFileSync(resolve(root,"tests/fixtures/election3ElectorateRules.sql"),"utf8"));
  for (const fn of contract.functions) sql(fn.definition);
  sql(`
    revoke all on all functions in schema private from public,anon,authenticated,service_role;
    revoke all on function public.resolve_student_organization_participation(integer,integer,integer) from public,anon,authenticated,service_role;
    grant execute on function public.resolve_student_organization_participation(integer,integer,integer) to service_role;
    revoke all on function public.kandid_get_board_electorate_preview(integer),public.kandid_lock_board_electorate(integer),public.kandid_get_student_ballot_candidates(integer),public.kandid_is_locked_electorate_member(integer,integer) from public,anon,authenticated,service_role;
    grant execute on function public.kandid_get_board_electorate_preview(integer),public.kandid_lock_board_electorate(integer),public.kandid_get_student_ballot_candidates(integer) to authenticated;
    grant execute on function public.kandid_is_locked_electorate_member(integer,integer) to service_role;
    create trigger elections_guard_frozen_electorate before insert or update on public.elections for each row execute function private.kandid_guard_frozen_electorate();
    create trigger election_eligible_voters_immutable before insert or update or delete on private.election_eligible_voters for each row execute function private.kandid_guard_frozen_electorate_member();
    create trigger vote_ballots_require_locked_electorate before insert on public.vote_ballots for each row execute function private.kandid_require_locked_electorate_for_ballot();
    create trigger guard_removed_election_mutation before insert or update or delete on public.eligibility_rules for each row execute function private.kandid_guard_removed_election_child_mutation();
    grant select,update on public.elections to authenticated;
    grant select on public.admin_users to authenticated;
    grant select,insert,update,delete on public.eligibility_rules to authenticated;
    grant usage on sequence public.eligibility_rules_id_seq to authenticated;
    alter table public.eligibility_rules enable row level security;
  `);
  const ruleBaseline = JSON.parse(readFileSync(resolve(root,"tests/fixtures/eligibilityRulesProductionContract.json"),"utf8"));
  for(const p of ruleBaseline.policies) {
    assert.match(p.name,/^eligibility_rules_[a-z_]+$/);
    sql(`create policy ${p.name} on public.eligibility_rules for ${p.cmd} to authenticated ${p.using?"using ("+p.using+")":""} ${p.check?"with check ("+p.check+")":""};`);
  }
  const original = preserved();
  check("migration refuses reviewed-function drift without installing helpers", () => {
    sql(baselineSource("kandid_lock_board_electorate").replace("declare","declare\n-- synthetic drift"));
    assert.match(sql(migration,false).stderr,/Reviewed function has drifted/);
    assert.equal(last(sql("select to_regprocedure('private.kandid_student_matches_election_rules(integer,integer)') is null;")),"t");
    sql(baselineSource("kandid_lock_board_electorate"));
  });
  check("migration refuses existing Election 3 vote history", () => {
    sql("insert into public.votes(election_id,student_id) values(3,1);");
    assert.match(sql(migration,false).stderr,/recovery baseline differs/);
    sql("delete from public.votes where election_id=3;");
  });
  check("migration refuses a changed function owner even when its body is unchanged", () => {
    sql("grant create on schema public to authenticated;");
    sql("alter function public.kandid_lock_board_electorate(integer) owner to authenticated;");
    assert.match(sql(migration,false).stderr,/Reviewed function has drifted/);
    sql("alter function public.kandid_lock_board_electorate(integer) owner to postgres;");
    sql("revoke create on schema public from authenticated;grant execute on function public.kandid_lock_board_electorate(integer) to authenticated;");
  });
  sql(migration);
  check("old BSIT Years 2–4 excludes Year 1 from the official preview", () => {
    assert.equal(preview().eligible_voters,1);
    assert.equal(preview().locking_allowed,true);
    const oldLock=sql(actor(1)+"select public.kandid_lock_board_electorate(3);reset role;select jsonb_agg(student_id order by student_id) from private.election_eligible_voters where election_id=3;rollback;");
    assert.deepEqual(JSON.parse(last(oldLock)),[2]);
    assert.equal(count("private.election_eligible_voters"),0);
  });
  check("only the organization Board may preview or change rules", () => {
    assert.match(sql(actor(2)+"select public.kandid_get_board_electorate_preview(3);commit;",false).stderr,/Election is unavailable/);
    assert.match(sql(actor(3)+"select public.kandid_get_board_electorate_preview(3);commit;",false).stderr,/active Electoral Board/);
    assert.match(sql("begin;set local role anon;select public.kandid_get_board_electorate_preview(3);",false).stderr,/permission denied/);
    assert.equal(last(sql(actor(2)+"with edited as(update public.eligibility_rules set min_year_level=1 where election_id=3 returning id) select count(*) from edited;commit;")),"0");
    assert.match(sql("begin;set local role service_role;select public.kandid_lock_board_electorate(3);",false).stderr,/permission denied/);
  });
  check("Board edit changes only Election 3 to BSIT Years 1–4 and preview becomes exactly 2", () => {
    board("update public.eligibility_rules set min_year_level=1 where election_id=3");
    assert.equal(preview().eligible_voters,2);
    assert.equal(preview().locking_allowed,true);
    assert.equal(preserved(),original);
  });
  check("predicate excludes wrong program/year, pending/unlinked/disabled, enrollment, foreign/removed/missing membership, wrong term, SHS and missing year", () => {
    const ids=JSON.parse(last(sql("select jsonb_agg(id order by id) from public.students where private.kandid_student_matches_election_rules(3,id);")));
    assert.deepEqual(ids,[1,2]);
  });
  check("term enrollment, not stale central academic fields, drives the rule", () => {
    assert.equal(last(sql("begin;update public.students set program='BSCS',year_level=6 where id=1;select private.kandid_student_matches_election_rules(3,1);rollback;")),"t");
  });
  check("no matching rules fails closed in both preview and locking", () => {
    const out=sql(actor(1)+"delete from public.eligibility_rules where election_id=3;select public.kandid_get_board_electorate_preview(3);rollback;");
    const result=JSON.parse(last(out));
    assert.equal(result.eligible_voters,0);assert.equal(result.locking_allowed,false);
    assert.match(sql(actor(1)+"delete from public.eligibility_rules where election_id=3;select public.kandid_lock_board_electorate(3);",false).stderr,/No eligible voters/);
    assert.equal(count("private.election_eligible_voters"),0);
  });
  check("nullable program/bounds and multiple rules retain documented OR semantics", () => {
    assert.equal(last(sql("begin;update public.eligibility_rules set program=null,min_year_level=null,max_year_level=null where election_id=3;select private.kandid_student_matches_election_rules(3,3);rollback;")),"t");
    assert.equal(last(sql("begin;insert into public.eligibility_rules(election_id,program,min_year_level,max_year_level,allow_shs) values(3,'BSCS',1,4,false);select private.kandid_student_matches_election_rules(3,3);rollback;")),"t");
  });
  check("SHS requires explicit inclusion and is independent of college bounds", () => {
    assert.equal(last(sql("begin;update public.student_term_enrollments set year_level=11 where student_id=12;update public.eligibility_rules set allow_shs=true where election_id=3;select private.kandid_student_matches_election_rules(3,12);rollback;")),"t");
    assert.equal(last(sql("select private.kandid_student_matches_election_rules(3,12);")),"f");
  });
  check("inactive and ambiguous academic terms fail closed", () => {
    assert.equal(last(sql("begin;update public.academic_terms set status='archived' where id=1;select private.kandid_student_matches_election_rules(3,1);rollback;")),"f");
    assert.equal(last(sql("begin;update public.academic_terms set status='active' where id=2;select private.kandid_student_matches_election_rules(3,1);rollback;")),"f");
  });
  check("private eligibility helpers expose no authenticated or anonymous identity endpoint", () => {
    for(const role of ["anon","authenticated","service_role"]) assert.equal(last(sql(`select has_function_privilege('${role}','private.kandid_student_matches_election_rules(integer,integer)','EXECUTE');`)),"f");
    assert.match(sql(actor(101)+"select private.kandid_student_matches_election_rules(3,1);",false).stderr,/permission denied/);
  });
  check("missed voting-start cutoff and inactive election reject locking without creating a snapshot", () => {
    assert.match(sql(actor(1)+"update public.elections set start_date=timezone('Asia/Manila',now())-interval '1 hour' where id=3;select public.kandid_lock_board_electorate(3);",false).stderr,/Voting start has passed/);
    assert.match(sql(actor(1)+"update public.elections set status='draft' where id=3;select public.kandid_lock_board_electorate(3);",false).stderr,/Active before locking/);
    assert.equal(count("private.election_eligible_voters"),0);
  });
  check("an incomplete unlocked snapshot is refused and remains intact", () => {
    sql("insert into private.election_eligible_voters(election_id,student_id) values(3,1);");
    assert.match(sql(actor(1)+"select public.kandid_lock_board_electorate(3);",false).stderr,/incomplete electorate snapshot/);
    assert.equal(count("private.election_eligible_voters"),1);
    sql("delete from private.election_eligible_voters where election_id=3;");
  });
  check("audit failure rolls snapshot and lock metadata back atomically", () => {
    sql("create function private.fixture_fail_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure';end;$$;create trigger fixture_fail_audit before insert on public.audit_logs for each row execute function private.fixture_fail_audit();");
    assert.match(sql(actor(1)+"select public.kandid_lock_board_electorate(3);",false).stderr,/synthetic audit failure/);
    assert.equal(count("private.election_eligible_voters"),0);
    assert.equal(last(sql("select electorate_frozen_at is null from public.elections where id=3;")),"t");
    sql("drop trigger fixture_fail_audit on public.audit_logs;drop function private.fixture_fail_audit();");
  });
  await checkAsync("rule edits serialize behind the election row lock used by freezing", async () => {
    const holder=spawn("docker",["--config",config,"--host","npipe:////./pipe/dockerDesktopLinuxEngine","exec","-i",container,"psql","-X","-q","-At","-U","postgres","-d",database,"-v","ON_ERROR_STOP=1"],{windowsHide:true});
    let errors="",output="";
    holder.stderr.on("data",chunk=>{errors+=chunk;});
    const finished=new Promise((resolve,reject)=>{holder.on("error",reject);holder.on("close",resolve);});
    const ready=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("Synthetic row-lock handshake timed out")),10000);
      holder.stdout.on("data",chunk=>{output+=chunk;if(output.includes("row_locked")){clearTimeout(timer);resolve();}});
      holder.on("error",error=>{clearTimeout(timer);reject(error);});
    });
    holder.stdin.end("begin;select id from public.elections where id=3 for update;select 'row_locked';select pg_sleep(3);rollback;");
    await ready;
    assert.match(sql(actor(1)+"set local lock_timeout='200ms';update public.eligibility_rules set min_year_level=2 where election_id=3;commit;",false).stderr,/lock timeout/);
    assert.equal(await finished,0,errors);
    assert.equal(preview().eligible_voters,2);
  });
  check("official lock includes exactly Year 1 and Year 4; repeated lock is idempotent with one audit", () => {
    const locked=JSON.parse(board("select public.kandid_lock_board_electorate(3)"));
    assert.equal(locked.eligible_voters,2);assert.equal(locked.is_locked,true);
    const repeat=JSON.parse(board("select public.kandid_lock_board_electorate(3)"));
    assert.equal(repeat.locked_at,locked.locked_at);
    assert.deepEqual(JSON.parse(last(sql("select jsonb_agg(student_id order by student_id) from private.election_eligible_voters where election_id=3;"))),[1,2]);
    assert.equal(count("public.audit_logs"),1);
    assert.equal(count("public.vote_ballots"),0);assert.equal(count("public.votes"),0);
  });
  check("frozen rule Create/Edit/Delete and movement are denied", () => {
    for(const query of [
      "update public.eligibility_rules set min_year_level=2 where election_id=3",
      "delete from public.eligibility_rules where election_id=3",
      "insert into public.eligibility_rules(election_id,program,allow_shs) values(3,'BSCS',false)"
    ]) assert.match(sql(actor(1)+query+";commit;",false).stderr,/rules are locked/);
    assert.match(sql(actor(1)+"update public.eligibility_rules set election_id=4 where election_id=3;commit;",false).stderr,/cannot be moved/);
  });
  check("frozen schedule and snapshot immutability are preserved", () => {
    assert.match(sql(actor(1)+"update public.elections set start_date=start_date+interval '1 hour' where id=3;commit;",false).stderr,/immutable/);
    assert.match(sql("delete from private.election_eligible_voters where election_id=3;",false).stderr,/locked electorate cannot be changed/);
  });
  check("candidate and server membership remain closed before voting start", () => {
    assert.equal(student(1,"select jsonb_array_length(public.kandid_get_student_ballot_candidates(3))"),"0");
    assert.equal(service("select public.kandid_is_locked_electorate_member(3,1)"),"f");
    assert.match(sql("insert into public.vote_ballots(election_id,student_id) values(3,1);",false).stderr,/not eligible/);
  });
  fixtureWindow("open");
  check("authorized Year 1 and Year 4 receive the same candidate display contract during voting", () => {
    for(const id of [1,2]) {
      const rows=JSON.parse(student(id,"select public.kandid_get_student_ballot_candidates(3)"));
      assert.equal(rows.length,2);
      assert.equal(rows[0].students.first_name,"Synthetic");
      assert.equal(rows[0].photo,"candidate-photo-1");
      assert.equal(rows[0].partylists.name,"Synthetic Party");
      assert.equal(rows[1].students.photo_url,"photo-2");
      assert.equal(rows[1].partylists,null);
      assert.equal(Object.hasOwn(rows[0],"student_id"),false);
      assert.equal(service("select public.kandid_is_locked_electorate_member(3,"+id+")"),"t");
    }
  });
  check("ineligible and cross-organization Students cannot retrieve choices or pass ballot insertion guard", () => {
    for(const id of [3,4,7,8,9,10,11,12,13,14,15]) {
      assert.match(sql(actor(100+id)+"select public.kandid_get_student_ballot_candidates(3);",false).stderr,/Ballot choices are unavailable/);
      assert.equal(service("select public.kandid_is_locked_electorate_member(3,"+id+")"),"f");
      assert.notEqual(sql("insert into public.vote_ballots(election_id,student_id) values(3,"+id+");",false).status,0);
    }
    assert.equal(count("public.vote_ballots"),0);
  });
  check("post-freeze enrollment or membership revocation denies all authorization paths while snapshot stays frozen", () => {
    for(const change of [
      "update public.student_term_enrollments set year_level=5 where student_id=1 and academic_term_id=1",
      "update public.student_organization_terms set status='removed' where student_id=1 and organization_id=2",
      "update public.student_term_enrollments set enrollment_status='not_enrolled' where student_id=1 and academic_term_id=1"
    ]) {
      assert.match(sql("begin;"+change+";set local role authenticated;select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000101',true);select public.kandid_get_student_ballot_candidates(3);",false).stderr,/Ballot choices are unavailable/);
      assert.equal(last(sql("begin;"+change+";set local role service_role;select set_config('request.jwt.claim.role','service_role',true);select public.kandid_is_locked_electorate_member(3,1);rollback;")),"f");
      assert.match(sql("begin;"+change+";insert into public.vote_ballots(election_id,student_id) values(3,1);",false).stderr,/not eligible/);
    }
    assert.equal(count("private.election_eligible_voters"),2);
  });
  check("closed, removed and expired elections remain protected", () => {
    assert.match(sql("begin;update public.elections set status='closed' where id=3;set local role authenticated;select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000101',true);select public.kandid_get_student_ballot_candidates(3);",false).stderr,/Ballot choices are unavailable/);
    assert.equal(last(sql("begin;update public.elections set removed_at=now() where id=3;select private.kandid_student_matches_election_rules(3,1);rollback;")),"f");
    fixtureWindow("ended");
    assert.equal(student(1,"select jsonb_array_length(public.kandid_get_student_ballot_candidates(3))"),"0");
    assert.equal(service("select public.kandid_is_locked_electorate_member(3,1)"),"f");
    assert.match(sql("insert into public.vote_ballots(election_id,student_id) values(3,1);",false).stderr,/not eligible/);
  });
  check("another election's frozen electorate, choices, records and receipts retain existing behavior", () => {
    assert.equal(student(3,"select jsonb_array_length(public.kandid_get_student_ballot_candidates(4))"),"1");
    assert.equal(service("select public.kandid_is_locked_electorate_member(4,3)"),"t");
    assert.equal(preserved(),original);
    assert.equal(count("public.votes"),0);assert.equal(count("public.vote_ballots"),0);
  });
  console.log(JSON.stringify({checks,failed:0,postgres:17,productionConnected:false}));
} finally {
  assert.match(database,/^kandid_e3_rules_[a-f0-9]{12}$/);
  const dropped=docker(["exec",container,"dropdb","-U","postgres",database]);
  assert.equal(dropped.status,0,dropped.stderr);
  console.log("Removed only the isolated synthetic test database.");
}
