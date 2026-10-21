// Explicit investigation only. No arbitrary SQL/URL/credentials arguments.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const project = 'fszgdxqxonqqcrzsnkca';
const stages = new Set(['catalog', 'inventory', 'evidence', 'final-check']);
const stage = process.argv[2];
assert.equal(process.argv.length, 3);
assert.ok(stages.has(stage), 'Only prepared read-only investigation stages are accepted');
const path = `supabase/runtime-validation/academic-term-cleanup-${stage}.sql`;
const sql = readFileSync(path, 'utf8');
assert.match(sql, /^--[\s\S]*?begin transaction isolation level repeatable read read only;/i);
assert.match(sql, /rollback;\s*$/i);
// No data-changing CTEs, DDL, DML, worker calls or application RPCs.
const statements = sql.replace(/--[^\n]*/g,'').replace(/'(?:''|[^'])*'/g,"''");
assert.doesNotMatch(statements, /\b(insert|update|delete|truncate|create|alter|drop|grant|revoke|execute|call|copy|do|notify|vacuum|refresh)\b|\b(?:public|private)\.[a-z_]+\s*\(/i);
const result = spawnSync(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), 'db', 'query', '--linked', '--project-ref', project, '--file', path, '--output', 'json'], {
  encoding: 'utf8', timeout: 90000, maxBuffer: 12 * 1024 * 1024, windowsHide: true,
});
if (result.status !== 0) {
  // CLI exceptions may contain credentials/connection URLs; never print them.
  console.error(JSON.stringify({ stage, project, success: false, reason: result.error?.code || 'CLI_READ_ONLY_QUERY_FAILED', exitCode: result.status }));
  process.exit(1);
}
let rows;
try { rows = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'),result.stdout.lastIndexOf('}')+1)).rows; }
catch { console.error('Read-only query returned an unexpected response format.'); process.exit(1); }
assert.ok(Array.isArray(rows));
mkdirSync('.tmp/academic-term-cleanup-investigation', { recursive: true });
const report = { project, capturedAt: new Date().toISOString(), readOnly: true, querySha256: createHash('sha256').update(sql).digest('hex'), rows };
writeFileSync(`.tmp/academic-term-cleanup-investigation/${stage}.json`, JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ stage, project, readOnly: true, resultRows: rows.length, evidenceFile: `.tmp/academic-term-cleanup-investigation/${stage}.json` }));
