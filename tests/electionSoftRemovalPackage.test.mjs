import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("soft-removal frozen candidate, dependencies, SQL checks and reviewed source hashes match", () => {
  const root=resolve("deploy/election-soft-removal-review");
  const manifest=JSON.parse(readFileSync(resolve(root,"SHA256SUMS.json"),"utf8"));
  for(const {path,sha256} of manifest){
    assert.equal(createHash("sha256").update(readFileSync(resolve(root,path))).digest("hex").toUpperCase(),sha256,path);
  }
  for(const path of ["supabase/migrations/20261018130000_password_protected_election_soft_removal.sql","supabase/functions/manage-election-removal/index.ts","supabase/functions/_shared/kandidProductionSecurity.mjs"]){
    assert.deepEqual(readFileSync(path),readFileSync(resolve(root,"candidate",path)),path);
  }
  const config=readFileSync(resolve(root,"candidate/supabase/config.toml"),"utf8");
  assert.match(config,/\[functions\.manage-election-removal\]\s+verify_jwt = true/);
  assert.match(config,/entrypoint = "\.\/functions\/manage-election-removal\/index\.ts"/);
  assert.equal((config.match(/\[functions\./g)||[]).length,1);
  assert.match(readFileSync("supabase/config.toml","utf8"),/\[functions\.manage-election-removal\]\s+verify_jwt = true/);
});
