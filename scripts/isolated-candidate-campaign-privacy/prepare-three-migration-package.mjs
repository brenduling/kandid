import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export const packageFolder = 'deploy/candidate-campaign-privacy-review/admin-compatibility';
mkdirSync(packageFolder, { recursive: true });
const compatibilityFile = 'supabase/migrations/20261018231601_candidate_admin_campaign_column_compatibility.sql';
export const targets = [
  { version: '20261018161039', file: 'supabase/migrations/20261018161039_candidate_campaign_privacy_contract.sql', sha256: '20999363B9B72529DC79B6FD47ACFF08EA5688D53B4C0EC3FF548B9AC5F840FF' },
  { version: '20261018231601', file: compatibilityFile, sha256: '500BB72664C8072E3DBDDA999BC4F73F36880EC9D363D1EB7B9D53ADC269608C' },
  { version: '20261018150914', file: 'supabase/migrations/20261018150914_campaign_material_storage.sql', sha256: 'F179AC907C98C17D0FAF10B003C0627EB06F7ABA423134CDA8EB760890744D87' },
];
for (const target of targets) {
  if (createHash('sha256').update(readFileSync(target.file)).digest('hex').toUpperCase() !== target.sha256) {
    throw new Error(`Frozen checksum mismatch: ${target.file}`);
  }
}
writeFileSync(`${packageFolder}/TARGETS.json`, JSON.stringify(targets, null, 2) + '\n');
const compatibility = readFileSync(compatibilityFile, 'utf8');
const preflight = compatibility.match(/DO \$compatibility_preflight\$[\s\S]*?\$compatibility_preflight\$;/)[0];
const postflight = compatibility.match(/DO \$compatibility_postflight\$[\s\S]*?\$compatibility_postflight\$;/)[0];
function expand(file) {
  return readFileSync(resolve('deploy/candidate-campaign-privacy-review', file), 'utf8')
    .replace(/^\\set[^\r\n]*\r?$/gm, '')
    .replace(/^\\ir ([^\r\n]+)\r?$/gm, (_, included) => expand(included.trim()));
}
const preservation = expand('PRESERVATION.sql');
function readonly(name, sql) {
  writeFileSync(`${packageFolder}/${name}.sql`, `BEGIN TRANSACTION READ ONLY;\n${sql}\nCOMMIT;\n`);
}
readonly('PREFLIGHT', `${expand('PREFLIGHT.sql')}\nDO $$ BEGIN
  IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261018231601')
  THEN RAISE EXCEPTION 'Admin compatibility target is already recorded'; END IF;
END $$;`);
readonly('PRESERVATION', preservation);
readonly('LEDGER_READ', `SELECT version,name,md5(coalesce(array_to_string(statements,E'\\n'),'')) AS statements_md5
FROM supabase_migrations.schema_migrations ORDER BY version;`);
readonly('PRIVACY_POSTFLIGHT', expand('POSTFLIGHT.sql'));
readonly('COMPATIBILITY_PREFLIGHT', preflight);
readonly('COMPATIBILITY_POSTFLIGHT', `${postflight}\nDO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261018161039')
     OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version IN ('20261018231601','20261018150914'))
  THEN RAISE EXCEPTION 'Unexpected ledger state before compatibility recording'; END IF;
END $$;\n${preservation}`);
readonly('STORAGE_PREFLIGHT', `${postflight}\nDO $$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20261018161039','20261018231601'))<>2
     OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261018150914')
     OR EXISTS(SELECT 1 FROM storage.buckets WHERE id='campaign-materials')
     OR to_regprocedure('public.kandid_campaign_storage_access_v1(text,text)') IS NOT NULL
     OR pg_catalog.pg_get_functiondef('public.get_student_campaign(integer)'::regprocedure) NOT ILIKE '%kandid_get_student_published_campaign%'
  THEN RAISE EXCEPTION 'Verified privacy and admin compatibility must precede Storage'; END IF;
END $$;`);
readonly('STORAGE_POSTFLIGHT', `${expand('STORAGE_POSTFLIGHT.sql')}\n${postflight}`);
readonly('LEDGER_POSTFLIGHT', `${postflight}\nDO $$ BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20261018161039','20261018231601','20261018150914'))<>3
     OR to_regprocedure('public.kandid_campaign_storage_access_v1(text,text)') IS NULL
     OR NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='campaign-materials' AND NOT public)
  THEN RAISE EXCEPTION 'Expected all three committed targets recorded exactly once'; END IF;
END $$;
SELECT version,name,md5(coalesce(array_to_string(statements,E'\\n'),'')) AS statements_md5
FROM supabase_migrations.schema_migrations ORDER BY version;\n${preservation}`);

// Synthetic baseline only: import exact existing trusted guard definitions and
// captured production DML policies without executing their source migrations.
const oldCatalog = JSON.parse(readFileSync('deploy/candidate-management-review/production-catalog.json', 'utf8')).catalog;
const eligibility = readFileSync('supabase/migrations/20261021100000_candidate_eligibility_uses_election_term.sql', 'utf8');
const management = readFileSync('supabase/migrations/20261021130000_candidate_management_scope_and_history_guard.sql', 'utf8');
const trusted = eligibility.match(/create or replace function public\.kandid_guard_candidate_mutation\(\)[\s\S]*?\$function\$;/i)[0];
let fixture = `-- LOCAL SYNTHETIC FIXTURE ONLY. Never execute against production.
ALTER TABLE public.candidates ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.officer_new_roster ADD COLUMN position_id integer, ADD COLUMN candidate_id integer;\n`;
for (const policy of oldCatalog.policies.filter(row => row.tablename === 'candidates' && ['INSERT', 'UPDATE', 'DELETE'].includes(row.cmd))) {
  fixture += `DROP POLICY ${policy.policyname} ON public.candidates;\nCREATE POLICY ${policy.policyname} ON public.candidates FOR ${policy.cmd} TO authenticated`;
  if (policy.qual) fixture += ` USING (${policy.qual})`;
  if (policy.with_check) fixture += ` WITH CHECK (${policy.with_check})`;
  fixture += ';\n';
}
fixture += `${trusted}\nALTER FUNCTION public.kandid_guard_candidate_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.kandid_guard_candidate_mutation() FROM public,anon,authenticated,service_role;
CREATE TRIGGER candidates_trusted_mutation_guard BEFORE INSERT OR UPDATE OR DELETE ON public.candidates
FOR EACH ROW EXECUTE FUNCTION public.kandid_guard_candidate_mutation();\n`;
for (const name of ['kandid_candidate_election_has_history_v1', 'kandid_guard_candidate_management_contract_v1']) {
  const expression = new RegExp(`create function private\\.${name}\\([^]*?\\$function\\$;`, 'i');
  const definition = management.match(expression)?.[0];
  if (!definition) throw new Error(`Missing reviewed guard: ${name}`);
  const signature = name === 'kandid_candidate_election_has_history_v1' ? '(integer)' : '()';
  fixture += `${definition}\nALTER FUNCTION private.${name}${signature} OWNER TO postgres;
REVOKE ALL ON FUNCTION private.${name}${signature} FROM public,anon,authenticated,service_role;\n`;
}
fixture += `CREATE TRIGGER candidates_management_contract_guard BEFORE INSERT OR UPDATE OR DELETE ON public.candidates
FOR EACH ROW EXECUTE FUNCTION private.kandid_guard_candidate_management_contract_v1();\n`;
writeFileSync(`${packageFolder}/MUTATION_FIXTURE.sql`, fixture);
console.log('Three migration sources and read-only postflight package prepared; no database accessed.');
