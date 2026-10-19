import {normalizeCampaignMaterialsInput} from './candidates.js';
import {parseCampaignMaterialReference} from './campaignMaterialReferences.js';

const id=value=>Number.isInteger(value)&&value>0&&value<=2147483647;
const failure=message=>Object.assign(new Error(message),{code:'CANDIDATE_VALIDATION'});
const uncertain=()=>Object.assign(new Error('Candidate creation could not be confirmed. It may already have been saved. Refresh the candidate list before starting another registration; do not resubmit this form.'),{code:'CANDIDATE_CREATE_UNCONFIRMED'});
const contentFields=['partylist_id','photo','bio','platform','credentials','campaign_materials','campaign_media_urls'];
const canonicalJson=value=>Array.isArray(value)?value.map(canonicalJson):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalJson(value[key])])):value;
const sameJson=(left,right)=>JSON.stringify(canonicalJson(left))===JSON.stringify(canonicalJson(right));

export function mergeCandidatePartylists(current,context){
 return [...new Map([...current.filter(p=>Number(p.election_id)!==context.election.id),...context.partylists].map(p=>[p.id,p])).values()];
}

function url(value,label){
 if(value==null||value==='')return null;
 if(typeof value!=='string')throw failure(label+' must be a valid hosted URL.');
 try{const u=new URL(value.trim());if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error();return u.href;}
 catch{throw failure(label+' must be an HTTP(S) URL from the existing approved hosting or storage workflow.');}
}
function campaignMaterialUrl(value,type){
 const reference=parseCampaignMaterialReference(value);
 if(reference)return value;
 try{
  const parsed=new URL(value.trim());
  if(type==='link'&&parsed.protocol!=='https:')throw new Error();
  if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error();
  return parsed.href;
 }catch{throw failure(type==='link'?'Campaign links must use a valid HTTPS URL.':'Campaign material must be an approved HTTPS URL or private uploaded file.');}
}
export function validateCandidateValues(values){
 if(!values||!id(Number(values.position_id))||!id(Number(values.student_id)))throw failure('Select a valid position and eligible student.');
 const party=values.partylist_id==null||values.partylist_id===''?null:Number(values.partylist_id);
 if(party!==null&&!id(party))throw failure('Select a valid partylist.');
 const draft=values.campaign_materials??[];
 if(!Array.isArray(draft)||draft.filter(m=>m?.url).length>3)throw failure('Use at most three campaign materials.');
 if(draft.some(m=>m&&['image','video','document'].includes(m.inputType)&&!m.url))throw failure('Upload the selected campaign file before saving the candidate.');
 for(const item of draft)if(!item||typeof item!=='object'||!['link','document','media'].includes(item.type))throw failure('Campaign material type is invalid.');
 for(const item of draft){
  if(item?.inputType!==undefined&&!['link','image','video','document'].includes(item.inputType))throw failure('Campaign material input type is invalid.');
  if(item?.inputType==='link'&&item.type!=='link'||['image','video'].includes(item?.inputType)&&item.type!=='media'||item?.inputType==='document'&&item.type!=='document')throw failure('Campaign material type does not match its selected input.');
  const reference=parseCampaignMaterialReference(item?.url);
  if(item?.inputType==='link'&&reference)throw failure('Choose Link or a file upload, not both.');
  if(item?.inputType==='image'&&(!reference||!['jpg','png','webp'].includes(reference.extension)))throw failure('Upload an approved image file before saving.');
  if(item?.inputType==='video'&&(!reference||!['mp4','webm'].includes(reference.extension)))throw failure('Upload an approved video file before saving.');
  if(item?.inputType==='document'&&(!reference||reference.extension!=='pdf'))throw failure('Upload an approved PDF before saving.');
 }
 const materials=normalizeCampaignMaterialsInput(draft).map(m=>({...m,url:campaignMaterialUrl(m.url,m.type)}));
 const row={position_id:Number(values.position_id),student_id:Number(values.student_id),partylist_id:party,photo:url(values.photo,'Photo'),campaign_materials:materials,campaign_media_urls:materials.map(m=>m.url)};
 for(const key of ['bio','platform','credentials']){if(values[key]!=null&&typeof values[key]!=='string')throw failure('Candidate '+key+' must be text.');row[key]=values[key]?.trim()||null;}
 return row;
}

