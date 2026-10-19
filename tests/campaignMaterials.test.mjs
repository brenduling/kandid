import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CAMPAIGN_MATERIALS_BUCKET,
  CAMPAIGN_MATERIAL_LIMITS,
  inferCampaignMaterialInputType,
  parseCampaignMaterialReference,
  removeUnreferencedCampaignMaterial,
  resolveCampaignMaterialUrl,
  uploadCampaignMaterial,
  validateCampaignMaterialFile,
} from "../src/utils/campaignMaterials.js";
import { validateCandidateValues, createCandidateSubmission } from "../src/utils/candidateManagementContract.js";
import { isAllowedDevelopmentProductionRequest } from "../src/utils/developmentProductionWriteGuard.js";

const ref = "storage://campaign-materials/2/3/123e4567-e89b-42d3-a456-426614174000.png";
const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0x52, 0x49, 0x46, 0x46]);
const file = (type, bytes = pngBytes, size = bytes.length) => ({
  type, name: "untrusted-name.exe", size,
  slice: () => ({ arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }),
});

function uploadClient({ uploadError = null } = {}) {
  const calls = [];
  const client = {
    calls,
    auth: { getUser: async () => ({ data: { user: { id: "verified-auth-user" } }, error: null }) },
    rpc(name, args) {
      const result = Promise.resolve({ data: {
        contract_version: 1,
        election: { id: 3, organization_id: 2, academic_term_id: 1 },
        positions: [{ id: 4, election_id: 3, status: "active" }], partylists: [], eligible_students: [{ id: 5 }],
      }, error: null });
      calls.push(["rpc", name, args]); result.retry = () => result; return result;
    },
    storage: { from(bucket) {
      return {
        upload: async (path, selected, options) => { calls.push(["upload", bucket, path, selected.type, options]); return { data: uploadError ? null : { path }, error: uploadError }; },
        remove: async (paths) => { calls.push(["remove", bucket, paths]); return { error: null }; },
        createSignedUrl: async (path, expiresIn) => { calls.push(["sign", bucket, path, expiresIn]); return { data: { signedUrl: "https://signed.example/file" }, error: null }; },
      };
    } },
  };
  return client;
}

test("JPG, PNG, WebP, MP4, WebM and PDF use fixed MIME and size allowlists", async () => {
  assert.equal((await validateCampaignMaterialFile(file("image/png"), "image")).extension, "png");
  assert.equal(CAMPAIGN_MATERIAL_LIMITS.image, 5 * 1024 * 1024);
  assert.equal(CAMPAIGN_MATERIAL_LIMITS.video, 50 * 1024 * 1024);
  assert.equal(CAMPAIGN_MATERIAL_LIMITS.document, 20 * 1024 * 1024);
  await assert.rejects(validateCampaignMaterialFile(file("image/svg+xml"), "image"), /supported/);
  await assert.rejects(validateCampaignMaterialFile(file("image/png", pngBytes, CAMPAIGN_MATERIAL_LIMITS.image + 1), "image"), /smaller/);
  await assert.rejects(validateCampaignMaterialFile(file("image/png", new Uint8Array(16)), "image"), /content/);
});

test("image upload uses the authorized election context, collision-resistant path and no upsert", async () => {
  const client = uploadClient();
  const uploaded = await uploadCampaignMaterial(client, file("image/png"), "image", 3);
  assert.equal(client.calls[0][1], "kandid_candidate_management_context_v1");
  assert.equal(client.calls[1][0], "upload");
  assert.equal(client.calls[1][1], CAMPAIGN_MATERIALS_BUCKET);
  assert.match(client.calls[1][2], /^2\/3\/[0-9a-f-]{36}\.png$/);
  assert.equal(client.calls[1][4].upsert, false);
  assert.equal(uploaded.type, "media");
  assert.equal(uploaded.reference, `storage://${CAMPAIGN_MATERIALS_BUCKET}/${uploaded.path}`);
});

