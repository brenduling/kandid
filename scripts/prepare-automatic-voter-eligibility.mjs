// Local artifact generation only. No network or database access.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root='supabase/proposals/automatic-voter-eligibility';
const captured=JSON.parse(readFileSync('tests/fixtures/automaticVoterEligibilityProductionContract.json','utf8'));
const get=name=>captured.functions.find(f=>f.definition.includes('FUNCTION '+name+'(')).definition;
const md5=s=>createHash('md5').update(s).digest('hex');
const signatures=[['public.insert_v2_vote_rows','integer,integer,jsonb'],['public.kandid_get_student_ballot_candidates','integer'],['private.kandid_require_locked_electorate_for_ballot',''],['public.kandid_get_board_electorate_preview','integer']];
const guard=(expected,added=false)=>`do $guard$ declare item record; begin
  for item in select * from (values ${expected.map(([s,h])=>`('${s}','${h}')`).join(',')}) expected(signature,digest) loop
    if to_regprocedure(item.signature) is null or
      md5(pg_get_functiondef(to_regprocedure(item.signature))) is distinct from item.digest or
      (select pg_get_userbyid(proowner) from pg_proc where oid=to_regprocedure(item.signature)) is distinct from 'postgres' then
      raise exception 'Reviewed function baseline differs: %. Stop.',item.signature;
    end if;
  end loop;
  ${added?'':`if to_regprocedure('private.kandid_student_is_live_eligible(integer,integer)') is not null or
    to_regprocedure('private.kandid_voting_is_open(integer)') is not null or
    to_regprocedure('public.kandid_check_student_ballot_eligibility(integer)') is not null or
    to_regprocedure('private.kandid_guard_live_eligibility_rules()') is not null then
    raise exception 'Automatic eligibility already exists; inspect before installation.';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.vote_ballots'::regclass
    and tgname='vote_ballots_require_locked_electorate' and tgenabled in ('O','A')
    and tgfoid='private.kandid_require_locked_electorate_for_ballot()'::regprocedure) then
    raise exception 'Expected ballot trigger is absent or disabled.';
  end if;
  if has_function_privilege('authenticated','public.insert_v2_vote_rows(integer,integer,jsonb)','EXECUTE')
    or has_function_privilege('anon','public.insert_v2_vote_rows(integer,integer,jsonb)','EXECUTE')
    or not has_function_privilege('service_role','public.insert_v2_vote_rows(integer,integer,jsonb)','EXECUTE') then
    raise exception 'Atomic insertion privilege baseline differs.';
  end if;`}
end $guard$;`;
const base=[...signatures.map(([n,a])=>[`${n}(${a})`,md5(get(n))]),
  ['public.resolve_student_organization_participation(integer,integer,integer)',md5(captured.participation)]];