export async function loadCandidateManagementContext(client,electionId){
 if(!id(Number(electionId)))throw failure('Choose an available election.');
 const auth=await client.auth.getUser();if(auth.error||!auth.data?.user?.id)throw Object.assign(failure('Your session has expired. Sign in again.'),{status:401});
 const {data,error}=await client.rpc('kandid_candidate_management_context_v1',{p_election_id:Number(electionId)}).retry(false);
 if(error){if(['PGRST202','42883'].includes(error.code))throw failure('Candidate registration backend is not activated. The reviewed candidate safety migration must be installed before writes can be enabled.');throw error;}
 if(data?.contract_version!==1||data.election?.id!==Number(electionId)||!id(data.election?.organization_id)||!id(data.election?.academic_term_id)||
   !['positions','partylists','eligible_students'].every(k=>Array.isArray(data[k])))throw failure('Candidate eligibility or backend readiness could not be verified. No change was submitted.');
 return data;
}

async function validateContext(client,row,electionId,original){
 const context=await loadCandidateManagementContext(client,electionId);
 const position=context.positions.find(p=>p.id===row.position_id&&p.election_id===context.election.id);
 if(!position||!original&&position.status!=='active')throw failure('The selected position is retired, invalid or unavailable.');
 if(!context.eligible_students.some(s=>s.id===row.student_id))throw failure('This student is not eligible for the election organization and academic term.');
 for(const material of row.campaign_materials){const reference=parseCampaignMaterialReference(material.url);if(reference&&(reference.organizationId!==context.election.organization_id||reference.electionId!==context.election.id))throw failure('Uploaded campaign files must belong to this election organization.');}
 if(row.partylist_id!==null&&!context.partylists.some(p=>p.id===row.partylist_id&&(p.election_id==null||p.election_id===context.election.id)&&p.organization_id===context.election.organization_id))throw failure('Partylist must belong to this organization and, when election-bound, this election.');
 const {data,error}=await client.rpc('kandid_admin_candidate_directory',{p_election_ids:[context.election.id],p_student_ids:[row.student_id]});
 if(error||!Array.isArray(data))throw failure('Existing candidate registrations could not be checked. No change was submitted.');
 if(data.some(c=>c.student_id===row.student_id&&c.id!==original?.id))throw failure('This student is already registered as a candidate in this election.');
 return context;
}

export function createCandidateSubmission(client){
 let pending,confirmed,unconfirmed=false;
 return function submit(values,electionId){
  if(confirmed)return Promise.resolve(confirmed);if(unconfirmed)return Promise.resolve({data:null,error:uncertain()});if(pending)return pending;
  pending=(async()=>{let started=false;try{
   const row=validateCandidateValues(values);await validateContext(client,row,electionId);started=true;
   // INSERT RETURNING invokes the admin SELECT policy before its self-lookup
   // can see the new row. Keep INSERT authorization unchanged, then confirm
   // the persisted identity through the existing trusted directory RPC.
   const result=await client.from('candidates').insert([row]).retry(false);
   if(result.error&&result.status>0&&result.status<500)return result;
   if(result.error||!(result.status>=200&&result.status<300)){if(/temporary official-production development write safeguard/.test(result.error?.message||''))return result;unconfirmed=true;return {data:null,error:uncertain()};}
   const saved=await client.rpc('kandid_admin_candidate_directory',{p_election_ids:[Number(electionId)],p_student_ids:[row.student_id]}).retry(false);
   const matches=Array.isArray(saved.data)?saved.data.filter(c=>c.student_id===row.student_id&&c.position_id===row.position_id):[];
   if(saved.error||matches.length!==1||!id(matches[0]?.id)||matches[0].campaign_status!=='draft'||
     contentFields.some(key=>!sameJson(matches[0][key]??(key.startsWith('campaign_')?[]:null),row[key]))){unconfirmed=true;return {data:null,error:uncertain()};}
   confirmed={data:{id:matches[0].id},error:null,status:result.status};return confirmed;
  }catch(error){if(started){unconfirmed=true;return {data:null,error:uncertain()};}return {data:null,error};}})().finally(()=>{pending=null;});return pending;
 };
}

