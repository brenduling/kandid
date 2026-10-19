// Offline comparison only. No network, SQL or production mutations.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const baseline=JSON.parse(readFileSync('deploy/election-campaign-publication-review/final-readiness/PRODUCTION_BASELINE.json','utf8'));
const currentFile=process.argv[2],stage=process.argv[3];
const expectedTargets={before:[],first_sql:[],first_recorded:['20261019011416'],second_sql:['20261019011416'],complete:['20261019011416','20261019011420']}[stage];
assert.ok(currentFile&&expectedTargets,'Usage: node compare-production-baseline.mjs <CLI JSON capture> before|first_sql|first_recorded|second_sql|complete');
const input=JSON.parse(readFileSync(currentFile,'utf8').replace(/^\uFEFF/,''));
const current=input.project_ref?input:input.rows?.[0]?.readiness_baseline;
assert.ok(current,'Expected raw baseline object or CLI JSON rows[0].readiness_baseline');
assert.equal(current.project_ref,'fszgdxqxonqqcrzsnkca');assert.equal(current.database,'postgres');
assert.equal(baseline.ledger.length,14);assert.equal(Object.keys(baseline.preservation).length,23);
assert.deepEqual(current.preservation,baseline.preservation,'Application data differs; STOP and reconcile authorized activity explicitly');
assert.equal(current.ledger.length,14+expectedTargets.length);
assert.equal(new Set(current.ledger.map(row=>row.version)).size,current.ledger.length);
assert.deepEqual(current.ledger.filter(row=>!expectedTargets.includes(row.version)),baseline.ledger,'Original 14 ledger records changed or an unexpected version appeared');
for(const target of expectedTargets)assert.equal(current.ledger.filter(row=>row.version===target).length,1);
console.log(JSON.stringify({status:'PASS',stage,unchanged_preservation_groups:23,ledger_entries:current.ledger.length,original_ledger_records_unchanged:14}));
