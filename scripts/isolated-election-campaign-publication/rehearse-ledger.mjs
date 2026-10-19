// Extends the frozen isolated runner in memory; never changes reviewed sources.
// Ledger seeds are explicitly synthetic metadata, not recovered migration SQL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,unlinkSync,existsSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const root='deploy/election-campaign-publication-review';
const output=root+'/final-readiness';
const manifest=JSON.parse(readFileSync(root+'/SHA256SUMS.json','utf8'));
const hashes={};
for(const [path,expected] of Object.entries(manifest)){
 const actual=createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
 assert.equal(actual,expected,'Frozen reviewed source changed: '+path);hashes[path]=actual;
}
const baseline=JSON.parse(readFileSync(output+'/PRODUCTION_BASELINE.json','utf8'));
assert.equal(baseline.project_ref,'fszgdxqxonqqcrzsnkca');assert.equal(baseline.ledger.length,14);
const versions=['20261019011416','20261019011420'];
assert.ok(versions.every(v=>!baseline.ledger.some(row=>row.version===v)));
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const seed=baseline.ledger.map(row=>`(${quote(row.version)},${quote(row.name)},ARRAY['ISOLATED REHEARSAL METADATA ONLY - NOT ORIGINAL SQL'])`).join(',');
const seedCode=`
 sql(${JSON.stringify('DELETE FROM supabase_migrations.schema_migrations; INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES '+seed+';')});
 const originalHistory=sql("SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM supabase_migrations.schema_migrations m WHERE version NOT IN ('20261019011416','20261019011420');").output;
 assert.equal(sql('SELECT count(*) FROM supabase_migrations.schema_migrations;').output.trim(),'14');
 mark('SYNTHETIC_14_VERSION_LEDGER_BASELINE');
 const recordTarget=(version,filename,expected)=>{
   const reviewedSql=readFileSync(filename,'utf8');
   const q=value=>"'"+value.replaceAll("'","''")+"'";
   assert.equal(sql('SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='+q(version)+';').output.trim(),'0');
   sql('INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES('+q(version)+','+q(filename.split('/').at(-1).replace(/^\\d+_|\\.sql$/g,''))+',ARRAY['+q(reviewedSql)+']::text[]);');
   assert.equal(sql('SELECT count(*) FROM supabase_migrations.schema_migrations;').output.trim(),String(expected));
   assert.equal(sql("SELECT jsonb_agg(to_jsonb(m) ORDER BY version) FROM supabase_migrations.schema_migrations m WHERE version NOT IN ('20261019011416','20261019011420');").output,originalHistory);
   mark('POSTFLIGHT_THEN_RECORD_'+version+'_LEDGER_'+expected);
 };
`;
let source=readFileSync('scripts/isolated-election-campaign-publication/run.mjs','utf8');
const replace=(before,after)=>{assert.equal(source.split(before).length,2,'Expected one frozen runner anchor');source=source.replace(before,after);};
replace("const evidence='deploy/election-campaign-publication-review';",`const evidence=${JSON.stringify(output)};`);
replace('const baseline=preservation();','const baseline=preservation();'+seedCode);
replace("mark('REVIEWED_DUPLICATE_POSTFLIGHT');",`mark('REVIEWED_DUPLICATE_POSTFLIGHT');assert.equal(preservation(),baseline);recordTarget('20261019011416','supabase/migrations/20261019011416_candidate_duplicate_check_privacy_compatibility.sql',15);`);
replace("mark('REVIEWED_PUBLICATION_POSTFLIGHT');",`mark('REVIEWED_PUBLICATION_POSTFLIGHT');assert.equal(preservation(),baseline);recordTarget('20261019011420','supabase/migrations/20261019011420_election_campaign_publication.sql',16);`);
mkdirSync(output,{recursive:true});
for(const filename of ['PREFLIGHT.sql','DUPLICATE_POSTFLIGHT.sql','POSTFLIGHT.sql'])writeFileSync(output+'/'+filename,readFileSync(root+'/'+filename));
writeFileSync(output+'/FROZEN_VERIFICATION.json',JSON.stringify({status:'PASS',files:Object.keys(hashes).length,hashes},null,2));
const temporary='scripts/isolated-election-campaign-publication/.ledger-rehearsal.generated.mjs';
try{
 writeFileSync(temporary,source);
 const result=spawnSync(process.execPath,[temporary],{encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:2*1024*1024});
 process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
 assert.equal(result.status,0,result.error?.message||'Isolated ledger rehearsal failed');
 const acceptance=JSON.parse(readFileSync(output+'/SQL_ACCEPTANCE.json','utf8'));
 assert.equal(acceptance.status,'PASS');
 writeFileSync(output+'/LEDGER_REHEARSAL.json',JSON.stringify({status:'PASS',production_writes:0,ledger_counts:[14,15,16],old_ledger_rows_unchanged:true,target_order:versions,sql_sources_match_frozen_manifest:true,ledger_method:'SQL model of post-install target-only reconciliation, not execution of production CLI repair; 14 baseline rows are synthetic metadata only',acceptance},null,2));
}finally{if(existsSync(temporary))unlinkSync(temporary);}