async function confirmedUpdate(client,original,patch){
 let query=client.from('candidates').update(patch).eq('id',original.id).eq('position_id',original.position_id);
 for(const key of contentFields){if(!Object.hasOwn(original,key))continue;const value=original[key];query=value==null?query.is(key,null):query.eq(key,typeof value==='object'?JSON.stringify(value):value);}
 const result=await query.select('id').single().retry(false);if(!result.error&&result.data?.id!==original.id)throw failure('Candidate save was not confirmed. Reload before retrying.');return result;
}
export async function saveCandidateEdit(client,original,values,electionId){
 try{
  const row=validateCandidateValues(values);if(!id(original?.id)||row.student_id!==original.student_id||row.position_id!==original.position_id)throw failure('Candidate identity and original position cannot be changed in this form.');
  await validateContext(client,row,electionId,original);
  const patch=Object.fromEntries(contentFields.filter(k=>JSON.stringify(row[k])!==JSON.stringify(original[k]??(k.startsWith('campaign_')?[]:null))).map(k=>[k,row[k]]));
  if(!Object.keys(patch).length)return {data:{id:original.id},error:null,unchanged:true};
  return await confirmedUpdate(client,original,patch);
 }catch(error){return {data:null,error};}
}

export async function deleteCandidateSafely(client,original,electionId){
 try{if(!id(original?.id)||!id(original.position_id))throw failure('Choose an assigned candidate.');const context=await loadCandidateManagementContext(client,electionId);
  if(!context.positions.some(p=>p.id===original.position_id))throw failure('Candidate does not belong to the selected election.');
  const result=await client.from('candidates').delete().eq('id',original.id).eq('position_id',original.position_id).select('id').single().retry(false);
  if(!result.error&&result.data?.id!==original.id)throw failure('Candidate deletion was not confirmed. Refresh the list.');return result;
 }catch(error){return {data:null,error};}
}
export async function disconnectCandidateSafely(client,original,electionId){
 try{const context=await loadCandidateManagementContext(client,electionId);if(!id(original?.id)||!context.positions.some(p=>p.id===original.position_id))throw failure('Candidate does not belong to the selected election.');return await confirmedUpdate(client,original,{position_id:null});}
 catch(error){return {data:null,error};}
}
export function candidateSaveError(error){
 if(error?.code==='PGRST116')return 'Candidate changed or access was revoked. Reload before saving again.';
 if(error?.code==='42501')return /permission denied for table candidates/i.test(error.message||'') ? 'Candidate save was denied by a database permission check. Ask an administrator to review the backend dependency; your form values have been retained.' : error.message||'You do not have permission to change candidates for this election.';
 if(error?.code==='23514')return 'Candidate data failed a database validation rule. Review the entered values and try again.';
 if(error?.code==='23503')return 'Related records protect this candidate. No historical data was deleted.';
 if(/already (?:a candidate|registered as a candidate)/i.test(error?.message||''))return 'This student is already registered as a candidate in this election.';
 if(/temporary official-production development write safeguard/.test(error?.message||''))return 'Candidate management is not activated for this production-connected development session. No change was saved.';
 return error?.message||'Candidate save could not be confirmed. Check your connection and refresh before retrying.';
}
