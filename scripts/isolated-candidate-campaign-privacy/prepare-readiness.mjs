import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const folder = 'deploy/candidate-campaign-privacy-review';
const evidence = `${folder}/readiness`;
mkdirSync(evidence, { recursive: true });
const expected = {
  'supabase/migrations/20261018161039_candidate_campaign_privacy_contract.sql': '20999363B9B72529DC79B6FD47ACFF08EA5688D53B4C0EC3FF548B9AC5F840FF',
  'supabase/migrations/20261018150914_campaign_material_storage.sql': 'F179AC907C98C17D0FAF10B003C0627EB06F7ABA423134CDA8EB760890744D87',
};
for (const [file, hash] of Object.entries(expected)) {
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex').toUpperCase();
  if (actual !== hash) throw new Error(`Frozen migration checksum mismatch: ${file}`);
}
function expand(file) {
  return readFileSync(resolve(folder, file), 'utf8')
    .replace(/^\\set[^\r\n]*$/gm, '')
    .replace(/^\\ir ([^\r\n]+)$/gm, (_, included) => expand(included.trim()));
}
// Derived verification SQL only. The two frozen migrations are never rewritten.
for (const file of ['PREFLIGHT.sql', 'POSTFLIGHT.sql', 'PRESERVATION.sql', 'STORAGE_PREFLIGHT.sql', 'STORAGE_POSTFLIGHT.sql', 'LEDGER_POSTFLIGHT.sql']) {
  const sql = expand(file);
  if (/^\\/m.test(sql)) throw new Error(`Unexpanded psql command: ${file}`);
  writeFileSync(`${evidence}/${file.replace('.sql', '_API.sql')}`,
    `BEGIN TRANSACTION READ ONLY;\n${sql}\nCOMMIT;\n`);
}
writeFileSync(`${evidence}/FROZEN_HASHES.json`, JSON.stringify(expected, null, 2) + '\n');
console.log('Frozen hashes verified; derived read-only API verification files prepared. No database accessed.');