test("missing session and foreign, removed or locked election denial never reach Storage", async () => {
  const anonymous = uploadClient();
  anonymous.auth.getUser = async () => ({data:{user:null},error:null});
  await assert.rejects(uploadCampaignMaterial(anonymous,file("image/png"),"image",3), /session has expired/);
  assert.equal(anonymous.calls.length,0);
  for (const message of ["Foreign organization denied","Removed election","Election lifecycle is locked"]) {
    const client = uploadClient();
    client.rpc = () => { const result=Promise.resolve({data:null,error:{code:"42501",message}}); result.retry=()=>result; return result; };
    await assert.rejects(uploadCampaignMaterial(client,file("image/png"),"image",3), error => error.message === message);
    assert.equal(client.calls.some(call=>call[0]==="upload"),false);
  }
});

test("candidate save stays disabled until campaign upload completes without changing the material UI", () => {
  const source=readFileSync(new URL("../src/components/CandidateManagement.jsx",import.meta.url),"utf8");
  assert.equal((source.match(/disabled=\{savingCandidate \|\| uploadingMaterialIndex !== null\}/g)||[]).length,3);
  assert.match(source,/if \(uploadingMaterialIndex !== null\) \{[\s\S]*?Wait for the campaign file upload to finish before saving\.[\s\S]*?return;/);
  assert.match(source,/Material title \$\{index \+ 1\}/);
  assert.match(source,/Allow student download/);
});

test("PDF uploads preserve the existing document JSON type; images and videos use media", async () => {
  const pdf = file("application/pdf", Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0, 0]));
  const doc = await uploadCampaignMaterial(uploadClient(), pdf, "document", 3);
  assert.equal(doc.type, "document");
  assert.equal(doc.inputType, "document");
  const videoClient = uploadClient();
  const video = file("video/webm", Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00]));
  const uploadedVideo = await uploadCampaignMaterial(videoClient, video, "video", 3);
  assert.equal(uploadedVideo.type, "media");
  assert.match(uploadedVideo.path, /\.webm$/);
  assert.equal(videoClient.calls[1][3], "video/webm");
  assert.equal(inferCampaignMaterialInputType({ type: "media", url: "https://assets.invalid/video.webm" }), "video");
  assert.equal(inferCampaignMaterialInputType({ type: "media", url: ref }), "image");
});

test("bucket absence and network errors are actionable and never claim an upload", async () => {
  await assert.rejects(uploadCampaignMaterial(uploadClient({ uploadError: { message: "Bucket not found" } }), file("image/png"), "image", 3), /not installed yet/);
  await assert.rejects(uploadCampaignMaterial(uploadClient({ uploadError: { message: "offline" } }), file("image/png"), "image", 3), /offline/);
  await assert.rejects(uploadCampaignMaterial(uploadClient({ uploadError: { message: "Blocked by the temporary official-production development write safeguard pending backend activation." } }), file("image/png"), "image", 3), /local request validation/);
  const unconfirmed=uploadClient();
  unconfirmed.storage.from=()=>({upload:async()=>({data:null,error:null})});
  await assert.rejects(uploadCampaignMaterial(unconfirmed,file("image/png"),"image",3), /could not be confirmed/);
});

test("private references are strict, HTTPS links are required, and foreign-election files fail trusted-context validation", async () => {
  assert.deepEqual(parseCampaignMaterialReference(ref), {
    organizationId: 2, electionId: 3, path: "2/3/123e4567-e89b-42d3-a456-426614174000.png", extension: "png",
  });
  assert.equal(parseCampaignMaterialReference("storage://campaign-materials/9/3/../unsafe.png"), null);
  const base = { position_id: 4, student_id: 5, campaign_materials: [{ type: "link", label: "Campaign", url: "https://campaign.example/path" }] };
  assert.equal(validateCandidateValues(base).campaign_materials[0].url, base.campaign_materials[0].url);
  assert.throws(() => validateCandidateValues({ ...base, campaign_materials: [{ ...base.campaign_materials[0], url: "http://campaign.example/path" }] }), /HTTPS/);
  const foreign = { ...base, campaign_materials: [{ type: "media", label: "Asset", url: "storage://campaign-materials/9/3/123e4567-e89b-42d3-a456-426614174000.png" }] };
  const client = uploadClient();
  const result = await createCandidateSubmission(client)(foreign, 3);
  assert.match(result.error.message, /belong to this election organization/);
  assert.equal(client.calls.some((call) => call[0] === "insert"), false);
});

