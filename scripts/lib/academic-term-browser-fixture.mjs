// Browser transport fixture: real Edge handler -> real SQL RPC bodies in a
// disposable, verified LOCAL PostgreSQL clone. Never accepts URLs or .env.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { handleCorsPreflight, rejectDisallowedOrigin, withKandidCors } from '../../supabase/functions/_shared/kandidProductionSecurity.mjs';

export function academicTermBrowserFixture() {
  const template = process.env.KANDID_TERM_TEST_TEMPLATE;
  assert.match(template || '', /^kandid_term_transition_[a-f0-9]{12}$/);
  const db = 'kandid_term_browser_' + randomBytes(6).toString('hex');
  const container = 'supabase_db_kandid-board-e2e-20261016-8c19';
  const run = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', windowsHide: true });
  const inspection = run(['inspect', container]); assert.equal(inspection.status, 0);
  const info = JSON.parse(inspection.stdout)[0];
  assert.equal(info.Config.Labels['com.supabase.cli.project'], 'kandid-board-e2e-20261016-8c19');
  assert.equal(info.HostConfig.PortBindings['5432/tcp'][0].HostPort, '59322');
  assert.match(info.Config.Image, /supabase\/postgres:17\./);
  const query = text => run(['exec', '-i', container, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], text);
  const sql = text => { const r = query(text); assert.equal(r.status, 0, r.stderr); return r.stdout.trim().split('\n').filter(Boolean); };
  const value = text => JSON.parse(sql(text).at(-1));
  let exists = false, handler;
  const literal = v => v === null ? 'null' : typeof v === 'boolean' ? String(v) : typeof v === 'number' && Number.isSafeInteger(v) ? String(v) : "'" + String(v).replaceAll("'", "''") + "'";
  const signatures = {
    kandid_create_next_academic_term: ['p_actor_auth_user_id', 'p_semester', 'p_start_year'],
    kandid_preview_academic_term_transition: ['p_actor_auth_user_id', 'p_target_term_id'],
    kandid_get_academic_term_transition: ['p_actor_auth_user_id', 'p_operation_id'],
    kandid_commit_academic_term_transition: ['p_actor_auth_user_id', 'p_operation_id', 'p_acknowledged', 'p_confirmation_text'],
  };
  const uuid = '00000000-0000-4000-8000-000000000501';
  const user = { id: uuid, aud: 'authenticated', role: 'authenticated', email: 'synthetic-admin@example.invalid', app_metadata: { provider: 'email' }, user_metadata: {} };
  const client = (_url, key) => key === 'synthetic-anon' ? { auth: { getUser: async () => ({ data: { user }, error: null }) } } : {
    from(table) {
      assert.equal(table, 'admin_users');
      const q = { select: () => q, eq: (column, id) => { assert.equal(column, 'auth_user_id'); assert.equal(id, uuid); return q; }, limit: () => q,
        then: (yes, no) => Promise.resolve({ data: value(`select jsonb_agg(a) from public.admin_users a where auth_user_id='${uuid}';`), error: null }).then(yes, no) };
      return q;
    },
    async rpc(name, args) {
      assert.ok(Object.hasOwn(signatures, name));
      assert.deepEqual(Object.keys(args).sort(), signatures[name].toSorted());
      const r = query(`begin;set local role service_role;select public.${name}(${signatures[name].map(key => literal(args[key])).join(',')});commit;`);
      return r.status === 0 ? { data: JSON.parse(r.stdout.trim().split('\n').at(-1)), error: null }
        : { data: null, error: { code: r.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] || 'XX000', message: 'Synthetic database request failed' } };
    },
  };
  const code = transformSync(readFileSync('supabase/functions/admin-academic-terms/index.ts', 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  vm.runInNewContext(code, { require: name => name.includes('kandidProductionSecurity') ? {
    handleCorsPreflight, rejectDisallowedOrigin, serveWithKandidCors: fn => { handler = async req => withKandidCors(req, await fn(req)); },
  } : { createClient: client }, module: { exports: {} }, exports: {}, Request, Response,
  Deno: { env: { get: name => ({ SUPABASE_URL: 'https://fixture.invalid', SUPABASE_ANON_KEY: 'synthetic-anon', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' })[name] } } });
  const drop = () => {
    if (!exists) return;
    assert.match(db, /^kandid_term_browser_[a-f0-9]{12}$/);
    assert.equal(run(['exec', container, 'dropdb', '-U', 'postgres', '--force', db]).status, 0); exists = false;
  };
  return {
    user, drop, sql, value,
    reset() {
      drop(); assert.equal(run(['exec', container, 'createdb', '-U', 'postgres', '--template=' + template, db]).status, 0); exists = true;
      // These mutations affect only the disposable clone, never the template.
      sql(`truncate private.academic_term_transition_reviews;
        delete from public.academic_terms where id=4;
        update public.elections set status='archived' where id=20;`);
      sql(readFileSync('supabase/proposals/academic-term-transitions.preflight.sql','utf8'));
    },
    terms: () => value('select coalesce(jsonb_agg(t order by id),\'[]\') from public.academic_terms t;'),
    admin: () => value('select to_jsonb(a) from public.admin_users a where id=1;'),
    settings: () => value("select coalesce((select to_jsonb(s) from public.system_settings s where id=1),'null'::jsonb);"),
    async invoke(body) {
      const response = await handler(new Request('https://fixture.invalid', { method: 'POST', headers: { Origin: 'http://localhost:5174', Authorization: 'Bearer synthetic-only', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      return { status: response.status, body: await response.json() };
    },
  };
}
