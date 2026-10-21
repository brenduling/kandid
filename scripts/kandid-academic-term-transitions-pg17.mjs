// Fixed LOCAL container and a new random database only. No URL/env-file input.
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
assert.equal(process.argv.length, 2, 'This synthetic runner accepts no connection arguments');
const container = 'supabase_db_kandid-board-e2e-20261016-8c19';
const db = 'kandid_term_transition_' + randomBytes(6).toString('hex');
const run = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
const inspected = run(['inspect', container]);
assert.equal(inspected.status, 0, 'Local Docker inspection must succeed');
const info = JSON.parse(inspected.stdout)[0];
assert.equal(info.Config.Labels['com.supabase.cli.project'], 'kandid-board-e2e-20261016-8c19');
assert.equal(info.HostConfig.PortBindings['5432/tcp'][0].HostPort, '59322');
assert.match(info.Config.Image, /supabase\/postgres:17\./);
assert.match(db, /^kandid_term_transition_[a-f0-9]{12}$/);
assert.equal(run(['exec', container, 'createdb', '-U', 'postgres', '--template=template0', db]).status, 0);
const args = ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1'];
const sql = (query, ok = true) => {
  const r = run(args, query);
  if (ok) assert.equal(r.status, 0, r.stderr); else assert.notEqual(r.status, 0, 'Expected denial');
  return r;
};
const val = query => sql(query).stdout.trim().split('\n').at(-1);
const file = path => readFileSync(path, 'utf8');
const fn = (path, name) => {
  const match = file(path).match(new RegExp('create or replace function public\\.' + name + '\\([\\s\\S]*?\\$function\\$;', 'i'));
  assert.ok(match, 'Existing function found: ' + name); return match[0];
};
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const service = query => 'begin;set local role service_role;' + query + 'commit;';
const user = (n, query) => `begin;set local role authenticated;set local request.jwt.claim.sub='${uid(n)}';${query}commit;`;
const preview = (target = 2, actor = 501) => ({ ...JSON.parse(val(service(`select public.kandid_preview_academic_term_transition('${uid(actor)}',${target});`))), test_actor: actor });
const commitQuery = (review, actor = review.test_actor, phrase = review.confirmation_text, acknowledged = true) =>
  `select public.kandid_commit_academic_term_transition('${uid(actor)}','${review.operation_id}',${acknowledged},'${phrase.replaceAll("'", "''")}');`;
