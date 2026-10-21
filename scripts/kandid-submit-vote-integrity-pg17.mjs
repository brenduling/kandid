// Replays inspected SQL contracts with synthetic data in a disposable LOCAL DB.
// No production URL, credentials, vote choices or network requests are used.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = resolve(root, ".tmp/election-3-rule-validation/docker");
mkdirSync(config, { recursive: true });
const container = "supabase_db_kandid-board-e2e-20261016-8c19";
const database = "kandid_submit_check_" + randomBytes(6).toString("hex");
const prefix = ["--config", config, "--host", "npipe:////./pipe/dockerDesktopLinuxEngine"];
const contract = JSON.parse(readFileSync(resolve(root, "tests/fixtures/submitVoteIntegrityProductionContract.json"), "utf8"));
assert.equal(contract.project_ref, "fszgdxqxonqqcrzsnkca");
const docker = (args, input) => spawnSync("docker", [...prefix, ...args], { input, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true });
const inspection = docker(["inspect", container]);
assert.equal(inspection.status, 0, inspection.stderr);
const info = JSON.parse(inspection.stdout)[0];
assert.equal(info.Name, "/" + container);
assert.equal(info.Config.Labels["com.supabase.cli.project"], "kandid-board-e2e-20261016-8c19");
assert.equal(info.HostConfig.PortBindings["5432/tcp"][0].HostPort, "59322");
assert.match(database, /^kandid_submit_check_[a-f0-9]{12}$/);
assert.equal(docker(["exec", container, "createdb", "-U", "postgres", "--template=template0", database]).status, 0);
const psql = ["exec", "-i", container, "psql", "-X", "-q", "-At", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"];
function sql(query, success = true) {
  const result = docker(psql, query);
  if (success) assert.equal(result.status, 0, result.stderr);
  else assert.notEqual(result.status, 0, "Expected rejection");
  return result;
}
const last = result => result.stdout.trim().split("\n").at(-1);
const counts = () => last(sql("select jsonb_build_array((select count(*) from public.vote_ballots),(select count(*) from public.votes));"));
const choices = [{ position_id: 11, candidate_id: 201, is_abstain: false }, { position_id: 12, candidate_id: null, is_abstain: true }];
const insert = (student, election = 3, rows = choices) => `select * from public.insert_v2_vote_rows(${student},${election},'${JSON.stringify(rows)}'::jsonb);`;
const service = query => "begin;set local role service_role;" + query + "commit;";
const hash = value => "0x" + createHash("sha256").update(value, "utf8").digest("hex");
let checks = 0;
function check(label, action) { action(); checks++; console.log("PASS " + label); }
function asyncSql(query) {
  return new Promise((resolveResult, reject) => {
    const child = spawn("docker", [...prefix, ...psql], { windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", status => resolveResult({ status, stdout, stderr }));
    child.stdin.end(query);
  });
}
try {
  assert.equal(last(sql("select current_database();")), database);
  assert.match(last(sql("show server_version;")), /^17\./);
  sql(`create schema extensions;create extension pgcrypto with schema extensions;
    create schema private;
    create table public.students(id integer primary key);
    create table public.elections(id integer primary key,electorate_policy_version integer,electorate_frozen_at timestamptz);
    create table public.positions(id integer primary key,election_id integer,display_order integer);
    create table public.candidates(id integer primary key);
    create table private.election_eligible_voters(election_id integer,student_id integer,primary key(election_id,student_id));
    create sequence public.votes_id_seq;`);
  for (const table of contract.tables) {
    assert.match(table.table, /^(votes|vote_ballots)$/);
    sql(`create table public.${table.table} (${table.columns.map(column => `"${column.name}" ${column.type}${column.default ? " default " + column.default : ""}${column.not_null ? " not null" : ""}`).join(",")});`);
  }
  for (const constraint of contract.constraints) sql(`alter table public.${constraint.table} add constraint "${constraint.name}" ${constraint.definition};`);
  sql(contract.insertion);
  sql(contract.frozen_guard);
  sql(`create trigger vote_ballots_require_locked_electorate before insert on public.vote_ballots
    for each row execute function private.kandid_require_locked_electorate_for_ballot();
    revoke all on function public.insert_v2_vote_rows(integer,integer,jsonb) from public,anon,authenticated,service_role;
    grant execute on function public.insert_v2_vote_rows(integer,integer,jsonb) to service_role;
    revoke all on function private.kandid_require_locked_electorate_for_ballot() from public,anon,authenticated,service_role;
    revoke all on public.votes,public.vote_ballots from public,anon,authenticated,service_role;
    grant select on public.votes,public.vote_ballots to service_role;
    insert into public.students values(1),(2),(3),(4),(5),(6);
    insert into public.elections values(3,1,now()),(4,1,null),(5,1,now());
    insert into private.election_eligible_voters values(3,1),(3,2),(3,3),(3,4),(3,5),(3,6);
    insert into public.positions values(11,3,2),(12,3,1);
    insert into public.candidates values(201),(202),(203);`);

  check("browser roles cannot invoke the trusted insertion RPC or write tables", () => {
    for (const role of ["anon", "authenticated"]) {
      assert.match(sql(`set role ${role};${insert(1)}`, false).stderr, /permission denied/);
      assert.match(sql(`set role ${role};insert into public.votes(id) values(99);`, false).stderr, /permission denied/);
    }
    assert.equal(counts(), "[0, 0]");
  });
  check("unfrozen and nonmember ballots fail atomically", () => {
    assert.match(sql(service(insert(1,4)), false).stderr, /electorate is not locked/);
    assert.match(sql(service(insert(1,5)), false).stderr, /not a member/);
    assert.equal(counts(), "[0, 0]");
  });
  check("invalid row after a valid row rolls the entire ballot back", () => {
    assert.match(sql(service(insert(3,3,[choices[0],{position_id:12,is_abstain:false,candidate_id:null}])), false).stderr, /requires candidate_id/);
    assert.equal(counts(), "[0, 0]");
  });
  check("trusted insertion stores exactly one Ballot V1 plus candidate and abstain V2 rows", () => {
    sql(service(insert(1)));
    assert.equal(counts(), "[1, 2]");
    assert.equal(last(sql("select bool_and(blockchain_anchor_status='ballot_grouped' and hash_version='KANDID_VOTE_V2') from public.votes;")), "t");
    assert.equal(last(sql("select blockchain_anchor_status||':'||hash_version from public.vote_ballots;")), "pending:KANDID_BALLOT_V1");
  });
  check("independent SHA256 reconstruction matches both V2 rows and the ordered Ballot V1", () => {
    // These records are entirely synthetic; never run this query on production.
    const rows = JSON.parse(last(sql("select jsonb_agg(to_jsonb(v)||jsonb_build_object('display_order',p.display_order) order by p.display_order,v.position_id,v.is_abstain,v.candidate_id nulls last,v.id) from public.votes v join public.positions p on p.id=v.position_id;")));
    const ballot = JSON.parse(last(sql("select to_jsonb(b) from public.vote_ballots b;")));
    assert.match(ballot.ballot_nonce, /^[a-f0-9]{64}$/);
    assert.match(ballot.canonical_submitted_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    for (const row of rows) {
      assert.match(row.vote_nonce, /^[a-f0-9]{64}$/);
      assert.equal(row.canonical_vote_timestamp, ballot.canonical_submitted_at);
      const payload = `KANDID_VOTE_V2|vote_id:${row.id}|election_id:${row.election_id}|position_id:${row.position_id}|candidate_id:${row.candidate_id ?? "null"}|abstain:${row.is_abstain ? 1 : 0}|submitted_at:${row.canonical_vote_timestamp}|nonce:${row.vote_nonce}`;
      assert.equal(hash(payload), row.vote_hash);
    }
    assert.notEqual(rows[0].vote_nonce, rows[1].vote_nonce);
    const payload = `KANDID_BALLOT_V1|ballot_id:${ballot.id}|election_id:3|submitted_at:${ballot.canonical_submitted_at}|ballot_nonce:${ballot.ballot_nonce}|row_count:2|row_hashes:\n${rows.map(row=>row.vote_hash).join("\n")}`;
    assert.equal(hash(payload), ballot.ballot_hash);
  });
  check("duplicate election submission cannot create a second ballot", () => {
    assert.match(sql(service(insert(1)),false).stderr, /already voted in this election/);
    assert.equal(counts(), "[1, 2]");
  });
  check("multiple candidates for one position hit the existing uniqueness constraint atomically", () => {
    assert.match(sql(service(insert(4,3,[choices[0],{position_id:11,candidate_id:203,is_abstain:false}])),false).stderr, /votes_student_id_position_id_key/);
    assert.equal(counts(), "[1, 2]");
  });
  const parallel = await Promise.all([asyncSql(service(insert(2))),asyncSql(service(insert(2)))]);
  assert.equal(parallel.filter(result=>result.status===0).length,1);
  assert.match(parallel.find(result=>result.status!==0).stderr,/already voted in this election/);
  assert.equal(counts(),"[2, 4]");
  checks++;console.log("PASS simultaneous submissions commit exactly one complete ballot");
  console.log(`${checks} local PostgreSQL integrity checks passed; no production connection used.`);
} finally {
  assert.match(database, /^kandid_submit_check_[a-f0-9]{12}$/);
  const cleanup = docker(["exec",container,"dropdb","-U","postgres","--force",database]);
  assert.equal(cleanup.status,0,cleanup.stderr);
}
