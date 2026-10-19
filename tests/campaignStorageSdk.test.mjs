import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageClient } from '@supabase/storage-js';
import { createClient } from '@supabase/supabase-js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fetchDevelopmentProductionRequest, isAllowedDevelopmentProductionRequest } from '../src/utils/developmentProductionWriteGuard.js';
import { uploadCampaignMaterial, resolveCampaignMaterialUrl } from '../src/utils/campaignMaterials.js';
import { saveCandidateEdit } from '../src/utils/candidateManagementContract.js';

const origin = 'https://fszgdxqxonqqcrzsnkca.supabase.co';
const path = '2/3/123e4567-e89b-42d3-a456-426614174000.png';

test('installed Storage SDK browser-file multipart reaches the guarded transport', async () => {
  let received;
  const storage = new StorageClient(`${origin}/storage/v1`, {}, (input, init) =>
    fetchDevelopmentProductionRequest(input, init, async (url, request) => {
      received = { url, request };
      return Response.json({ Id: 'synthetic-file', Key: `campaign-materials/${path}` });
    }, { allowCandidateManagement: true }));
  const { data, error } = await storage.from('campaign-materials').upload(path,
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'test.png', { type: 'image/png' }),
    { contentType: 'image/png', cacheControl: '3600', upsert: false });
  assert.equal(error, null);
  assert.equal(data.path, path);
  assert.ok(received.request.body instanceof FormData);
  assert.deepEqual([...received.request.body.keys()], ['cacheControl', '']);
  assert.equal(received.request.body.get('').type, 'image/png');
  assert.equal(new Headers(received.request.headers).get('x-upsert'), 'false');
});

const formats = [
  ['image/jpeg', 'jpg', 'image', [0xff, 0xd8, 0xff]],
  ['image/png', 'png', 'image', [0x89, 0x50, 0x4e, 0x47]],
  ['image/webp', 'webp', 'image', [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]],
  ['video/mp4', 'mp4', 'video', [0, 0, 0, 0, 102, 116, 121, 112]],
  ['video/webm', 'webm', 'video', [0x1a, 0x45, 0xdf, 0xa3]],
  ['application/pdf', 'pdf', 'document', [37, 80, 68, 70, 45]],
];
for (const [type, extension] of formats) test(`real SDK multipart allows only enabled ${type} uploads`, async () => {
  for (const enabled of [false, true]) {
    let requests = 0;
    const destination = path.replace(/png$/, extension);
    const storage = new StorageClient(`${origin}/storage/v1`, {}, (input, init) =>
      fetchDevelopmentProductionRequest(input, init, async () => {
        requests++;
        return Response.json({ Id: 'synthetic-file', Key: `campaign-materials/${destination}` });
      }, { allowCandidateManagement: enabled }));
    const result = await storage.from('campaign-materials').upload(destination,
      new File(['synthetic'], `test.${extension}`, { type }), { cacheControl: '3600', upsert: false });
    assert.equal(requests, enabled ? 1 : 0);
    assert.equal(result.error === null, enabled);
  }
});

function multipart() {
  const body = new FormData();
  body.append('cacheControl', '3600');
  body.append('', new Blob(['synthetic'], { type: 'image/png' }));
  return body;
}
test('multipart rejects extra/duplicate fields, metadata, empty/oversized files and mismatched types', () => {
  const allow = (body, overrides = {}) => isAllowedDevelopmentProductionRequest({
    input: `${origin}/storage/v1/object/campaign-materials/${path}`, method: 'POST', body,
    headers: { 'x-upsert': 'false' }, allowCandidateManagement: true, ...overrides,
  });
  assert.equal(allow(multipart()), true);
  for (const [key, value] of [['metadata', '{}'], ['owner_id', 'forged'], ['cacheControl', '3600'], ['', new Blob(['extra'])]]) {
    const body = multipart(); body.append(key, value); assert.equal(allow(body), false);
  }
  for (const file of [new Blob([],{type:'image/png'}), new Blob([new Uint8Array(5*1024*1024+1)],{type:'image/png'}),
    new Blob(['svg'],{type:'image/svg+xml'}), new Blob(['pdf'],{type:'application/pdf'})]) {
    const body = multipart(); body.set('', file); assert.equal(allow(body), false);
  }
  for (const cache of ['', '0', '999999']) { const body = multipart(); body.set('cacheControl', cache); assert.equal(allow(body), false); }
  const missing = multipart(); missing.delete(''); assert.equal(allow(missing), false);
  assert.equal(allow(multipart(), {headers:{'x-upsert':'true'}}), false);
  assert.equal(allow(multipart(), {headers:{}}), false);
  assert.equal(allow(multipart(), {headers:{'x-upsert':'false','content-type':'image/png'}}), false);
  for (const input of [`${origin}/storage/v1/object/other-bucket/${path}`, `${origin}/storage/v1/object/campaign-materials/../${path}`,
    `${origin}/storage/v1/object/campaign-materials/${path}?upsert=true`]) assert.equal(allow(multipart(), {input}), false);
  for (const method of ['PUT', 'PATCH']) assert.equal(allow(multipart(), {method}), false);
  assert.equal(allow({size:1,type:'image/png'}), false);
});

