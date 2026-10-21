import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
const proposal = read('supabase/proposals/anchor-exclude-two-existing-ballots.sql');
const base = read('supabase/migrations/20260913160000_ballot_anchor_worker_rpcs.sql');
const ids = ['3c5a6c0f-5c69-49d1-bd66-ee4f97383cc1','a9bb5581-acb0-4c1b-9d7a-b08cf358368c'];
const definition = (source, name) => {
  const start = source.indexOf(`create or replace function public.${name}()`);
  const end = source.indexOf('$function$;', start) + '$function$;'.length;
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
};

test('both claim RPCs change only the exclusion predicate before ordering, locking and limit', () => {
  for (const name of ['claim_next_ballot_anchor','claim_next_submitted_ballot_anchor']) {
    const expected = definition(base, name).replace("  where b.hash_version = 'KANDID_BALLOT_V1'", "  where not exists (select 1 from private.ballot_anchor_exclusions e where e.ballot_id = b.id)\n    and b.hash_version = 'KANDID_BALLOT_V1'");
    assert.equal(definition(proposal, name), expected);
    assert.ok(expected.indexOf('not exists') < expected.indexOf('order by'));
    assert.match(expected, /for update skip locked\n  limit 1/);
  }
});

test('only the two verified UUID/election/hash bindings can enter the private register', () => {
  const scope = proposal.split('constraint ballot_anchor_exclusions_exact_scope check (')[1].split('\n);')[0];
  assert.deepEqual([...scope.matchAll(/ballot_id = '([^']+)'/g)].map(m => m[1]), ids);
  assert.match(scope, /election_id = 2/);
  assert.match(scope, /election_id = 4/);
  assert.match(scope, /0x6f3aed472bda8be4e04c203070f1941f8cdaea750738aebc8cfc735d646249fc/);
  assert.match(scope, /0xf5074400475d07897d657d54903c2edeed6b3d618d472b71393624d50a4f9804/);
  assert.match(proposal, /alter table private.ballot_anchor_exclusions enable row level security/);
  assert.match(proposal, /revoke all on table private.ballot_anchor_exclusions from public, anon, authenticated, service_role/);
  assert.ok(!/grant .*private\.ballot_anchor_exclusions/i.test(proposal));
});

test('installation fails closed on contract drift, in-flight work or mismatched records', () => {
  assert.match(proposal, /lock table public.blockchain_signer_leases in access exclusive mode/);
  assert.match(proposal, /lock table public.vote_ballots, public.votes in share row exclusive mode/);
  assert.match(proposal, /md5\(pg_get_functiondef/);
  assert.match(proposal, /blockchain_anchor_status in \('anchoring','submitted'\)/);
  assert.match(proposal, /b\.created_at=expected\.created_at and b\.updated_at=expected\.created_at/);
  assert.match(proposal, /b\.blockchain_retry_count=0/);
  assert.match(proposal, /count\(\*\) from private.ballot_anchor_exclusions\) <> 2/);
  assert.ok(!/candidate_id|student_id|vote_nonce|is_abstain/.test(proposal), 'proposal never reads identities or choices');
});

test('database guards protect excluded ballots, grouped rows and the exclusion register', () => {
  assert.match(proposal, /before update or delete on public.vote_ballots/);
  assert.match(proposal, /before insert or update or delete on public.votes/);
  assert.match(proposal, /e\.ballot_id=old\.ballot_id/);
  assert.match(proposal, /e\.ballot_id=new\.ballot_id/);
  assert.match(proposal, /before truncate on private.ballot_anchor_exclusions/);
  assert.equal((proposal.match(/using errcode='42501'/g) ?? []).length, 5);
});

test('worker matches the local auth-probe manifest and scheduler remains unchanged', () => {
  const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  const manifest = JSON.parse(readFileSync('docs/anchor-auth-probe-manifest.json', 'utf8'));
  assert.equal(sha('supabase/functions/anchor-ballot-hashes/index.ts'), manifest.worker.sha256);
  assert.equal(sha('.github/workflows/anchor-ballot-hashes.yml'), '7cbd059928fc99a9a961dea8dc1d2af2ec28511815436378183d2cfa2bb6a2f1');
});
