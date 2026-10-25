import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
test('secure setup release binds exact scoped sources, SQL and default-off switches',()=>{
 const m=JSON.parse(readFileSync('docs/student-setup-security-manifest.json','utf8'));
 assert.equal(m.contract_version,4);assert.equal(m.project_ref,'fszgdxqxonqqcrzsnkca');
 assert.equal(m.server_gate.default_enabled,false);assert.equal(m.frontend_gates.default_enabled,false);
 assert.deepEqual(m.functions,[{slug:'resolve-student-login',verify_jwt:false},{slug:'link-student-identity',verify_jwt:true}]);
 assert.deepEqual(m.deployment_files.map(x=>x.deployed_name),['functions/resolve-student-login/index.ts','functions/link-student-identity/index.ts','functions/_shared/studentSetupAdmission.ts','functions/_shared/kandidProductionSecurity.mjs']);
 assert.equal(m.sql_files.length,3);
 for(const file of [...m.deployment_files,...m.sql_files,...m.review_files]){
  assert.doesNotMatch(file.path,/(^|\/)\.env|node_modules|^\.tmp\//);
  assert.equal(hash(readFileSync(file.path,'utf8').replace(/\r\n/g,'\n')),file.lf_sha256,file.path);
 }
 for(const f of m.deployment_files.slice(0,2))assert.match(readFileSync(f.path,'utf8'),/supabase-js@2\.118\.0/);
 const sql=readFileSync(m.sql_files[0].path,'utf8');assert.doesNotMatch(sql,/alter policy|disable row level security|grant .* to authenticated|update auth\.users|delete from public\./i);
 assert.match(sql,/student_setup_one_unresolved_claim/);assert.match(sql,/set lock_timeout = '5s'/);
});