test('SDK permission, size and network failures are not converted into upload success', async () => {
  for (const [status, message] of [[403,'new row violates row-level security policy'],[413,'Object exceeded maximum size'],[500,'Storage unavailable']]) {
    let calls = 0;
    const storage = new StorageClient(`${origin}/storage/v1`, {}, (input, init) =>
      fetchDevelopmentProductionRequest(input, init, async () => {
        calls++; return Response.json({ statusCode: String(status), error:'test_failure', message },{status});
      },{allowCandidateManagement:true}));
    const result = await storage.from('campaign-materials').upload(path, new File(['test'],'test.png',{type:'image/png'}),{cacheControl:'3600',upsert:false});
    assert.equal(result.data,null); assert.equal(result.error.message,message); assert.equal(calls,1);
  }
});

test('real SDK loopback HTTP: multipart upload, metadata save/reload and private signed retrieval for each file type', async () => {
  // Synthetic HTTP fixture, never the official Storage/Auth/Database services.
  // This validates SDK serialization and application contracts, not production RLS.
  const original = { id:42,position_id:4,student_id:5,partylist_id:null,photo:null,bio:null,platform:null,credentials:null,campaign_materials:[],campaign_media_urls:[] };
  let saved = structuredClone(original);
  const objects = new Map();
  const requests = [];
  const server = createServer(async (req,res) => {
    try {
      const chunks=[]; for await (const chunk of req) chunks.push(chunk);
      const body=Buffer.concat(chunks);
      const url=new URL(req.url,'http://fixture.invalid');
      requests.push([req.method,url.pathname]);
      const reply = value => { res.setHeader('content-type','application/json'); res.end(JSON.stringify(value)); };
      if (url.pathname.startsWith('/storage/v1/object/campaign-materials/')) {
        assert.equal(req.method,'POST'); assert.equal(req.headers['x-upsert'],'false');
        const form=await new Request('http://fixture.invalid/file',{method:'POST',headers:req.headers,body}).formData();
        const file=form.get(''); assert.ok(file instanceof Blob);
        objects.set(url.pathname.slice('/storage/v1/object/campaign-materials/'.length),{type:file.type,bytes:await file.arrayBuffer()});
        return reply({Id:'synthetic-file',Key:url.pathname.slice('/storage/v1/object/'.length)});
      }
      if (url.pathname.startsWith('/storage/v1/object/sign/campaign-materials/')) {
        const objectPath=url.pathname.slice('/storage/v1/object/sign/campaign-materials/'.length);
        assert.ok(objects.has(objectPath)); assert.equal(JSON.parse(body).expiresIn,900);
        return reply({signedURL:`/object/sign/campaign-materials/${objectPath}?token=synthetic-only`});
      }
      if (url.pathname.endsWith('/kandid_candidate_management_context_v1')) return reply({contract_version:1,
        election:{id:3,organization_id:2,academic_term_id:1},positions:[{id:4,election_id:3,status:'active'}],partylists:[],eligible_students:[{id:5}]});
      if (url.pathname.endsWith('/kandid_admin_candidate_directory')) return reply([saved]);
      if (url.pathname==='/rest/v1/candidates' && req.method==='PATCH') {
        assert.equal(url.searchParams.get('id'),'eq.42'); assert.equal(url.searchParams.get('position_id'),'eq.4');
        saved={...saved,...JSON.parse(body)}; return reply({id:saved.id});
      }
      if (url.pathname==='/rest/v1/candidates' && req.method==='GET') return reply([saved]);
      throw new Error('Unexpected fixture route');
    } catch (error) { res.statusCode=500; res.setHeader('content-type','application/json'); res.end(JSON.stringify({message:error.message})); }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    const client=createClient(origin,'synthetic-public-key',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{fetch:(input,init)=>fetchDevelopmentProductionRequest(input,init,(url,options)=>{
        assert.equal(new URL(url).origin,origin);
        return fetch(`${base}${new URL(url).pathname}${new URL(url).search}`,options);
      },{allowCandidateManagement:true})}});
    client.auth.getUser=async()=>({data:{user:{id:'synthetic-verified-user'}},error:null});
    for (const [type,extension,kind,bytes] of formats) {
      const uploaded=await uploadCampaignMaterial(client,new File([new Uint8Array(bytes)],`harmless.${extension}`,{type}),kind,3);
      assert.match(uploaded.path,new RegExp(`^2/3/[0-9a-f-]{36}\\.${extension}$`));
      assert.equal(objects.get(uploaded.path).type,type);
      const material={type:uploaded.type,inputType:kind,label:`Fixture ${kind}`,url:uploaded.reference,downloadable:true};
      const result=await saveCandidateEdit(client,saved,{...saved,campaign_materials:[material]},3);
      assert.equal(result.error,null); assert.equal(result.data.id,42);
      const reloaded=await client.from('candidates').select('id,campaign_materials,campaign_media_urls').eq('id',42);
      assert.equal(reloaded.error,null);
      const persisted=reloaded.data[0].campaign_materials[0];
      assert.equal(persisted.url,uploaded.reference); assert.equal(persisted.label,material.label); assert.equal(persisted.downloadable,true);
      assert.deepEqual(reloaded.data[0].campaign_media_urls,[uploaded.reference]);
      assert.match(await resolveCampaignMaterialUrl(client,persisted.url),/\/storage\/v1\/object\/sign\/campaign-materials\//);
    }
    assert.equal(objects.size,6);
    assert.equal(requests.filter(([method,url])=>method==='PATCH'&&url==='/rest/v1/candidates').length,6);
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
});
