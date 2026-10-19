import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { transformSync } from "esbuild";
import {
  handleCorsPreflight,
  rejectDisallowedOrigin,
  withKandidCors,
} from "../supabase/functions/_shared/kandidProductionSecurity.mjs";

const FUNCTION_PATH = "supabase/functions/student-notifications/index.ts";
const CLIENT_PATH = "src/utils/notifications.js";

function fixture(overrides = {}) {
  return {
    userId: "auth-student-a",
    authError: null,
    authThrows: false,
    students: [
      { id: 11, auth_user_id: "auth-student-a", status: "active" },
      { id: 22, auth_user_id: "auth-student-b", status: "active" },
    ],
    notifications: [
      { id: 101, student_id: 11, title: "A notice", is_read: false, created_at: "2026-10-01T00:00:00Z" },
      { id: 202, student_id: 22, title: "B private notice", is_read: false, created_at: "2026-10-02T00:00:00Z" },
    ],
    reads: [],
    clientKeys: [],
    authOptions: [],
    ...overrides,
  };
}

function matches(row, filters) {
  return Object.entries(filters).every(([key, value]) => row[key] === value);
}

function loadHandler(state, functionPath = FUNCTION_PATH) {
  let handler;
  const source = readFileSync(functionPath, "utf8");
  const compiled = transformSync(source, { loader: "ts", format: "cjs", target: "es2022" }).code;
  const createClient = (_url, key, options = {}) => {
    state.clientKeys.push(key);
    if (key === "anon") {
      state.authOptions.push(options);
      return {
        auth: {
          getUser: async () => {
            if (state.authThrows) throw new Error("auth service unavailable");
            return state.authError || state.userId
              ? { data: { user: state.userId ? { id: state.userId, email: "synthetic@example.invalid", email_confirmed_at: state.unconfirmed ? null : "2026-10-17" } : null }, error: state.authError }
              : { data: { user: null }, error: new Error("Invalid token") };
          },
        },
      };
    }

    return {
      from(table) {
        const rowsForTable = table === "student_notifications" ? state.notifications : state[table].map(row => ({ email: "synthetic@example.invalid", ...row }));
        const filters = {};
        let offset = 0;
        let rowLimit = Infinity;
        let update = null;
        const query = {
          select() { return query; },
          eq(column, value) { filters[column] = value; return query; },
          order() { return query; },
          limit(value) { rowLimit = value; return query; },
          range(start, end) { offset = start; rowLimit = end - start + 1; return query; },
          update(changes) { update = changes; return query; },
          async maybeSingle() {
            const row = rowsForTable.find((item) => matches(item, filters)) || null;
            if (row && update) Object.assign(row, update);
            if (update) state.reads.push({ table, id: row?.id ?? null, filters, changes: update });
            return { data: row, error: null };
          },
          then(resolve, reject) {
            if (state.failTable === table) return Promise.resolve({ data: null, error: { message: "synthetic unavailable" } }).then(resolve, reject);
            let rows = rowsForTable.filter((item) => matches(item, filters)).slice(offset, offset + rowLimit);
            if (update) {
              for (const row of rows) Object.assign(row, update);
              state.reads.push({ table, ids: rows.map((row) => row.id), filters, changes: update });
            }
            return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
          },
        };
        return query;
      },
    };
  };

  vm.runInNewContext(compiled, {
    require: (specifier) => specifier.includes("kandidProductionSecurity")
      ? {
        handleCorsPreflight,
        rejectDisallowedOrigin,
        serveWithKandidCors: (handlerFn) => {
          handler = async (request) => withKandidCors(request, await handlerFn(request));
        },
      }
      : ({ createClient }),
    module: { exports: {} },
    exports: {},
    Deno: {
      env: { get: (key) => ({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
      })[key] },
      serve: (value) => { handler = value; },
    },
    Request,
    Response,
  }, { filename: FUNCTION_PATH });
  return handler;
}