const atomic=get('public.insert_v2_vote_rows');
const boundary='  ---------------------------------------------------------------------------\n  -- Authoritative duplicate-ballot guard';
if(!atomic.includes(boundary))throw Error('Atomic baseline boundary differs');
const validation=`  -- Lock authoritative inputs until commit; membership revocations and schedule
  -- changes serialize with this transaction. Service-only invocation is unchanged.
  perform 1 from public.elections where id=p_election_id for share;
  perform 1 from public.students where id=p_student_id for share;
  perform 1 from auth.users where id=(select auth_user_id from public.students where id=p_student_id) for share;
  perform 1 from public.academic_terms where status='active' for share;
  perform 1 from public.organizations where id=(select organization_id from public.elections where id=p_election_id) for share;
  perform 1 from public.student_term_enrollments where student_id=p_student_id
    and academic_term_id=(select academic_term_id from public.elections where id=p_election_id) for share;
  perform 1 from public.student_organization_terms where student_id=p_student_id
    and academic_term_id=(select academic_term_id from public.elections where id=p_election_id)
    and organization_id=(select organization_id from public.elections where id=p_election_id) for share;
  if not private.kandid_voting_is_open(p_election_id)
    or not private.kandid_student_is_live_eligible(p_election_id,p_student_id) then
    raise exception using errcode='42501',message='Student is not eligible to vote in this election now.';
  end if;
  perform 1 from public.positions where election_id=p_election_id for share;
  perform 1 from public.candidates where position_id in
    (select id from public.positions where election_id=p_election_id) for share;
  -- Recheck active ballot shape inside the same atomic hashing/insertion RPC.
  if exists(select 1 from jsonb_array_elements(p_votes) v where
      jsonb_typeof(v->'position_id') is distinct from 'number' or
      jsonb_typeof(v->'is_abstain') is distinct from 'boolean') then
    raise exception using errcode='22023',message='Invalid ballot shape.';
  end if;
  if not exists(select 1 from public.positions where election_id=p_election_id and status='active')
    or exists(select 1 from jsonb_array_elements(p_votes) v where not exists (
      select 1 from public.positions p where p.id=(v->>'position_id')::integer
        and p.election_id=p_election_id and p.status='active'))
    or exists(select 1 from public.positions p where p.election_id=p_election_id and p.status='active'
      and not exists(select 1 from jsonb_array_elements(p_votes) v where (v->>'position_id')::integer=p.id)) then
    raise exception using errcode='22023',message='Ballot must cover exactly the active election positions.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_votes) v where
    ((v->>'is_abstain')::boolean and v->>'candidate_id' is not null) or
    (not (v->>'is_abstain')::boolean and not exists(select 1 from public.candidates c
      where c.id=(v->>'candidate_id')::integer and c.position_id=(v->>'position_id')::integer))) then
    raise exception using errcode='22023',message='Invalid candidate or abstention.';
  end if;
  if exists(select 1 from jsonb_array_elements(p_votes) v
    join public.positions p on p.id=(v->>'position_id')::integer group by p.id,p.max_votes
    having (count(*) filter(where (v->>'is_abstain')::boolean)>0 and count(*)>1)
      or count(*)>greatest(1,p.max_votes)
      or count(v->>'candidate_id')<>count(distinct v->>'candidate_id')) then
    raise exception using errcode='22023',message='Duplicate or excessive ballot selections.';
  end if;

`;
const nextAtomic=atomic.replace(boundary,validation+boundary);
const candidates=get('public.kandid_get_student_ballot_candidates');
const payload=candidates.slice(candidates.indexOf('  select coalesce(pg_catalog.jsonb_agg'));
const nextCandidates=`CREATE OR REPLACE FUNCTION public.kandid_get_student_ballot_candidates(p_election_id integer)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
declare election_row record; candidate_data jsonb;
begin
  if auth.uid() is null or p_election_id is null or p_election_id<=0 then
    raise exception using errcode='28000',message='Eligible Student authentication is required.';
  end if;
  if not public.kandid_check_student_ballot_eligibility(p_election_id) then
    raise exception using errcode='42501',message='Ballot choices are unavailable.';
  end if;
  select e.id,e.organization_id into election_row from public.elections e where e.id=p_election_id;
${payload}`;
const nextPreview=`CREATE OR REPLACE FUNCTION public.kandid_get_board_electorate_preview(p_election_id integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog'
AS $function$
declare board_admin public.admin_users%rowtype; election_row public.elections%rowtype; eligible_count bigint;
begin
  if auth.uid() is null then raise exception using errcode='28000',message='Authentication required.'; end if;
  if (select count(*) from public.admin_users where auth_user_id=auth.uid() and role='electoral_board' and status='active')<>1 then
    raise exception using errcode='42501',message='One active Electoral Board assignment is required.';
  end if;
  select * into board_admin from public.admin_users where auth_user_id=auth.uid() and role='electoral_board' and status='active';
  select * into election_row from public.elections where id=p_election_id and organization_id=board_admin.organization_id and removed_at is null;
  if not found then raise exception using errcode='42501',message='Election is unavailable.'; end if;
  select count(*) into eligible_count from public.students s where private.kandid_student_is_live_eligible(p_election_id,s.id);
  return jsonb_build_object('election_id',election_row.id,'eligible_voters',eligible_count,
    'eligibility_contract','automatic-membership-optional-rules-v1','lock_required',false,
    'rule_count',(select count(*) from public.eligibility_rules where election_id=p_election_id),
    'is_locked',election_row.electorate_frozen_at is not null,'locked_at',election_row.electorate_frozen_at,
    'policy_version',election_row.electorate_policy_version,'locking_allowed',false,
    'blocking_reason','Eligibility is checked automatically; no electorate lock is required.');
end;
$function$\n`;
const core=readFileSync(root+'.core.sql','utf8').replace(/\r\n/g,'\n');
const forward=`-- REVIEW PROPOSAL ONLY. No election, student, snapshot, vote, or receipt rows are changed.
begin;
set local lock_timeout='5s';
${guard(base)}
${core}
${nextAtomic};
${nextCandidates};
${nextPreview};
revoke all on function public.kandid_get_board_electorate_preview(integer) from public,anon,authenticated,service_role;
grant execute on function public.kandid_get_board_electorate_preview(integer) to authenticated;
notify pgrst,'reload schema';
commit;
`;
writeFileSync(root+'.sql',forward);
// Source baselines restored exactly; no data reversal, snapshot backfill or vote deletion.
const replacements=[...signatures.map(([n,a])=>[`${n}(${a})`, n.includes('insert_v2')?nextAtomic:n.includes('ballot_candidates')?nextCandidates:n.includes('preview')?nextPreview:core.match(/create or replace function private\.kandid_require_locked_electorate_for_ballot\(\)[\s\S]*?\$function\$;/i)[0]]),
  ...['private.kandid_student_is_live_eligible(integer,integer)','private.kandid_voting_is_open(integer)','public.kandid_check_student_ballot_eligibility(integer)','private.kandid_guard_live_eligibility_rules()'].map(sig=>{
    const name=sig.split('(')[0];const start=core.indexOf('create function '+name+'(');const end=core.indexOf('$function$;',core.indexOf('as $function$',start))+11;
    return [sig,core.slice(start,end)];
  })];
const rollbackGuard=`do $rollback_guard$ declare item record; begin
  for item in select * from (values ${replacements.map(([sig,source])=>{
    const body=source.match(/as \$function\$([\s\S]*?)\$function\$/i)?.[1];if(body==null)throw Error('Missing body '+sig);
    return `('${sig}','${md5(body)}')`;
  }).join(',')}) expected(signature,digest) loop
    if to_regprocedure(item.signature) is null or
      (select md5(prosrc) from pg_proc where oid=to_regprocedure(item.signature)) is distinct from item.digest then
      raise exception 'Installed automatic-eligibility source differs: %. Stop rollback.',item.signature;
    end if;
  end loop;
end $rollback_guard$;`;
const rollback=`-- Restore the captured frozen-policy contracts. Stop new submissions first.
begin;
set local lock_timeout='5s';
${rollbackGuard}
drop trigger eligibility_rules_serialize_live_voting on public.eligibility_rules;
${signatures.map(([n])=>get(n)+';').join('\n')}
drop function private.kandid_guard_live_eligibility_rules();
drop function public.kandid_check_student_ballot_eligibility(integer);
drop function private.kandid_voting_is_open(integer);
drop function private.kandid_student_is_live_eligible(integer,integer);
notify pgrst,'reload schema';
commit;
`;
writeFileSync(root+'.rollback.sql',rollback);
console.log('Prepared forward and exact-source rollback SQL locally.');