const getReceipt = review => JSON.parse(val(service(`select public.kandid_get_academic_term_transition('${uid(review.test_actor)}','${review.operation_id}');`)));
const forward = file('supabase/proposals/academic-term-transitions.sql');
const rollback = file('supabase/proposals/academic-term-transitions.rollback.sql');
const automatic = JSON.parse(file('tests/fixtures/automaticVoterEligibilityProductionContract.json'));
const integrity = JSON.parse(file('tests/fixtures/submitVoteIntegrityProductionContract.json'));
const membershipMigration = 'supabase/migrations/20261003130000_term_scoped_membership_activation_sync.sql';
const candidateMigration = 'supabase/migrations/20261021100000_candidate_eligibility_uses_election_term.sql';
const masterlistMigration = 'supabase/migrations/20261018100000_masterlist_import_scope_and_safe_finalization.sql';
const checks = [];
const check = (name, f) => { f(); checks.push(name); console.log('PASS ' + name); };
const parallel = query => new Promise((resolve, reject) => {
  const p = spawn('docker', args, { windowsHide: true }); let stdout = '', stderr = '';
  p.stdout.on('data', c => stdout += c); p.stderr.on('data', c => stderr += c);
  p.on('error', reject); p.on('close', status => resolve({ status, stdout, stderr })); p.stdin.end(query);
});
async function withWriter(lockQuery, concurrentCheck) {
  let ready;
  const acquired = new Promise(resolve => { ready = resolve; });
  const p = spawn('docker', args, { windowsHide: true });
  let stdout = '', stderr = '';
  p.stdout.on('data', c => { stdout += c; if (stdout.includes('WRITER_LOCKED')) ready(); });
  p.stderr.on('data', c => stderr += c);
  const done = new Promise((resolve, reject) => { p.on('error', reject); p.on('close', status => { ready(); resolve({ status, stderr }); }); });
  p.stdin.end(`begin;${lockQuery}select 'WRITER_LOCKED';select pg_sleep(3);rollback;`);
  await acquired;
  try { assert.ok(stdout.includes('WRITER_LOCKED'), stderr); concurrentCheck(); }
  finally { const result = await done; assert.equal(result.status, 0, result.stderr); }
}
try {
  const base = file('supabase/runtime-validation/board-verified-registration-pg17-fixture.sql')
    .split('-- Sentinels')[0].replace(/^CREATE ROLE .*;\r?\n/gm, '');
  sql(base); sql(file('supabase/runtime-validation/academic-term-transitions-fixture.sql'));
  for (const t of integrity.tables) sql(`create table public.${t.table} (${t.columns.map(c => `"${c.name}" ${c.type}${c.default ? ' default ' + c.default : ''}${c.not_null ? ' not null' : ''}`).join(',')});`);
  for (const c of integrity.constraints) sql(`alter table public.${c.table} add constraint "${c.name}" ${c.definition};`);
  // Preserve a real historical Ballot V1 row/hash without changing its schedule.
  sql(`insert into public.vote_ballots(id,student_id,election_id,canonical_submitted_at,ballot_hash,hash_version)
    values('00000000-0000-4000-8000-000000000900',1,10,'2026-01-01T00:00:00.000Z','0x'||repeat('a',64),'KANDID_BALLOT_V1');
    insert into public.votes(id,student_id,election_id,position_id,candidate_id,is_abstain,ballot_id)
    values(900,1,10,100,1000,false,'00000000-0000-4000-8000-000000000900');`);
  for (const f of automatic.functions) sql(f.definition + ';');
  sql(automatic.participation + ';');
  sql(`create trigger vote_ballots_require_locked_electorate before insert on public.vote_ballots for each row execute function private.kandid_require_locked_electorate_for_ballot();
    revoke all on function public.insert_v2_vote_rows(integer,integer,jsonb) from public,anon,authenticated;
    grant execute on function public.insert_v2_vote_rows(integer,integer,jsonb) to service_role;`);
  sql(file('supabase/proposals/automatic-voter-eligibility.sql'));
  sql(file(membershipMigration));
  sql(file('supabase/migrations/20261021120000_board_verified_student_registration.sql'));
  sql(fn('supabase/migrations/20260928130000_harden_board_position_mutations.sql', 'kandid_can_mutate_election_positions'));
  sql(fn(candidateMigration, 'kandid_guard_candidate_mutation'));
  sql(`create trigger candidates_trusted_mutation_guard before insert or update on public.candidates for each row execute function public.kandid_guard_candidate_mutation();`);
  sql(file('supabase/migration_archive/20260910112000_student_notifications_foundation.sql'));
  for (const name of ['kandid_audit_category_for_event', 'kandid_prepare_audit_event']) sql(fn('supabase/migrations/20261002130000_trusted_audit_foundation.sql', name));
  sql('create trigger audit_logs_prepare_insert before insert on public.audit_logs for each row execute function public.kandid_prepare_audit_event();');
  sql(fn('supabase/migrations/20261002110000_secure_organization_program_coverage.sql', 'kandid_ensure_program_catalog_entry_for_server_actor'));
  for (const name of ['finalize_masterlist_import', 'kandid_masterlist_full_roster_manifest', 'kandid_finalize_masterlist_import_with_membership_sync']) sql(fn(masterlistMigration, name));
  sql(fn('supabase/migrations/20261017000000_reconcile_memberships_on_current_term_program_change.sql', 'kandid_review_current_term_program_changes'));
  sql(fn('supabase/migrations/20260909090000_masterlist_human_review_foundation.sql', 'review_masterlist_import_row'));
  sql(`revoke all on function public.finalize_masterlist_import(integer),public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint),
    public.kandid_review_current_term_program_changes(integer,bigint) from public,anon,authenticated;
    revoke all on function public.review_masterlist_import_row(integer,text,text,text) from public,anon,service_role;
    grant execute on function public.finalize_masterlist_import(integer),public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint),
    public.kandid_review_current_term_program_changes(integer,bigint) to service_role;
    grant execute on function public.review_masterlist_import_row(integer,text,text,text) to authenticated;`);
  check('baseline candidate guard permits historical-term nomination without current enrollment (reproduced gap)', () => {
    const q = user(501, 'insert into public.candidates(id,student_id,position_id) values(999,4,110);').replace('commit;', 'rollback;');
    assert.equal(sql(q).status, 0);
  });
  const preserved = () => val(`select jsonb_build_object(
    'students',(select md5(jsonb_agg(to_jsonb(s) order by id)::text) from public.students s),
    'auth',(select md5(jsonb_agg(to_jsonb(u) order by id)::text) from auth.users u),
    'old_enrollments',(select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.student_term_enrollments e where academic_term_id<>2),
    'old_memberships',(select md5(jsonb_agg(to_jsonb(m) order by id)::text) from public.student_organization_terms m where academic_term_id<>2),
    'elections',(select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.elections e),
    'candidates',(select md5(jsonb_agg(to_jsonb(c) order by id)::text) from public.candidates c),
    'officers',(select md5(jsonb_agg(to_jsonb(o) order by id)::text) from public.officers o),
    'votes',(select md5(jsonb_agg(to_jsonb(v) order by id)::text) from public.votes v),
    'ballots',(select md5(jsonb_agg(to_jsonb(b) order by id)::text) from public.vote_ballots b),
    'receipts',(select md5(jsonb_agg(to_jsonb(r) order by id)::text) from public.receipt_sentinels r));`);
  const before = preserved();
  check('settings initialization inserts the guarded id 1 once, and fingerprint rollback refuses edited records', () => {
    assert.equal(val('select count(*) from public.system_settings;'), '0');
    sql(file('supabase/proposals/system-settings-initial-record.sql'));
    assert.equal(val('select id from public.system_settings;'), '1');
    assert.match(sql(file('supabase/proposals/system-settings-initial-record.sql'),false).stderr,/already been used|existing/);
    const fp = JSON.parse(val("select jsonb_build_object('xmin',xmin::text,'created',created_at::text) from public.system_settings where id=1;"));
    const undo = file('supabase/proposals/system-settings-initial-record.rollback.sql')
      .replace("v_expected_xmin text := 'REPLACE_WITH_RETURNED_ROLLBACK_XMIN'", `v_expected_xmin text := '${fp.xmin}'`)
      .replace("v_expected_created_at text := 'REPLACE_WITH_RETURNED_CREATED_AT'", `v_expected_created_at text := '${fp.created}'`);
    assert.match(sql('begin;update public.system_settings set system_name=\'Changed\';' + undo.replace(/^.*?BEGIN;/s,'').replace(/COMMIT;\s*$/,'rollback;'),false).stderr,/has changed/);
    sql(undo); assert.equal(val('select count(*) from public.system_settings;'), '0');
    sql('insert into public.system_settings(id) values(1);'); // Synthetic browser baseline only.
    assert.equal(preserved(), before);
  });
  // A pre-existing unrelated overload must not be swept into the new ACLs.
  sql('create function public.kandid_preview_academic_term_transition(integer) returns integer language sql as $$select 1$$;grant execute on function public.kandid_preview_academic_term_transition(integer) to authenticated;');
  const dependencySignatures = [
    'public.activate_academic_term(integer)', 'public.sync_organization_term_participation_for_activation(integer)',
    'public.resolve_student_organization_participation(integer,integer,integer)',
    'public.kandid_check_student_ballot_eligibility(integer)', 'public.insert_v2_vote_rows(integer,integer,jsonb)',
    'private.kandid_require_locked_electorate_for_ballot()', 'public.kandid_guard_candidate_mutation()',
    'public.kandid_finalize_masterlist_import_with_membership_sync(integer,bigint)',
    'public.kandid_board_register_verified_student_for_term_v1(bigint,integer,text,text,text,text,text,integer,text,boolean,boolean,text,text,text)',
  ];
  const dependencyBodies = JSON.parse(val(`select jsonb_object_agg(s,md5(pg_get_functiondef(s::regprocedure))) from unnest(array[${dependencySignatures.map(s => "'" + s + "'").join(',')}]) s;`));
  sql(forward);
  check('permission changes preserve unrelated pre-existing function overloads', () => {
    assert.equal(val("select has_function_privilege('authenticated','public.kandid_preview_academic_term_transition(integer)','EXECUTE');"), 't');
  });
  check('installation changes no student, enrollment, membership, election or historical evidence rows', () => assert.equal(preserved(), before));
  check('proposal replay stops without overwriting installed operations', () => assert.match(sql(forward, false).stderr, /already installed/));
  sql(rollback); sql(forward);
  check('pre-activation rollback and reinstall preserve all existing data', () => assert.equal(preserved(), before));
  check('authorized next-draft creation and retry preserve current eligibility and send no notifications', () => {
    const r = sql(`begin;
      update public.academic_terms set status='closed' where id=1;
      update public.academic_terms set status='active' where id=2;
      delete from public.academic_terms where id=4;
      set local role service_role;
      select public.kandid_create_next_academic_term('${uid(501)}','1st Semester',2027);
      select public.kandid_create_next_academic_term('${uid(501)}','1st Semester',2027);
      reset role;
      select jsonb_build_array((select id from public.academic_terms where status='active'),
        (select count(*) from public.student_notifications),(select count(*) from public.audit_logs where event_type='academic_term_created'));
      rollback;`);
    const lines = r.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(lines[0].status, 'draft'); assert.equal(lines[0].id, lines[1].id);
    assert.equal(lines[0].academic_year, '2027-2028'); assert.deepEqual(lines[2], [2, 0, 1]);
    assert.equal(preserved(), before);
  });
  check('draft creation rejects unauthorized actors and skipped or previous terms', () => {
    for (const actor of [503, 505, 999]) assert.match(sql(service(`select public.kandid_create_next_academic_term('${uid(actor)}','2nd Semester',2026);`), false).stderr, /Super Admin/);
    for (const [semester, year] of [['1st Semester',2026], ['1st Semester',2027]])
      assert.match(sql(service(`select public.kandid_create_next_academic_term('${uid(501)}','${semester}',${year});`), false).stderr, /immediate next/);
    assert.match(sql(`set role authenticated;select public.kandid_create_next_academic_term('${uid(501)}','2nd Semester',2026);`,false).stderr,/permission denied/);
  });
  check('status invalidates stale reviews under the commit lock before authorizing a fresh preview', () => {
    const r = preview();
    const result = JSON.parse(val(`begin;update public.students set status='pending' where id=1;
      set local role service_role;select public.kandid_get_academic_term_transition('${uid(501)}','${r.operation_id}');commit;`));
    assert.equal(result.can_refresh,true);
    assert.equal(result.confirmation_text,r.confirmation_text);
    assert.match(sql(service(commitQuery(r)),false).stderr,/expired/);
    sql("update public.students set status='active' where id=1;");
  });
  check('anon/authenticated cannot preview, commit, read private receipts or call the legacy activation RPC', () => {
    for (const role of ['anon', 'authenticated']) {
      assert.match(sql(`set role ${role};select public.kandid_preview_academic_term_transition('${uid(501)}',2);`, false).stderr, /permission denied/);
      assert.match(sql(`set role ${role};select * from private.academic_term_transition_reviews;`, false).stderr, /permission denied/);
      assert.match(sql(`set role ${role};select public.activate_academic_term(2);`, false).stderr, /permission denied/);
    }
    assert.match(sql(service('select public.activate_academic_term(2);'), false).stderr, /permission denied/);
  });
  check('Board, disabled, unknown and ambiguous actors cannot produce transition previews', () => {
    for (const actor of [503, 504, 505, 999]) assert.match(sql(service(`select public.kandid_preview_academic_term_transition('${uid(actor)}',2);`), false).stderr, /Super Admin/);
    assert.match(sql(`begin;insert into public.admin_users(id,full_name,role,status,auth_user_id) values(99,'Duplicate','super_admin','active','${uid(501)}');set local role service_role;select public.kandid_preview_academic_term_transition('${uid(501)}',2);commit;`, false).stderr, /unique active Super Admin/);
  });
  check('missing active term is recovery, never implicit bootstrap', () => {
    const result = JSON.parse(val(`begin;update public.academic_terms set status='closed' where id=1;set local role service_role;select public.kandid_preview_academic_term_transition('${uid(501)}',2);rollback;`));
    assert.equal(result.impact.can_activate, false);
  });
  const skipped = preview(4);
  check('skipped semesters cannot be activated even with explicit confirmation', () => {
    assert.equal(skipped.impact.can_activate, false);
    assert.match(sql(service(commitQuery(skipped)), false).stderr, /blocking impacts/);
  });
  check('closed terms cannot be reopened and the single-active index remains enforced', () => {
    assert.equal(preview(3).impact.can_activate, false);
    assert.match(sql("update public.academic_terms set status='active' where id=2;", false).stderr, /duplicate key/);
  });
  let review = preview();
  check('authoritative preview counts distinct accounts, new-term evidence and verified program shifts', () => {
    assert.equal(review.impact.can_activate, true);
    assert.equal(review.impact.counts.persistent_accounts, 8);
    assert.equal(review.impact.counts.source_enrolled_students, 8);
    assert.equal(review.impact.counts.target_enrolled_students, 2);
    assert.equal(review.impact.counts.active_accounts_requiring_verification, 4);
    assert.equal(review.impact.counts.verified_program_shifts, 1);
    assert.equal(review.impact.counts.intended_institution_memberships, 2);
    assert.equal(review.impact.counts.manual_memberships_carried, 1);
    assert.equal(review.confirmation_text, 'ACTIVATE 2nd Semester AY 2026-2027');
  });
  check('unchecked, wrong-text and cross-admin confirmations fail without changing terms', () => {
    assert.match(sql(service(commitQuery(review, 501, 'ACTIVATE')), false).stderr, /exact term confirmation/);
    assert.match(sql(service(commitQuery(review, 501, review.confirmation_text, false)), false).stderr, /acknowledgement/);
    assert.match(sql(service(commitQuery(review, 502)), false).stderr, /not found for this administrator/);
    assert.match(sql(service(`select public.kandid_get_academic_term_transition('${uid(502)}','${review.operation_id}');`), false).stderr, /not found for this administrator/);
  });
  check('expired previews cannot activate a term', () => {
    assert.match(sql(`begin;update private.academic_term_transition_reviews set expires_at=clock_timestamp()-interval '1 second' where operation_id='${review.operation_id}';set local role service_role;${commitQuery(review)}commit;`, false).stderr, /expired/);
  });
  for (const [name, mutation] of [
    ['equal-count student substitution', 'update public.student_term_enrollments set student_id=3 where student_id=2 and academic_term_id=2;'],
    ['verified program change', "update public.student_term_enrollments set program='BSHM' where student_id=2 and academic_term_id=2;"],
    ['program mapping edit', 'update public.organization_programs set program_id=20 where organization_id=101;'],
    ['catalog identity edit', "update public.programs set name='Changed identity' where id=10;"],
    ['target election schedule edit', "update public.elections set start_date=start_date+interval '1 hour' where id=20;"],
    ['student account eligibility change', "update public.students set status='disabled' where id=3;"],
  ]) check('stale review rejects ' + name, () => {
    assert.match(sql(`begin;${mutation}set local role service_role;${commitQuery(review)}commit;`, false).stderr, /impact changed/);
  });
  for (const [name, mutation, message] of [
    ['unresolved program', "update public.student_term_enrollments set program='BHM-unapproved' where student_id=2 and academic_term_id=2;", /unresolved/],
    ['incorrect WITSG scope', "update public.organizations set membership_scope='program' where id=100;", /WITSG/],
    ['unfinished source election', "insert into public.elections(id,organization_id,academic_term_id,status) values(30,100,1,'draft');", /ongoing, scheduled/],
  ]) check('preview blocks ' + name, () => {
    const data = JSON.parse(val(`begin;${mutation}set local role service_role;select public.kandid_preview_academic_term_transition('${uid(501)}',2);rollback;`));
    assert.equal(data.impact.can_activate, false); assert.match(data.impact.blockers.join(' '), message);
  });
  for (const [name, table, condition] of [
    ['membership synchronization', 'student_organization_terms', 'academic_term_id<>2'],
    ['notification insertion', 'student_notifications', "type<>'academic_term_activated'"],
    ['audit insertion', 'audit_logs', "event_type<>'academic_term_activated'"],
  ]) check(name + ' failure rolls the whole transition back, including closure and generated memberships', () => {
    // Fault injection is confined to this temporary synthetic database.
    assert.match(sql(`begin;alter table public.${table} add constraint synthetic_transition_failure check(${condition}) not valid;
      set local role service_role;${commitQuery(review)}commit;`, false).stderr, /synthetic_transition_failure/);
    assert.equal(val("select id from public.academic_terms where status='active';"), '1');
    assert.equal(val("select count(*) from public.student_organization_terms where academic_term_id=2;"), '0');
    assert.equal(val("select count(*) from public.student_notifications where type='academic_term_activated';"), '0');
    assert.equal(val("select count(*) from public.audit_logs where event_type='academic_term_activated';"), '0');
    assert.equal(getReceipt(review).status, 'review');
  });
  for (const [name, query] of [
    ['Board or ballot term row lock', 'select id from public.academic_terms where id=1 for share;'],
    ['enrollment update', 'update public.student_term_enrollments set year_level=year_level where student_id=1 and academic_term_id=2;'],
    ['organization configuration', 'update public.organizations set name=name where id=100;'],
    ['masterlist review write', "insert into public.masterlist_imports(id,academic_term_id) values(800,1);"],
  ]) {
    await withWriter(query, () => assert.match(sql(service(commitQuery(review)), false).stderr, /could not obtain lock|busy/));
    checks.push('concurrent ' + name + ' causes fail-fast conflict, no partial activation');
    console.log('PASS ' + checks.at(-1));
  }
  await withWriter('select pg_advisory_xact_lock(1,2);', () => {
    assert.match(sql(service(commitQuery(review)), false).stderr, /lock timeout/);
    assert.equal(val("select id from public.academic_terms where status='active';"), '1');
  });
  checks.push('later membership advisory waits time out and roll back the transition instead of holding institution-wide locks indefinitely');
  console.log('PASS ' + checks.at(-1));
  const receiptsBeforeRollbackRace = val('select count(*) from private.academic_term_transition_reviews;');
  await withWriter('select pg_advisory_xact_lock(20261003,12000);', () => {
    assert.match(sql(rollback, false).stderr, /busy/);
    assert.equal(val('select count(*) from private.academic_term_transition_reviews;'), receiptsBeforeRollbackRace);
    assert.equal(val("select has_function_privilege('service_role','public.activate_academic_term(integer)','EXECUTE');"), 'f');
  });
  checks.push('rollback refuses to race an in-flight transition rather than deleting its evidence');
  console.log('PASS ' + checks.at(-1));
  const peer = preview(2, 502);
  const raced = await Promise.all([parallel(service(commitQuery(review))), parallel(service(commitQuery(peer)))]);
  const winner = raced.findIndex(r => r.status === 0);
  assert.ok(winner >= 0); assert.equal(raced.filter(r => r.status === 0).length, 1);
  const stale = winner === 0 ? peer : review;
  review = winner === 0 ? review : peer;
  const result = JSON.parse(raced[winner].stdout.trim().split('\n').at(-1));
  check('two concurrent Super Admin reviews produce exactly one transition', () => {
    assert.match(raced[1 - winner].stderr, /impact changed|could not obtain lock|busy/);
    assert.match(sql(service(commitQuery(stale)), false).stderr, /impact changed/);
    assert.match(sql(service(commitQuery(skipped)), false).stderr, /impact changed/);
  });
  check('guarded commit closes prior term, activates next, and creates durable audit and notifications', () => {
    assert.equal(result.status, 'committed');
    assert.equal(val("select id from public.academic_terms where status='active';"), '2');
    assert.equal(val("select status from public.academic_terms where id=1;"), 'closed');
    assert.equal(val("select count(*) from public.audit_logs where event_type='academic_term_activated';"), '1');
    assert.equal(val("select (created_at is not null and actor_role='super_admin' and event_origin='trusted_database') from public.audit_logs where event_type='academic_term_activated';"), 't');
    assert.equal(val(`select user_id from public.audit_logs where event_type='academic_term_activated';`), review.test_actor === 501 ? '1' : '2');
    assert.equal(val("select count(*) from public.student_notifications where type='academic_term_activated';"), '8');
    assert.equal(getReceipt(review).operation_id, review.operation_id);
  });
  check('term transition preserves historical data, account status, credentials, navigation identity and election schedules', () => assert.equal(preserved(), before));
  check('verified BSIT to BSHM shift retains WITSG and historical PSITS, with new program mappings', () => {
    assert.equal(val("select string_agg(organization_id::text,',' order by organization_id) from public.student_organization_terms where student_id=1 and academic_term_id=2 and status='active';"), '100,103,104,105');
    assert.equal(val("select count(*) from public.student_organization_terms where student_id=1 and organization_id=101 and academic_term_id in(1,3) and status='active';"), '2');
    assert.equal(val('select year_level from public.student_term_enrollments where student_id=1 and academic_term_id=2;'), '2');
  });
  const replay = JSON.parse(val(service(commitQuery(review))));
  check('lost-response retry returns the same receipt without duplicate audit, notifications or term changes', () => {
    assert.deepEqual(replay, result);
    assert.equal(val("select count(*) from public.student_notifications where type='academic_term_activated';"), '8');
  });
  check('rollback refuses to erase committed transition receipts or notification evidence', () => assert.match(sql(rollback, false).stderr, /transition has committed/));
  check('next year rollover resolves correctly and refuses to strand target-term scheduled elections', () => {
    const nextReview = preview(4); assert.equal(nextReview.impact.source_term.id, 2);
    assert.equal(nextReview.impact.target_term.semester, '1st Semester');
    assert.equal(nextReview.impact.target_term.academic_year, '2027-2028');
    assert.match(nextReview.impact.blockers.join(' '), /ongoing, scheduled/);
  });
  check('new or reassigned historical candidacy is rejected while authorized historical metadata is preserved', () => {
    assert.match(sql(user(501, 'insert into public.candidates(id,student_id,position_id) values(999,4,110);'), false).stderr, /current academic term/);
    assert.match(sql(user(501, 'update public.candidates set student_id=4 where id=1001;'), false).stderr, /current academic term/);
    sql(user(501, "update public.candidates set bio='Authorized historical correction' where id=1001;").replace('commit;', 'rollback;'));
  });
  check('unverified new-term student cannot enter candidacy or be substituted into an existing record', () => {
    assert.match(sql(user(501, 'insert into public.candidates(id,student_id,position_id) values(999,3,200);'), false).stderr, /current-term enrollment/);
    assert.match(sql(user(501, 'update public.candidates set student_id=3 where id=2000;'), false).stderr, /current-term enrollment/);
    sql(user(501, 'insert into public.candidates(id,student_id,position_id) values(999,1,200);').replace('commit;', 'rollback;'));
  });
  check('authenticated students and foreign-scope Board still cannot authorize candidate creation', () => {
    for (const actor of [1, 504]) assert.match(sql(user(actor, 'insert into public.candidates(id,student_id,position_id) values(999,1,200);'), false).stderr, /not authorized/);
  });
  const boardVerify = (student = 1, program = 'BSIT', reviewed = true, board = 3, org = 100) => `select public.kandid_board_register_verified_student_for_term_v1(
    p_actor_admin_id=>${board},p_board_organization_id=>${org},p_student_number=>'90${String(student).padStart(3, '0')}',
    p_first_name=>'Student',p_last_name=>'Synthetic',p_email=>'synthetic-${student}@example.invalid',p_program=>'${program}',
    p_year_level=>2,p_verification_method=>'school_id',p_evidence_reviewed=>${reviewed},p_create_identity=>false);`;
  check('Board enrollment requires evidence and organization scope, including on reverification', () => {
    assert.match(sql(service(boardVerify(3, 'BSHM', false)), false).stderr, /evidence review/);
    assert.match(sql(service(boardVerify(3, 'BSHM', true, 4, 101)), false).stderr, /outside.*coverage/);
  });
  const oldEvidence = val("select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.student_term_enrollments e where academic_term_id in(1,3);");
  check('authorized Board reverifies enrollment without creating a new identity or changing account access', () => {
    const identityBefore = val('select status||password||auth_user_id::text from public.students where id=3;');
    sql(service(boardVerify(3, 'BSHM')));
    assert.equal(val('select count(*) from public.students;'), '8');
    assert.equal(val('select status||password||auth_user_id::text from public.students where id=3;'), identityBefore);
    assert.equal(val("select verification_method||':'||verified_by_admin_id from public.student_term_enrollments where student_id=3 and academic_term_id=2;"), 'school_id:3');
    assert.equal(val("select string_agg(organization_id::text,',' order by organization_id) from public.student_organization_terms where student_id=3 and academic_term_id=2 and status='active';"), '100,103,104');
  });
  check('verified same-term shift reconciles only program organizations and preserves WITSG/manual memberships', () => {
    sql(service(boardVerify(1, 'BSIT')));
    assert.equal(val("select string_agg(organization_id::text,',' order by organization_id) from public.student_organization_terms where student_id=1 and academic_term_id=2 and status='active';"), '100,101,105');
    assert.equal(val("select count(*) from public.student_organization_terms where student_id=1 and academic_term_id=2 and organization_id in(103,104) and removal_reason='program_change_reconciliation';"), '2');
    assert.equal(val("select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.student_term_enrollments e where academic_term_id in(1,3);"), oldEvidence);
  });
  check('legacy conflicting program memberships abort verification atomically instead of leaving two programs current', () => {
    const prior = val('select md5(to_jsonb(e)::text) from public.student_term_enrollments e where student_id=2 and academic_term_id=2;');
    assert.match(sql(`begin;update public.student_organization_terms set source='manual' where student_id=2 and academic_term_id=2 and organization_id=101;
      set local role service_role;${boardVerify(2, 'BSHM')}commit;`, false).stderr, /Conflicting current program memberships/);
    assert.equal(val('select md5(to_jsonb(e)::text) from public.student_term_enrollments e where student_id=2 and academic_term_id=2;'), prior);
  });
  sql(`insert into public.masterlist_imports(id,academic_term_id) values(501,2);
    insert into public.masterlist_import_rows(id,import_id,row_number,student_number,first_name,last_name,email,program,year_level,matched_student_id,reconciliation_status)
    values(5011,501,1,'90001','Student','Synthetic','synthetic-1@example.invalid','BSHM',2,1,'continuing');`);
  sql(service('select public.kandid_review_current_term_program_changes(501,1);'));
  check('existing masterlist detects verified identity program shift and blocks finalization pending authorized review', () => {
    assert.equal(val("select reconciliation_status||':'||review_status from public.masterlist_import_rows where id=5011;"), 'shifted_program:pending_review');
    assert.match(sql(service('select public.kandid_finalize_masterlist_import_with_membership_sync(501,1);'), false).stderr, /require approval/);
  });
  // Existing authenticated human-review RPC derives its actor from auth.uid()
  // and checks the current review fingerprint, separate from service finalization.
  const shiftFingerprint = val('select review_fingerprint from public.masterlist_import_rows where id=5011;');
  sql(user(501, `select public.review_masterlist_import_row(5011,'${shiftFingerprint}','approve_shifted_program','Synthetic authorized review');`));
  check('authorized reviewed masterlist reconciliation preserves WITSG and restores only mapped current program scope', () => {
    sql(service('select public.kandid_finalize_masterlist_import_with_membership_sync(501,1);'));
    assert.equal(val("select string_agg(organization_id::text,',' order by organization_id) from public.student_organization_terms where student_id=1 and academic_term_id=2 and status='active';"), '100,103,104,105');
    assert.equal(val('select count(*) from public.students;'), '8');
    assert.equal(val("select md5(jsonb_agg(to_jsonb(e) order by id)::text) from public.student_term_enrollments e where academic_term_id in(1,3);"), oldEvidence);
  });
  // Open only the SYNTHETIC election for ballot checks; transition code never
  // modifies real or fixture election schedules itself.
  sql("update public.elections set start_date=timezone('Asia/Manila',now())-interval '1 hour',end_date=timezone('Asia/Manila',now())+interval '1 hour' where id=20;");
  const eligibility = n => val(user(n, 'select public.kandid_check_student_ballot_eligibility(20);'));
  const ballot = n => service(`select * from public.insert_v2_vote_rows(${n},20,'[{"position_id":200,"candidate_id":2000,"is_abstain":false}]'::jsonb);`);
  check('canonical JWT voting predicate rejects missing new-term enrollment despite old enrollment and memberships', () => {
    assert.equal(eligibility(4), 'f'); assert.equal(eligibility(1), 't'); assert.equal(eligibility(3), 't');
    assert.match(sql(ballot(4), false).stderr, /not eligible|current-term enrollment/);
    assert.equal(val('select count(*) from public.vote_ballots where student_id=4 and election_id=20;'), '0');
  });
  check('non-enrolled and missing current participation fail closed at the actual ballot write', () => {
    assert.match(sql(`begin;update public.student_term_enrollments set enrollment_status='not_in_masterlist' where student_id=2 and academic_term_id=2;
      set local role service_role;select * from public.insert_v2_vote_rows(2,20,'[{"position_id":200,"candidate_id":2000,"is_abstain":false}]');commit;`, false).stderr, /not eligible|current-term enrollment/);
  });
  check('profile program edits cannot establish verified enrollment or memberships', () => {
    assert.match(sql(user(4, "update public.students set program='BSHM' where id=4;"), false).stderr, /permission denied/);
    assert.equal(val(`begin;update public.students set program='BSHM' where id=4;set local role authenticated;set local request.jwt.claim.sub='${uid(4)}';select public.kandid_check_student_ballot_eligibility(20);rollback;`), 'f');
  });
  check('normal voting still creates Ballot V1 evidence, and duplicate ballots are prevented', () => {
    sql(ballot(1));
    assert.equal(val("select hash_version from public.vote_ballots where student_id=1 and election_id=20;"), 'KANDID_BALLOT_V1');
    assert.equal(val("select ballot_hash ~ '^0x[0-9a-f]{64}$' from public.vote_ballots where student_id=1 and election_id=20;"), 't');
    assert.match(sql(ballot(1), false).stderr, /already voted/);
    assert.equal(val('select count(*) from public.vote_ballots where student_id=1 and election_id=20;'), '1');
  });
  check('existing activation, reconciliation, authorization and canonical hashing RPC bodies remain unchanged', () => {
    const afterBodies = JSON.parse(val(`select jsonb_object_agg(s,md5(pg_get_functiondef(s::regprocedure))) from unnest(array[${dependencySignatures.map(s => "'" + s + "'").join(',')}]) s;`));
    assert.deepEqual(afterBodies, dependencyBodies);
  });
  const fanoutStarted = Date.now();
  check('atomic notification fanout handles 5008 synthetic recipients without altering accounts or leaving records after fixture rollback', () => {
    sql(`begin;
      update public.elections set status='archived' where id=20;
      insert into public.students(id,student_number,first_name,last_name,status)
        select n,'synthetic-load-'||n,'Load','Fixture','pending' from generate_series(1000,5999) n;
      set local role service_role;
      do $test$ declare r jsonb; outcome jsonb;
      begin
        r := public.kandid_preview_academic_term_transition('${uid(501)}',4);
        outcome := public.kandid_commit_academic_term_transition('${uid(501)}',(r->>'operation_id')::uuid,true,r->>'confirmation_text');
        if (outcome->>'notification_count')::integer<>5008 then raise exception 'Synthetic fanout count differs'; end if;
      end $test$;
      rollback;`);
    assert.equal(val('select count(*) from public.students;'), '8');
    assert.equal(val("select count(*) from public.student_notifications where type='academic_term_activated';"), '8');
    assert.equal(val("select id from public.academic_terms where status='active';"), '2');
  });
  const fanoutFixtureMs = Date.now() - fanoutStarted;
  if (process.env.KANDID_TERM_BROWSER === '1') {
    await new Promise((resolve, reject) => {
      const browser = spawn(process.execPath, ['scripts/kandid-academic-term-danger-zone-browser.mjs'], {
        windowsHide: true, stdio: 'inherit', env: { ...process.env, KANDID_TERM_TEST_TEMPLATE: db },
      });
      browser.on('error', reject); browser.on('exit', code => code === 0 ? resolve() : reject(Error('Isolated browser workflow failed')));
    });
  }
  writeFileSync('.tmp/academic-term-transition-dependencies.json', JSON.stringify({ evidence: 'Isolated local fixture, not deployed-state verification', dependencyBodies }, null, 2));
  console.log(`${checks.length} isolated PostgreSQL checks passed. Production connections: zero.`);
  writeFileSync('.tmp/academic-term-transitions-pg17.json', JSON.stringify({ checks, passed: checks.length, productionConnections: 0, postgres: info.Config.Image, fanoutFixtureMs }, null, 2));
} finally {
  assert.match(db, /^kandid_term_transition_[a-f0-9]{12}$/);
  assert.equal(run(['exec', container, 'dropdb', '-U', 'postgres', '--force', db]).status, 0);
}