async function call(handler, body, { token = "valid-token", method = "POST" } = {}) {
  const response = await handler(new Request("https://example.test", {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
  return { status: response.status, body: await response.json() };
}

test("Student notification list is scoped to the unique active auth.uid mapping", async () => {
  const state = fixture();
  const result = await call(loadHandler(state), {
    action: "list",
    limit: 20,
  });

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(JSON.parse(JSON.stringify(result.body.data.notifications.map((row) => row.id))), [101]);
  assert.equal(state.clientKeys[0], "service-role");
  assert.equal(state.clientKeys[1], "anon");
  assert.equal(state.authOptions[0].global.headers.Authorization, "Bearer valid-token");
});

test("Student A cannot mark Student B notification read, even with supplied identity fields", async () => {
  const state = fixture();
  const result = await call(loadHandler(state), {
    action: "mark_read",
    notification_id: 202,
  });

  assert.equal(result.status, 404, JSON.stringify(result.body));
  assert.equal(state.notifications[1].is_read, false);
  assert.equal(state.reads.length, 0);
});

test("Student can mark only their own notification read", async () => {
  const state = fixture();
  const result = await call(loadHandler(state), { action: "mark_read", notification_id: 101 });

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(state.notifications[0].is_read, true);
  assert.equal(state.notifications[1].is_read, false);
  assert.equal(state.reads.length, 1);
  assert.equal(state.reads[0].filters.student_id, 11);
});

test("unauthenticated and invalid sessions fail before notification access", async () => {
  const missingState = fixture();
  assert.equal((await call(loadHandler(missingState), { action: "list" }, { token: null })).status, 401);
  assert.deepEqual(missingState.clientKeys, ["service-role"]);

  const invalidState = fixture({ userId: null });
  assert.equal((await call(loadHandler(invalidState), { action: "list" })).status, 401);
  assert.deepEqual(invalidState.clientKeys, ["service-role", "anon"]);

  const unavailableState = fixture({ authThrows: true });
  const unavailable = await call(loadHandler(unavailableState), { action: "list" });
  assert.equal(unavailable.status, 500);
  assert.deepEqual(JSON.parse(JSON.stringify(unavailable.body)), { error: "Student access could not be verified." });
});

test("missing, inactive, and ambiguous student mappings fail closed", async (t) => {
  const cases = [
    ["missing mapping", []],
    ["inactive mapping", [{ id: 11, auth_user_id: "auth-student-a", status: "disabled" }]],
    ["ambiguous mapping", [
      { id: 11, auth_user_id: "auth-student-a", status: "active" },
      { id: 12, auth_user_id: "auth-student-a", status: "active" },
    ]],
  ];

  for (const [name, students] of cases) {
    await t.test(name, async () => {
      const state = fixture({ students });
      const result = await call(loadHandler(state), { action: "list" });
      assert.equal(result.status, 403);
      assert.equal(state.notifications.length, 2);
    });
  }
});

test("an authenticated student with no notifications receives an empty list", async () => {
  const state = fixture({ notifications: [] });
  const result = await call(loadHandler(state), { action: "list" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(JSON.parse(JSON.stringify(result.body.data.notifications)), []);
});

test("client Student notification requests carry no legacy credentials or identity authority", () => {
  const source = readFileSync(CLIENT_PATH, "utf8");
  const listCall = source.slice(source.indexOf('invoke("student-notifications"'), source.indexOf("if (error)", source.indexOf('invoke("student-notifications"')));
  const markCallStart = source.indexOf('invoke("student-notifications"', source.indexOf("export async function markStoredNotificationRead"));
  const markCall = source.slice(markCallStart, source.indexOf("return { error", markCallStart));

  assert.match(listCall, /action: "list"[\s\S]*limit: 20/);
  assert.match(markCall, /action: "mark_read"[\s\S]*notification_id: numericId/);
  assert.doesNotMatch(listCall, /student_number|password|student_id/);
  assert.doesNotMatch(markCall, /student_number|password|student_id/);
  assert.doesNotMatch(source, /function studentCredentials|localStorage\.getItem\("user"\)/);
});

test("the endpoint derives private notification identity only from authenticated mapping", () => {
  const source = readFileSync(FUNCTION_PATH, "utf8");
  const resolver = source.slice(source.indexOf("async function resolveStudent"), source.indexOf("async function handleList"));
  assert.match(resolver, /auth\.getUser\(\)/);
  assert.match(resolver, /\.eq\("auth_user_id", user\.id\)/);
  assert.match(resolver, /\.limit\(2\)/);
  assert.match(resolver, /students\.length !== 1/);
  assert.match(resolver, /student\.status !== "active"/);
  assert.doesNotMatch(resolver, /student_number|password|body\./);
  assert.match(source, /\.eq\("student_id", studentId\)/g);
});

test("notification ordering, mark-all behavior, and Board/Super Admin streams stay intact", () => {
  const endpoint = readFileSync(FUNCTION_PATH, "utf8");
  const client = readFileSync(CLIENT_PATH, "utf8");
  const page = readFileSync("src/pages/shared/NotificationsPage.jsx", "utf8");

  assert.match(endpoint, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(endpoint, /\.range\(offset, offset \+ limit\)/);
  assert.match(endpoint, /metadata, is_read, created_at, read_at/);
  assert.match(client, /user\.role === "electoral_board"\) \{\s*items = await buildBoardNotifications\(user\)/);
  assert.match(client, /user\.role === "super_admin"\) \{\s*items = await buildSuperAdminNotifications\(user\)/);
  assert.match(page, /markAllNotificationsRead\(activeUser, notifications\)/);
  assert.match(page, /filter\(\(item\) => item\.storedId && !item\.isRead\)[\s\S]*markStoredNotificationRead/);
});

test("forged notification identity, unsupported actions and unbounded pages are rejected",async()=>{
 for(const body of [{action:'list',student_id:22},{action:'list',password:'synthetic'},{action:'list',limit:51},{action:'list',offset:-1},{action:'list',offset:10001},{action:'list',limit:'20'},{action:'mark_read',notification_id:101,student_id:22},{action:'create'}]){
  const state=fixture();assert.equal((await call(loadHandler(state),body)).status,400);assert.equal(state.reads.length,0);
 }
});

test("notification pagination is self-scoped and read-only, with safe metadata",async()=>{
 const state=fixture({notifications:[{id:101,student_id:11,metadata:{href:'https://unapproved.example',private:'not exported'}},{id:102,student_id:11,metadata:{href:'/student/profile'}},{id:103,student_id:22}]});
 const first=await call(loadHandler(state),{action:'list',limit:1,offset:0});
 assert.equal(first.status,200);assert.equal(first.body.data.notifications[0].metadata.href,'/student/notifications');
 assert.equal(first.body.data.notifications[0].metadata.private,undefined);
 const second=await call(loadHandler(state),{action:'list',limit:1,offset:1});
 assert.equal(second.body.data.notifications[0].id,102);assert.equal(second.body.data.has_more,false);assert.equal(state.reads.length,0);
});

test("notification service failures and unconfirmed identities never become successful empty lists",async()=>{
 assert.equal((await call(loadHandler(fixture({failTable:'student_notifications'})),{action:'list'})).status,500);
 assert.equal((await call(loadHandler(fixture({unconfirmed:true})),{action:'list'})).status,401);
 const state=fixture({students:[{id:11,auth_user_id:'auth-student-a',status:'active',email:'mismatch@example.invalid'}]});
 assert.equal((await call(loadHandler(state),{action:'list'})).status,403);
});

const READONLY_PATH = 'supabase/functions/student-notifications-readonly-deploy/index.ts';
test('production notification artifact preserves scoped list, pagination, empty and failure contracts',async()=>{
 const state=fixture();
 const result=await call(loadHandler(state,READONLY_PATH),{action:'list',limit:20,offset:0});
 assert.equal(result.status,200);assert.deepEqual(result.body.data.notifications.map(row=>row.id),[101]);
 assert.equal(result.body.data.has_more,false);assert.equal(state.reads.length,0);
 assert.equal((await call(loadHandler(fixture({notifications:[]}),READONLY_PATH),{action:'list'})).body.data.notifications.length,0);
 assert.equal((await call(loadHandler(fixture({failTable:'student_notifications'}),READONLY_PATH),{action:'list'})).status,500);
});
test('production notification artifact rejects every mutation before database or Auth calls',async()=>{
 for(const action of ['mark_read','mark_all_read','create','update','delete','unknown']){
  const state=fixture();const before=JSON.stringify(state.notifications);
  const result=await call(loadHandler(state,READONLY_PATH),{action});
  assert.equal(result.status,403);assert.equal(result.body.code,'notification_writes_disabled');
  assert.equal(state.reads.length,0);assert.equal(state.clientKeys.length,0);assert.equal(JSON.stringify(state.notifications),before);
 }
 const source=readFileSync(READONLY_PATH,'utf8');
 assert.doesNotMatch(source,/\.(update|insert|upsert|delete|rpc)\s*\(/);
 assert.doesNotMatch(source,/handleMarkRead/);
});
test('production notification read requires verified unique active identity and rejects scope overrides',async()=>{
 for(const options of [{userId:null},{unconfirmed:true},{students:[]},{students:[{id:11,auth_user_id:'auth-student-a',status:'disabled'}]}]){
  assert.ok([401,403].includes((await call(loadHandler(fixture(options),READONLY_PATH),{action:'list'})).status));
 }
 assert.equal((await call(loadHandler(fixture(),READONLY_PATH),{action:'list'},{token:null})).status,401);
 assert.equal((await call(loadHandler(fixture(),READONLY_PATH),{action:'list',student_id:22})).status,400);
 const config=readFileSync('supabase/config.toml','utf8').split('[functions.student-notifications]')[1].split(/\r?\n\[/)[0];
 assert.match(config,/verify_jwt\s*=\s*true/);assert.match(config,/student-notifications-readonly-deploy\/index\.ts/);
});