test("student campaign signing is short-lived and cleanup is restricted to the dedicated bucket", async () => {
  const client = uploadClient();
  assert.equal(await resolveCampaignMaterialUrl(client, ref), "https://signed.example/file");
  assert.deepEqual(client.calls.at(-1), ["sign", CAMPAIGN_MATERIALS_BUCKET, parseCampaignMaterialReference(ref).path, 900]);
  await removeUnreferencedCampaignMaterial(client, parseCampaignMaterialReference(ref).path);
  assert.deepEqual(client.calls.at(-1), ["remove", CAMPAIGN_MATERIALS_BUCKET, [parseCampaignMaterialReference(ref).path]]);
  await assert.rejects(removeUnreferencedCampaignMaterial(client, "2/3/invalid-id.png"), /invalid/);
  assert.equal(await resolveCampaignMaterialUrl(client, "https://campaign.example/safe"), "https://campaign.example/safe");
  assert.equal(await resolveCampaignMaterialUrl(client, "javascript:alert(1)"), "");
});

test("production write guard allows only scoped campaign upload/sign/cleanup requests", () => {
  const origin = "https://fszgdxqxonqqcrzsnkca.supabase.co";
  const path = "2/3/123e4567-e89b-42d3-a456-426614174000.png";
  const upload = (overrides = {}) => isAllowedDevelopmentProductionRequest({
    input: `${origin}/storage/v1/object/campaign-materials/${path}`, method: "POST", body: new Blob(["image"]),
    headers: { "content-type": "image/png", "x-upsert": "false" }, allowCandidateManagement: true, ...overrides,
  });
  assert.equal(upload(), true);
  assert.equal(upload({ allowCandidateManagement: false }), false);
  assert.equal(upload({ headers: { "content-type": "image/svg+xml" } }), false);
  assert.equal(upload({ headers: { "content-type": "image/png", "x-upsert": "true" } }), false);
  assert.equal(upload({ method: "PUT" }), false);
  assert.equal(isAllowedDevelopmentProductionRequest({
    input: `${origin}/storage/v1/object/sign/campaign-materials/${path}`, method: "POST", body: JSON.stringify({ expiresIn: 900 }), allowCandidateManagement: true,
  }), true);
  assert.equal(isAllowedDevelopmentProductionRequest({
    input: `${origin}/storage/v1/object/sign/campaign-materials/${path}`, method: "POST", body: JSON.stringify({ expiresIn: 901 }), allowCandidateManagement: true,
  }), false);
  assert.equal(isAllowedDevelopmentProductionRequest({
    input: `${origin}/storage/v1/object/campaign-materials`, method: "DELETE", body: JSON.stringify({ prefixes: [path] }), allowCandidateManagement: true,
  }), true);
  assert.equal(isAllowedDevelopmentProductionRequest({
    input: `${origin}/storage/v1/object/campaign-materials`, method: "DELETE", body: JSON.stringify({ prefixes: ["../other/file.pdf"] }), allowCandidateManagement: true,
  }), false);
});

test("Board and Super Admin use a single header Add Candidate action with the existing dialog", () => {
  const source = readFileSync(new URL("../src/components/CandidateManagement.jsx", import.meta.url), "utf8");
  assert.match(source, /board-candidate-masthead-actions[\s\S]*?Add Candidate/);
  assert.match(source, /sa-candidates-add[\s\S]*?Add Candidate/);
  assert.match(source, /openCreateForm\("", selectedElectionId\)/);
  assert.match(source, /setFormOpen\(true\)/);
  assert.match(source, /selectedElectionReadOnly/);
});
