// Disposable LOCAL PostgreSQL only. The prepared production SQL is never sent
// to Supabase. Replays Storage RLS with synthetic accounts and elections.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const config = resolve(root, ".tmp/election-cover-validation/docker");
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
const database = "kandid_cover_check_" + randomBytes(6).toString("hex");
assert.match(database, /^kandid_cover_check_[a-f0-9]{12}$/);
const created = docker(["exec", container, "createdb", "-U", "postgres", "--template=template0", database]);
assert.equal(created.status, 0, created.stderr);
function sql(text, expected = true) {
  const result = docker(["exec", "-i", container, "psql", "-X", "-q", "-At", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1"], text);
  if (expected) assert.equal(result.status, 0, result.stderr); else assert.notEqual(result.status, 0, "Expected database denial");
  return result;
}
const uuid = (n) => `10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor = (n, role = "authenticated") => `begin;set local role ${role};select set_config('request.jwt.claim.sub','${n ? uuid(n) : ""}',true);`;
const path = (n = 100) => `2/elections/3/${uuid(n)}.png`;
const last = (r) => r.stdout.trim().split("\n").at(-1);
let checks = 0; const pass = (s) => { checks++; console.log("PASS " + s); };
try {
  sql(`create schema auth;create schema storage;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,storage to authenticated,anon;
    create table public.organizations(id integer primary key);
    create table public.admin_users(auth_user_id uuid,role text,status text,organization_id integer);
    create table public.elections(id integer primary key,organization_id integer,removed_at timestamptz,cover_url text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,owner_id text,unique(bucket_id,name));
    grant select,insert,update,delete on storage.objects to authenticated,anon;
    alter table storage.objects enable row level security;
    insert into public.organizations values(2),(4);
    insert into public.elections values(3,2,null,null),(4,4,null,null),(5,2,now(),null);
    insert into public.admin_users values('${uuid(1)}','electoral_board','active',2),('${uuid(2)}','electoral_board','active',4),
      ('${uuid(3)}','super_admin','active',null),('${uuid(4)}','electoral_board','disabled',2);
    insert into storage.buckets values('campaign-materials','campaign-materials',false,52428800,array['image/png']);`);
  const repair = readFileSync(resolve(root,"deploy/election-cover-review/repair.sql"),"utf8");
  sql(repair); pass("Exact proposed repair applies in fresh local PostgreSQL");
  assert.equal(last(sql("select public||'|'||file_size_limit||'|'||array_to_string(allowed_mime_types,',') from storage.buckets where id='election-covers';")), "true|5242880|image/jpeg,image/png,image/webp,image/gif");
  assert.equal(last(sql("select public from storage.buckets where id='campaign-materials';")), "f");
  pass("Public cover-only bucket, 5 MB raster allowlist; private campaign bucket unchanged");
  const insert = (n, name, owner = n, role = "authenticated", bucket = "election-covers") => sql(`${actor(n,role)}insert into storage.objects values('${bucket}','${name}','${uuid(owner)}');commit;`, false);
  for (const [n, name] of [[1,path()], [1,`2/drafts/${uuid(101)}.png`], [3,`4/elections/4/${uuid(102)}.gif`]]) {
    sql(`${actor(n)}insert into storage.objects values('election-covers','${name}','${uuid(n)}');commit;`);
  }
  pass("Authorized Board edit/draft uploads and Super Admin upload allowed");
  for (const [n, name, owner, role] of [[2,path(103),2], [4,path(104),4], [5,path(105),5], [0,path(106),0,"anon"],
    [1,`2/elections/4/${uuid(107)}.png`,1], [1,`2/elections/5/${uuid(108)}.png`,1], [1,path(109),2]]) insert(n,name,owner,role);
  pass("Foreign Board, disabled, student, anonymous, foreign/removed election and forged owner denied");
  for (const name of [`covers/${uuid(110)}.png`,`2/drafts/x.svg`,`2/elections/3/${uuid(110)}.svg`,
    `2/elections/0/${uuid(110)}.png`,`999999999999999999999/drafts/${uuid(110)}.png`,
    `2/elections/3/../${uuid(110)}.png`,`2/drafts/${uuid(110)}.png/extra`]) insert(1,name);
  pass("Server rejects malformed paths, traversal, overflow IDs and unsupported extensions");
  insert(1,path(111),1,"authenticated","campaign-materials"); pass("Cover policy grants no campaign-material writes");
  for (const n of [1,2,3]) {
    assert.equal(last(sql(`${actor(n)}with x as(update storage.objects set owner_id='${uuid(n)}' where name='${path()}' returning 1)select count(*) from x;commit;`)), "0");
    assert.equal(last(sql(`${actor(n)}with x as(delete from storage.objects where name='${path()}' returning 1)select count(*) from x;commit;`)), "0");
  }
  pass("No owner, foreign Board or Super Admin can overwrite/delete through cover policies");
  assert.equal(last(sql(`${actor(1)}select count(*) from storage.objects;commit;`)), "0");
  pass("No browser object-list permission; public image delivery is bucket-specific");
  const repeat = sql(repair,false); assert.match(repeat.stderr,/already exists/);
  pass("Repair refuses replay against existing bucket rather than altering its configuration");
  console.log(`${checks} local PostgreSQL checks passed; production writes: 0`);
} finally {
  const dropped = docker(["exec",container,"dropdb","-U","postgres",database]);
  assert.equal(dropped.status,0,dropped.stderr);
}
