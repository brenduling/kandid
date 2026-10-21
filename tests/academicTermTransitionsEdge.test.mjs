import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { handleCorsPreflight, rejectDisallowedOrigin, withKandidCors } from '../supabase/functions/_shared/kandidProductionSecurity.mjs';

const actorUuid = '00000000-0000-4000-8000-000000000501';
const operationId = '00000000-0000-4000-8000-000000000601';
const administrator = { id: 1, auth_user_id: actorUuid, role: 'super_admin', status: 'active' };
const confirmationText = 'ACTIVATE 2nd Semester AY 2026-2027';
const code = transformSync(readFileSync('supabase/functions/admin-academic-terms/index.ts', 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;

function fixture(overrides = {}) {
  const state = { profiles: [administrator], authError: null, authThrows: false, rpcError: null,
    queryError: null, rpcThrows: false, result: { operation_id: operationId, status: 'committed', impact: { can_activate: true } }, calls: [], ...overrides };
  let handler;
  const createClient = (_url, key) => key === 'publishable-fixture' ? {
    auth: { async getUser() {
      if (state.authThrows) throw Error('synthetic private server detail');
      return { data: { user: state.authError ? null : { id: actorUuid } }, error: state.authError };
    } },
  } : {
    from(table) {
      state.calls.push({ table });
      const query = {
        select() { return query; }, eq() { return query; }, limit() { return query; },
        insert(rows) { state.calls.push({ insert: table, rows }); return query; },
        async single() { return { data: { id: 2, status: 'draft' }, error: state.queryError }; },
        then(resolve, reject) { return Promise.resolve({ data: state.profiles, error: state.queryError }).then(resolve, reject); },
      }; return query;
    },
    async rpc(name, args) {
      state.calls.push({ rpc: name, args });
      if (state.rpcThrows) throw Error('synthetic private server detail');
      return { data: state.result, error: state.rpcError };
    },
  };
  vm.runInNewContext(code, {
    require: name => name.includes('kandidProductionSecurity') ? {
      handleCorsPreflight, rejectDisallowedOrigin,
      serveWithKandidCors: fn => { handler = async request => withKandidCors(request, await fn(request)); },
    } : { createClient },
    module: { exports: {} }, exports: {}, Response, Request,
    Deno: { env: { get: name => ({ SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'publishable-fixture', SUPABASE_SERVICE_ROLE_KEY: 'service-fixture' })[name] } },
  });
  return { state, handler };
}
async function invoke(f, body, authorization = 'Bearer synthetic-valid-session') {
  const response = await f.handler(new Request('https://example.invalid', { method: 'POST',
    headers: { Origin: 'http://localhost:5174', 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) }, body: JSON.stringify(body) }));
  return { response, body: await response.json() };
}

test('missing/invalid auth and linked Board, disabled, missing or ambiguous admins cannot preview or activate', async () => {
  for (const overrides of [
    { authError: { message: 'expired' } }, { authThrows: true }, { profiles: [] },
    { profiles: [{ ...administrator, role: 'electoral_board' }] },
    { profiles: [{ ...administrator, status: 'disabled' }] },
    { profiles: [{ ...administrator, auth_user_id: operationId }] },
    { profiles: [administrator, { ...administrator, id: 2 }] },
  ]) {
    const f = fixture(overrides);
    const result = await invoke(f, { action: 'preview', termId: 2 });
    assert.ok(result.response.status >= 400);
    assert.equal(f.state.calls.some(c => c.rpc || c.insert), false);
  }
  for (const authorization of ['', 'Basic synthetic']) assert.equal((await invoke(fixture(), { action: 'preview', termId: 2 }, authorization)).response.status, 401);
});

test('preview delegates aggregate calculation to the service RPC and uses only verified Auth actor', async () => {
  const f = fixture();
  const { response } = await invoke(f, { action: 'preview', termId: 2 });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.calls.filter(c => c.rpc))), [{ rpc: 'kandid_preview_academic_term_transition', args: { p_actor_auth_user_id: actorUuid, p_target_term_id: 2 } }]);
  assert.equal(f.state.calls.some(c => c.table && c.table !== 'admin_users'), false);
});

test('unreviewed legacy activation, forged actors/counts, unknown actions, arrays and invalid IDs fail closed', async () => {
  for (const body of [null, [], { action: 'other' }, { action: 'preview', termId: '2' }, { action: 'preview', termId: -1 },
    { action: 'preview', termId: 2, actorId: 1 }, { action: 'preview', termId: 2, counts: {} },
    { action: 'activate', termId: 2 }, { action: 'activate', operationId, acknowledged: true, confirmationText, actor_auth_user_id: actorUuid },
    { action: 'activate', operationId, acknowledged: false, confirmationText }, { action: 'activate', operationId: 'bad', acknowledged: true, confirmationText },
  ]) {
    const f = fixture();
    assert.equal((await invoke(f, body)).response.status, 400);
    assert.equal(f.state.calls.some(c => c.rpc || c.insert), false);
  }
});

test('activation requires explicit confirmation and uses the guarded commit, never the legacy activation RPC', async () => {
  const f = fixture();
  const { response, body } = await invoke(f, { action: 'activate', operationId, acknowledged: true, confirmationText });
  assert.equal(response.status, 200); assert.equal(body.data.status, 'committed');
  const calls = JSON.parse(JSON.stringify(f.state.calls.filter(c => c.rpc)));
  assert.deepEqual(calls, [{ rpc: 'kandid_commit_academic_term_transition', args: { p_actor_auth_user_id: actorUuid,
    p_operation_id: operationId, p_acknowledged: true, p_confirmation_text: confirmationText } }]);
});

test('conflict, expiry and authorization failures are safe errors and never automatically retry a mutation', async () => {
  for (const [code, status] of [['40001', 409], ['55P03', 409], ['55000', 409], ['23514', 409], ['42501', 403], ['P0002', 404], ['22023', 400], ['PGRST202', 503]]) {
    const f = fixture({ rpcError: { code, message: 'synthetic private database detail' } });
    const result = await invoke(f, { action: 'activate', operationId, acknowledged: true, confirmationText });
    assert.equal(result.response.status, status); assert.doesNotMatch(JSON.stringify(result.body), /private database detail/);
    assert.equal(f.state.calls.filter(c => c.rpc).length, 1);
  }
});

test('interrupted or unconfirmed commits instruct receipt recovery without claiming a successful activation', async () => {
  for (const overrides of [{ rpcThrows: true }, { result: null }, { result: { operation_id: operationId, status: 'review' } }]) {
    const result = await invoke(fixture(overrides), { action: 'activate', operationId, acknowledged: true, confirmationText });
    assert.equal(result.response.status, 503); assert.match(result.body.error, /status/i);
    assert.doesNotMatch(result.body.error, /synthetic private/);
  }
  const f = fixture();
  assert.equal((await invoke(f, { action: 'transition_status', operationId })).response.status, 200);
  assert.equal(f.state.calls.filter(c => c.rpc)[0].rpc, 'kandid_get_academic_term_transition');
});

test('draft creation delegates next-term validation to the guarded RPC and never inserts directly', async () => {
  const f = fixture({ result: { id: 2, status: 'draft' } });
  const result = await invoke(f, { action: 'create', semester: '2nd Semester', startYear: 2026 });
  assert.equal(result.response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.calls.find(c => c.rpc))), { rpc: 'kandid_create_next_academic_term', args: { p_actor_auth_user_id: actorUuid, p_semester: '2nd Semester', p_start_year: 2026 } });
  assert.equal(f.state.calls.some(c => c.insert), false);
});
