// LOCAL PACKAGING ONLY. Does not invoke Supabase, Vercel, git, SQL or networking.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,copyFileSync,writeFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
const manifest=JSON.parse(readFileSync('docs/student-setup-security-manifest.json','utf8'));
assert.equal(manifest.project_ref,'fszgdxqxonqqcrzsnkca');assert.equal(manifest.contract_version,3);
const hash=x=>createHash('sha256').update(x).digest('hex');
for(const file of [...manifest.deployment_files,...manifest.sql_files,...manifest.review_files]){
 assert.ok(!/(^|\/)\.env|node_modules|^\.tmp\//.test(file.path));
 assert.equal(hash(readFileSync(file.path,'utf8').replace(/\r\n/g,'\n')),file.lf_sha256,file.path+' changed since review');
}
const root=resolve('.tmp/student-setup-security/release-'+randomBytes(6).toString('hex'));
mkdirSync(join(root,'supabase'),{recursive:true});
for(const file of manifest.deployment_files){
 assert.match(file.deployed_name,/^functions\/(resolve-student-login|link-student-identity|_shared)\/[A-Za-z]+[A-Za-z.]*$/);
 const destination=join(root,'supabase',file.deployed_name);mkdirSync(dirname(destination),{recursive:true});copyFileSync(file.path,destination);
}
for(const file of manifest.sql_files){const destination=join(root,'review-only-sql',file.path.split('/').at(-1));mkdirSync(dirname(destination),{recursive:true});copyFileSync(file.path,destination);}
writeFileSync(join(root,'supabase/config.toml'),`project_id = "${manifest.project_ref}"\n[functions.resolve-student-login]\nverify_jwt = false\n[functions.link-student-identity]\nverify_jwt = true\n`);
copyFileSync('docs/student-setup-security-manifest.json',join(root,'review-manifest.json'));
console.log(JSON.stringify({localReleaseDirectory:root,project:manifest.project_ref,functions:manifest.functions,productionActions:0},null,2));
