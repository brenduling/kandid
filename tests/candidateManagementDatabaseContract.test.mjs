import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../supabase/migrations/20261021130000_candidate_management_scope_and_history_guard.sql',import.meta.url),'utf8');
test('candidate contract is additive and transactionally preserves existing RLS and triggers',()=>{
 assert.match(migration,/^begin;/m);assert.match(migration,/commit;\s*$/);assert.doesNotMatch(migration,/create or replace function|drop\s+(?:trigger|policy|table)|alter table|grant\s+(?:all|select|insert|update|delete)\s|delete from|truncate\s/i);
 for(const name of ['candidates_trusted_mutation_guard','guard_removed_election_mutation','kandid_can_mutate_election_positions','resolve_student_organization_participation'])assert.ok(migration.includes(name));
 assert.equal((migration.match(/security definer set search_path=pg_catalog/gi)||[]).length,4);
 assert.equal((migration.match(/owner to postgres/g)||[]).length,4);
 assert.equal((migration.match(/revoke all on function/g)||[]).length,4);
 assert.match(migration,/grant execute on function public.kandid_candidate_management_context_v1\(integer\) to authenticated/);
});
test('trusted candidate context uses JWT actor, election term and canonical participation',()=>{
 assert.match(migration,/a.auth_user_id=auth.uid\(\) and a.status='active'/);assert.match(migration,/actor_count<>1/);assert.match(migration,/actor_organization_id is distinct from election_row.organization_id/);
 assert.match(migration,/term_id:=election_row.academic_term_id/);assert.match(migration,/resolve_student_organization_participation\(s.id,election_row.organization_id::integer,term_id\)/);
 const context=migration.slice(migration.indexOf('create function public.kandid_candidate_management_context_v1'));assert.doesNotMatch(context,/'email'|'password'|'auth_user_id'|student_id\s+integer\s*[,)]/);
});
test('new candidate guard preserves reusable partylists, prevents parent drift and immutable identity changes',()=>{
 assert.match(migration,/pl.organization_id=organization_id_value and \(pl.election_id is null or pl.election_id=parent_id\) for share/);
 assert.match(migration,/new.election_id is not null and new.election_id is distinct from e.id/);
 assert.match(migration,/new.student_id is distinct from old.student_id/);assert.match(migration,/new.created_at is distinct from old.created_at/);assert.match(migration,/parent_id is distinct from old_parent_id/);
 assert.match(migration,/private.kandid_candidate_election_has_history_v1\(old_parent_id\)/);
});
