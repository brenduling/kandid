import test from 'node:test';
import assert from 'node:assert/strict';
import { loadElectionCampaignPublication, publishElectionCampaigns, validateCampaignPublicationState, campaignPublicationError } from '../src/utils/electionCampaignPublication.js';
const review = { contract_version:1,election_id:3,publication_status:'draft',total_candidates:3,eligible_candidates:2,
 published_candidates:0,draft_candidates:2,hidden_candidates:1,invalid_candidates:0,issues:[],can_publish:true,roster_fingerprint:'a'.repeat(32) };
const published={...review,publication_status:'published',published_candidates:2,draft_candidates:0,can_publish:false,confirmed:true,updated_candidates:2,roster_fingerprint:'b'.repeat(32)};
function client({value=review,error=null,anonymous=false,offline=false}={}){
 const calls=[];
 return { calls,auth:{getUser:async()=>({data:{user:anonymous?null:{id:'synthetic'}}})},rpc(name,args){
   calls.push({name,args});const result=offline?Promise.reject(Error('offline')):Promise.resolve({data:value,error});
   result.retry=enabled=>{assert.equal(enabled,false);return result;};return result;
 }};
}
test('publication review loads the selected election through one authenticated read RPC',async()=>{
 const c=client();assert.deepEqual(await loadElectionCampaignPublication(c,3),review);
 assert.deepEqual(c.calls,[{name:'kandid_get_election_campaign_publication_v1',args:{p_election_id:3}}]);
});
test('publish uses a single atomic RPC with the confirmed roster digest and no actor, organization or candidate override',async()=>{
 const c=client({value:published});assert.deepEqual(await publishElectionCampaigns(c,review),published);
 assert.deepEqual(c.calls,[{name:'kandid_publish_election_campaigns_v1',args:{p_election_id:3,p_roster_fingerprint:'a'.repeat(32)}}]);
});
test('missing authentication, invalid election, blocked review and malformed state never reach publication',async()=>{
 const c=client({anonymous:true});await assert.rejects(publishElectionCampaigns(c,review),/session has expired/);assert.equal(c.calls.length,0);
 const invalid=client();await assert.rejects(loadElectionCampaignPublication(invalid,0));assert.equal(invalid.calls.length,0);
 await assert.rejects(publishElectionCampaigns(invalid,{...review,can_publish:false}),/Resolve/);assert.equal(invalid.calls.length,0);
 for(const bad of [{...review,election_id:4},{...review,total_candidates:0},{...review,eligible_candidates:0},{...review,issues:null},{...review,roster_fingerprint:'bad'},{...review,invalid_candidates:1}])assert.throws(()=>validateCampaignPublicationState(bad,3));
});
test('network or database failures are not automatically retried or represented as an empty roster',async()=>{
 for(const options of [{offline:true},{error:{code:'42501',message:'Denied'}}]){
  const c=client(options);await assert.rejects(publishElectionCampaigns(c,review));assert.equal(c.calls.length,1);
 }
 assert.match(campaignPublicationError({code:'PGRST202'}),/backend is not installed/);
 assert.match(campaignPublicationError({code:'40001'}),/Refresh/);
 assert.match(campaignPublicationError({code:'55P03'}),/in progress/);
});
test('success requires the complete roster contract and explicit server confirmation',async()=>{
 for(const value of [{...published,confirmed:false},{...published,publication_status:'changes_pending',draft_candidates:1,published_candidates:1},{...published,updated_candidates:null}])
  await assert.rejects(publishElectionCampaigns(client({value}),review));
});
test('a later Draft addition has a new review and needs a separate explicit publication',async()=>{
 const later={...review,publication_status:'changes_pending',total_candidates:4,eligible_candidates:3,published_candidates:2,draft_candidates:1,roster_fingerprint:'c'.repeat(32)};
 const c=client({value:{...published,total_candidates:4,eligible_candidates:3,published_candidates:3,updated_candidates:1}});
 await publishElectionCampaigns(c,later);assert.equal(c.calls[0].args.p_roster_fingerprint,'c'.repeat(32));
});
