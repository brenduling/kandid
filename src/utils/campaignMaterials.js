import { loadCandidateManagementContext } from "./candidateManagementContract.js";
import { parseCampaignMaterialReference } from "./campaignMaterialReferences.js";

export const CAMPAIGN_MATERIALS_BUCKET = "campaign-materials";
export const CAMPAIGN_MATERIAL_LIMITS = Object.freeze({
  image: 5 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  document: 20 * 1024 * 1024,
});

const FILE_TYPES = Object.freeze({
  image: {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  },
  video: {
    "video/mp4": "mp4",
    "video/webm": "webm",
  },
  document: { "application/pdf": "pdf" },
});
export { parseCampaignMaterialReference } from "./campaignMaterialReferences.js";

function isSignature(bytes, kind, mime) {
  if (kind === "image" && mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (kind === "image" && mime === "image/png") return bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === "PNG";
  if (kind === "image" && mime === "image/webp") return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (kind === "video" && mime === "video/mp4") return String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  if (kind === "video" && mime === "video/webm") return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  if (kind === "document" && mime === "application/pdf") return String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";
  return false;
}

export async function validateCampaignMaterialFile(file, kind) {
  if (!file || !Object.hasOwn(FILE_TYPES, kind)) throw new Error("Choose a supported campaign file type.");
  const extension = FILE_TYPES[kind][file.type];
  if (!extension) throw new Error("Choose a supported JPG, PNG, WebP, MP4, WebM, or PDF file.");
  if (file.size <= 0 || file.size > CAMPAIGN_MATERIAL_LIMITS[kind]) {
    const limitMb = CAMPAIGN_MATERIAL_LIMITS[kind] / (1024 * 1024);
    throw new Error(`This ${kind} must be smaller than ${limitMb} MB.`);
  }
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!isSignature(bytes, kind, file.type)) throw new Error("The selected file content does not match its file type.");
  return { extension, contentType: file.type };
}

export async function uploadCampaignMaterial(client, file, kind, electionId) {
  const validated = await validateCampaignMaterialFile(file, kind);
  const context = await loadCandidateManagementContext(client, electionId);
  if (!context.election || context.election.id !== Number(electionId)) {
    throw new Error("Election upload authorization could not be verified.");
  }
  if (!globalThis.crypto?.randomUUID) throw new Error("Secure file naming is unavailable in this browser.");
  const path = `${context.election.organization_id}/${context.election.id}/${globalThis.crypto.randomUUID()}.${validated.extension}`;
  const { data, error } = await client.storage.from(CAMPAIGN_MATERIALS_BUCKET).upload(path, file, {
    cacheControl: "3600",
    contentType: validated.contentType,
    upsert: false,
  });
  if (error) {
    if (/temporary official-production development write safeguard/.test(error.message || "")) {
      throw new Error("Campaign upload was blocked by local request validation. Reload the page and retry a supported file. Your candidate record was not changed.");
    }
    if (/bucket.*not found|not found.*bucket/i.test(error.message || "")) {
      throw new Error("Private campaign file storage is not installed yet. Your candidate record was not changed.");
    }
    throw new Error(error.message || "Campaign file upload failed. Retry the upload.");
  }
  if (data?.path !== path) {
    throw new Error("Campaign file upload could not be confirmed. Refresh before retrying. Your candidate record was not changed.");
  }
  return {
    path,
    reference: `storage://${CAMPAIGN_MATERIALS_BUCKET}/${path}`,
    type: kind === "document" ? "document" : "media",
    inputType: kind,
  };
}

export async function removeUnreferencedCampaignMaterial(client, path) {
  if (typeof path !== "string" || !/^[1-9][0-9]*\/[1-9][0-9]*\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|mp4|webm|pdf)$/i.test(path)) {
    throw new Error("Campaign file cleanup path is invalid.");
  }
  const { error } = await client.storage.from(CAMPAIGN_MATERIALS_BUCKET).remove([path]);
  if (error) throw new Error(error.message || "Temporary campaign file cleanup failed.");
}

export async function resolveCampaignMaterialUrl(client, value) {
  const reference = parseCampaignMaterialReference(value);
  if (!reference) {
    if (typeof value !== "string") return "";
    try {
      const parsed = new URL(value);
      return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : "";
    } catch {
      return "";
    }
  }
  const { data, error } = await client.storage.from(CAMPAIGN_MATERIALS_BUCKET)
    .createSignedUrl(reference.path, 900);
  if (error || !data?.signedUrl) throw new Error(error?.message || "This campaign file is not available to your account.");
  return data.signedUrl;
}

export function inferCampaignMaterialInputType(material) {
  if (material?.inputType && Object.hasOwn(FILE_TYPES, material.inputType)) return material.inputType;
  if (material?.type === "link" || material?.type === "document") return material.type;
  const ref = parseCampaignMaterialReference(material?.url);
  const url = material?.url || "";
  const extension = (ref?.extension || url.split(/[?#]/, 1)[0].split(".").pop() || "").toLowerCase();
  return ["mp4", "webm"].includes(extension) ? "video" : "image";
}
