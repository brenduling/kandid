import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {transformSync} from 'esbuild';
import test from 'node:test';
import {isAutomaticVoterEligibilityEnabled} from '../src/utils/automaticVoterEligibility.js';
import {isAllowedDevelopmentProductionRequest} from '../src/utils/developmentProductionWriteGuard.js';
import {loadStudentBallotCandidates} from '../src/utils/studentBallotReadiness.js';
const read=p=>readFileSync(p,'utf8');
const proposal=read('supabase/proposals/automatic-voter-eligibility.sql');
const captured=JSON.parse(read('tests/fixtures/automaticVoterEligibilityProductionContract.json'));

test('automatic eligibility release gate is disabled unless explicitly true',()=>{
  for(const env of [undefined,{}, {VITE_ENABLE_AUTOMATIC_VOTER_ELIGIBILITY:false},{VITE_ENABLE_AUTOMATIC_VOTER_ELIGIBILITY:'TRUE'}])assert.equal(isAutomaticVoterEligibilityEnabled(env),false);
  assert.equal(isAutomaticVoterEligibilityEnabled({VITE_ENABLE_AUTOMATIC_VOTER_ELIGIBILITY:'true'}),true);
});
const allowed=(path,body,options={})=>isAllowedDevelopmentProductionRequest({input:'https://fszgdxqxonqqcrzsnkca.supabase.co'+path,method:'POST',headers:{Authorization:'Bearer synthetic-session'},body:JSON.stringify(body),...options});
const selection={election_id:5,selected_votes:{11:{position_id:11,is_abstain:true}}};
test('development allows only reviewed submission and owned receipts after release',()=>{
  assert.equal(allowed('/functions/v1/submit-vote',selection),false);
  assert.equal(allowed('/functions/v1/submit-vote',selection,{allowAutomaticVoterEligibility:true}),true);
  assert.equal(allowed('/functions/v1/get-student-ballot-receipt',{election_id:5},{allowAutomaticVoterEligibility:true}),true);
  assert.equal(allowed('/functions/v1/vote-access',{action:'student_receipts'},{allowAutomaticVoterEligibility:true}),true);
});
test('release cannot admit supplied identities, snapshot writes or worker calls',()=>{
  for(const body of [{...selection,student_id:1},{...selection,auth_user_id:'other'},{...selection,organization_id:2},{...selection,election_id:0}])assert.equal(allowed('/functions/v1/submit-vote',body,{allowAutomaticVoterEligibility:true}),false);
  for(const path of ['/functions/v1/anchor-ballot-hashes','/rest/v1/vote_ballots','/rest/v1/election_eligible_voters','/rest/v1/rpc/insert_v2_vote_rows'])assert.equal(allowed(path,selection,{allowAutomaticVoterEligibility:true}),false);
});
test('unfrozen access still goes through JWT RPC; denied responses reveal no candidates',async()=>{
  for(const frozen of [null,'2026-10-21T00:00:00Z']){
    let calls=0;
    const client={rpc(name,args){assert.equal(name,'kandid_get_student_ballot_candidates');assert.deepEqual(args,{p_election_id:5});calls++;return {retry:()=>Promise.resolve({data:[{id:201}],error:{code:'42501'},status:403})};}};
    const result=await loadStudentBallotCandidates(client,{id:5,electorate_policy_version:1,electorate_frozen_at:frozen});
    assert.equal(calls,1);assert.deepEqual(result.data,[]);assert.ok(result.error);
  }
});
test('atomic hash, nonce, grouping, timestamp and receipt reference implementation is byte-for-byte preserved',()=>{
  const old=captured.functions.find(x=>x.definition.includes('FUNCTION public.insert_v2_vote_rows')).definition;
  const marker='  ---------------------------------------------------------------------------\n  -- Authoritative duplicate-ballot guard';
  const end=proposal.indexOf('\n$function$',proposal.indexOf(marker));
  assert.equal(proposal.slice(proposal.indexOf(marker),end),old.slice(old.indexOf(marker),old.lastIndexOf('\n$function$')));
});
test('registered ballot candidate payload is preserved independently of campaign publication',()=>{
  const old=captured.functions.find(x=>x.definition.includes('FUNCTION public.kandid_get_student_ballot_candidates')).definition;
  const marker='  select coalesce(pg_catalog.jsonb_agg';
  assert.ok(proposal.includes(old.slice(old.indexOf(marker))));
});
test('database predicate uses current trusted identity, verified email, term membership and optional OR rules',()=>{
  const core=read('supabase/proposals/automatic-voter-eligibility.core.sql');
  for(const pattern of [/u\.email_confirmed_at is not null/,/s\.auth_user_id is not null/,/ste\.enrollment_status='enrolled'/,/membership\.allowed is true and membership\.status='active'/,/not exists \(select 1 from public\.eligibility_rules/,/or exists \(/,/ste\.year_level>=r\.min_year_level/,/r\.allow_shs is true/])assert.match(core,pattern);
  const body=core.slice(core.indexOf('as $function$'),core.indexOf('$function$;'));
  assert.doesNotMatch(body,/electorate_frozen_at|election_eligible_voters/);
  assert.match(core,/from public\.students where auth_user_id=auth\.uid\(\)/);
});
test('public eligibility function is caller-only and internal helpers grant no browser execution',()=>{
  assert.match(proposal,/grant execute on function public\.kandid_check_student_ballot_eligibility\(integer\) to authenticated/);
  assert.doesNotMatch(proposal,/grant execute on function private\./);
  assert.doesNotMatch(proposal,/grant\s+(select|insert|update|delete|all)\s+on\s+(?:table\s+)?public\./i);
});
test('Board release removes scheduling/lock workflow without changing existing snapshot edit locks',()=>{
  const page=read('src/pages/board/BoardElectionSetup.jsx');
  assert.match(page,/isEditing && !automaticEligibility/);
  assert.match(page,/No electorate lock is required/);
  assert.match(page,/electorateLocked = Boolean\(editing\?\.electorate_frozen_at/);
  assert.match(read('src/pages/board/Elections.jsx'),/if \(!isAutomaticVoterEligibilityEnabled\(import\.meta\.env\)\) \{\s*await assertElectorateSchedulingReady/);
});
test('no data-changing election/snapshot SQL or automatic scheduling is introduced',()=>{
  assert.doesNotMatch(proposal,/\b(?:update|delete from|insert into)\s+(?:private\.election_eligible_voters|public\.elections)\b/i);
  assert.doesNotMatch(proposal,/cron\.|net\.http|schedule\(/);
  assert.match(proposal,/pg_advisory_xact_lock/);
  assert.match(proposal,/for share/);
  assert.match(proposal,/Eligibility rules are immutable after freezing or a recorded vote/);
});

test('frontend Election 5 submission is blocked before release and preserves JWT-only payload after release',async()=>{
  for(const enabled of [false,true]){
    const calls=[];
    const source=read('src/utils/voting.js').replaceAll('import.meta.env','__environment');
    const code=transformSync(source,{loader:'js',format:'cjs'}).code;
    const module={exports:{}};
    new Function('require','module','exports','__environment',code)(name=>{
      if(name.includes('supabaseClient'))return {supabase:{},guardedSupabaseFetch:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({data:{ballot_id:'synthetic-ballot',submitted_at:'synthetic-time'}}),{status:200});}};
      if(name.includes('localProductionReadOnly'))return {READ_ONLY_DASHBOARD_MODE:'readonly-test'};
      if(name.includes('automaticVoterEligibility'))return {isAutomaticVoterEligibilityEnabled};
      if(name.includes('voteAccess'))return {};
      throw Error('Unexpected import '+name);
    },module,module.exports,{MODE:'development',VITE_SUPABASE_URL:'https://synthetic.invalid',VITE_SUPABASE_KEY:'synthetic-public',VITE_ENABLE_AUTOMATIC_VOTER_ELIGIBILITY:String(enabled)});
    const result=await module.exports.submitBallot({electionId:5,selectedVotes:selection.selected_votes,accessToken:'synthetic-session'});
    assert.equal(calls.length,enabled?1:0);assert.equal(Boolean(result.error),!enabled);
    if(enabled){const body=JSON.parse(calls[0].init.body);assert.equal(body.election_id,5);assert.equal(Object.hasOwn(body,'student_id'),false);assert.equal(result.ballotId,'synthetic-ballot');}
  }
});

test('release manifest matches all scoped artifacts',()=>{
  const manifest=JSON.parse(read('docs/automatic-voter-eligibility-manifest.json'));
  const setup=JSON.parse(read('docs/student-setup-security-manifest.json'));
  for(const f of manifest.files){
    const approved=['src/utils/developmentProductionWriteGuard.js','tests/automaticVoterEligibility.test.mjs'].includes(f.path)?setup.review_files.find(x=>x.path===f.path):null;
    const raw=readFileSync(f.path);
    assert.equal(createHash('sha256').update(raw).digest('hex'),approved?.sha256||f.sha256,f.path);
  }
});
