import { ELECTION_EDIT_FIELDS } from "./electionEditContract.js";
import { validateCandidateValues } from "./candidateManagementContract.js";
import { isValidPartylistContent } from "./partylistManagement.js";
import { isValidEligibilityRuleContent } from "./eligibilityRuleManagement.js";
import { ELECTION_COVER_PATH, ELECTION_COVER_TYPES, ELECTION_COVER_MAX_BYTES } from "./electionCovers.js";

const OFFICIAL_SUPABASE_ORIGIN = "https://fszgdxqxonqqcrzsnkca.supabase.co";
const ISOLATED_STUDENT_SETUP_TEST_ORIGIN = "http://127.0.0.1:59321";
const SAFE_AUTH_READS = new Set(["/auth/v1/user"]);
const STUDENT_ELECTION_READ_RPCS = new Set([
  "/rest/v1/rpc/kandid_get_student_published_campaign",
  "/rest/v1/rpc/kandid_get_student_ballot_candidates",
  "/rest/v1/rpc/kandid_get_student_result_candidates",
]);
const SAFE_READ_RPC_PATHS = new Set([
  "rpc/kandid_server_time",
  "rpc/kandid_list_super_admin_audit_events",
  "rpc/kandid_list_board_audit_events",
  "rpc/kandid_list_board_report_elections",
  "rpc/kandid_get_board_election_report_package",
  "rpc/kandid_get_board_voting_monitor",
  "rpc/kandid_get_admin_election_geofence",
  "rpc/kandid_get_board_electorate_preview",
]);
const SAFE_VOTE_ACCESS_ACTIONS = new Set([
  "board_dashboard_counts",
  "super_admin_vote_count",
  "student_has_voted",
  "student_voted_elections",
  "student_verify_access_code",
  "student_verify_geofence",
  "vote_dependency_count",
]);
const SAFE_BOARD_MANUAL_ENROLLMENT_ACTIONS = new Set([
  "list_students",
  "list_removed_students",
  "resolve_student_for_term",
  "preview_board_csv_import",
]);
const BOARD_REGISTRATION_ACTIONS = new Set([
  "create_new_student_for_term",
  "enroll_existing_student_for_term",
]);
const BOARD_MANAGEMENT_ACTIONS = new Set([
  "update_student_names", "remove_student_participation", "restore_student_participation",
]);
const BOARD_REGISTRATION_METHODS = new Set(["school_id", "registration_form", "department_masterlist"]);
const BOARD_REGISTRATION_FIELDS = new Set(["action", "student", "verification_method", "evidence_reviewed"]);
const BOARD_REGISTRATION_STUDENT_FIELDS = new Set([
  "student_number", "first_name", "last_name", "email", "program", "year_level",
  "photo_url", "precinct_code", "batch_code",
]);
const SAFE_BOARD_LIST_FIELDS = new Set(["action", "page", "page_size", "search", "sort_by"]);

// These baseline permissions remain off. Separately approved registration and
// management builds pass independent flags plus strict payload validation below.
// Server authentication, organization scope and write gates remain authoritative.
export const PENDING_BOARD_STUDENT_WRITE_PERMISSIONS = Object.freeze({
  create_new_student_for_term: false,
  enroll_existing_student_for_term: false,
  remove_student_participation: false,
  restore_student_participation: false,
  update_student_names: false,
  confirm_board_csv_import: false,
  batch_enroll: false,
});

function requestUrl(input) {
  if (input instanceof Request) return input.url;
  return String(input || "");
}

function parseBody(body) {
  if (typeof body !== "string") return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function hasOnlyKeys(payload, allowedKeys) {
  return Object.keys(payload).every((key) => allowedKeys.has(key));
}

function isValidBoardRegistrationPayload(payload) {
  return hasOnlyKeys(payload, BOARD_REGISTRATION_FIELDS) &&
    payload.evidence_reviewed === true &&
    BOARD_REGISTRATION_METHODS.has(payload.verification_method) &&
    payload.student !== null && typeof payload.student === "object" && !Array.isArray(payload.student) &&
    hasOnlyKeys(payload.student, BOARD_REGISTRATION_STUDENT_FIELDS) &&
    typeof payload.student.student_number === "string" &&
    typeof payload.student.first_name === "string" &&
    typeof payload.student.last_name === "string" &&
    typeof payload.student.program === "string";
}

function isValidBoardCsvRows(rows) {
  const rowFields = new Set(["row_number", "student_number", "first_name", "last_name", "email", "program", "year_level", "is_shs", "status"]);
  return Array.isArray(rows) && rows.length > 0 && rows.length <= 500 && rows.every((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row) || !hasOnlyKeys(row, rowFields)) return false;
    if (typeof row.student_number !== "string" || !/^[0-9]{5}$/.test(row.student_number.trim())) return false;
    if (typeof row.first_name !== "string" || !row.first_name.trim() || row.first_name.trim().length > 100) return false;
    if (typeof row.last_name !== "string" || !row.last_name.trim() || row.last_name.trim().length > 100) return false;
    if (typeof row.program !== "string" || !row.program.trim() || row.program.trim().length > 80) return false;
    if (!Number.isInteger(Number(row.year_level)) || Number(row.year_level) < 1 || Number(row.year_level) > 6) return false;
    if (row.email !== undefined && row.email !== "" &&
      (typeof row.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim()))) return false;
    return row.row_number === undefined || (Number.isInteger(Number(row.row_number)) && Number(row.row_number) >= 2);
  });
}

function isValidBoardManagementPayload(payload) {
  if (!Number.isSafeInteger(payload.student_id) || payload.student_id <= 0) return false;
  if (payload.action === "restore_student_participation") {
    return hasOnlyKeys(payload, new Set(["action", "student_id"]));
  }
  if (payload.action === "remove_student_participation") {
    return hasOnlyKeys(payload, new Set(["action", "student_id", "reason", "confirm_student_number", "password"])) &&
      typeof payload.reason === "string" && payload.reason.trim().length > 0 && payload.reason.length <= 500 &&
      typeof payload.confirm_student_number === "string" && payload.confirm_student_number.trim().length > 0 &&
      typeof payload.password === "string" && payload.password.length > 0;
  }
  if (payload.action === "update_student_names") {
    return hasOnlyKeys(payload, new Set(["action", "student_id", "changes"])) &&
      payload.changes !== null && typeof payload.changes === "object" && !Array.isArray(payload.changes) &&
      hasOnlyKeys(payload.changes, new Set(["first_name", "last_name"])) &&
      [payload.changes.first_name, payload.changes.last_name].every((name) =>
        typeof name === "string" && name.trim().length > 0 && name.trim().length <= 100 &&
        [...name].every((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127));
  }
  return false;
}

function isValidIsolatedStudentSetupPayload(payload) {
  if (payload?.action === "inspect_setup") return isValidStudentSetupPayload(payload);
  if (payload?.action === "begin_access") {
    return hasOnlyKeys(payload, new Set(["action", "student_number"])) &&
      typeof payload.student_number === "string" && /^[0-9]{1,20}$/.test(payload.student_number);
  }
  if (payload?.action === "verify_access") {
    return hasOnlyKeys(payload, new Set(["action", "student_number", "registered_email", "verification_code"])) &&
      typeof payload.student_number === "string" && /^[0-9]{1,20}$/.test(payload.student_number) &&
      (!Object.hasOwn(payload, "registered_email") || (typeof payload.registered_email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.registered_email))) &&
      typeof payload.verification_code === "string" && /^[0-9]{6}$/.test(payload.verification_code);
  }
  return false;
}

function isValidStudentSetupPayload(payload) {
  if (payload?.action === "inspect_setup") {
    return hasOnlyKeys(payload, new Set(["action", "student_number"])) &&
      typeof payload.student_number === "string" && /^[0-9]{1,20}$/.test(payload.student_number);
  }
  if (payload?.action === "begin_access") {
    return hasOnlyKeys(payload, new Set(["action", "student_number"])) &&
      typeof payload.student_number === "string" && /^[0-9]{1,20}$/.test(payload.student_number);
  }
  if (payload?.action === "verify_access") {
    return hasOnlyKeys(payload, new Set(["action", "student_number", "registered_email", "verification_code"])) &&
      typeof payload.student_number === "string" && /^[0-9]{1,20}$/.test(payload.student_number) &&
      (!Object.hasOwn(payload, "registered_email") || (typeof payload.registered_email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.registered_email))) &&
      typeof payload.verification_code === "string" && /^[0-9]{6}$/.test(payload.verification_code);
  }
  return false;
}

function isValidStudentIdentityLinkPayload(payload) {
  return hasOnlyKeys(payload, new Set(["student_number", "setup_mode", "password"])) &&
    typeof payload.student_number === "string" && /^[0-9]{1,20}$/.test(payload.student_number) &&
    payload.setup_mode === true && typeof payload.password === "string" &&
    payload.password.length >= 6 && payload.password.length <= 256 &&
    /[A-Za-z]/.test(payload.password) && /\d/.test(payload.password) && /[^A-Za-z0-9]/.test(payload.password);
}

/**
 * Temporary safety gate while the official production backend awaits its approved
 * activation. It permits reads, session maintenance and reviewed read-only RPCs,
 * while refusing mutations from normal local development.
 */
export function isAllowedDevelopmentProductionRequest({ input, method, body, headers, allowBoardStudentRegistration = false, allowBoardStudentManagement = false, allowStudentAccountSetup = false, allowElectionSoftRemoval = false, allowElectionManagement = false, allowPositionManagement = false, allowCandidateManagement = false, allowIsolatedStudentSetupTests = false }) {
  let url;
  try {
    url = new URL(requestUrl(input));
  } catch {
    return false;
  }
  const verb = String(method || "GET").toUpperCase();
  const path = url.pathname;
  const requestHeaders = new Headers(headers || (input instanceof Request ? input.headers : undefined));

  if (url.origin === ISOLATED_STUDENT_SETUP_TEST_ORIGIN) {
    if (allowIsolatedStudentSetupTests !== true || verb !== "POST") return false;
    const payload = parseBody(body);
    if (path === "/functions/v1/resolve-student-login") return isValidIsolatedStudentSetupPayload(payload);
    if (path === "/functions/v1/link-student-identity") return isValidStudentIdentityLinkPayload(payload);
    return false;
  }
  if (url.origin !== OFFICIAL_SUPABASE_ORIGIN) return false;

  // These installed RPCs authorize the JWT student themselves. Admit only the
  // election argument, never a caller-supplied student or organization scope.
  if (STUDENT_ELECTION_READ_RPCS.has(path)) {
    const payload = parseBody(body);
    return verb === "POST" && !url.search && payload !== null &&
      typeof payload === "object" && !Array.isArray(payload) &&
      Object.keys(payload).length === 1 && Number.isInteger(payload.p_election_id) &&
      payload.p_election_id > 0 && payload.p_election_id <= 2147483647;
  }

  if (path.startsWith("/storage/v1/object/")) {
    // Only immutable, scoped cover INSERTs. Production Storage RLS verifies
    // the JWT administrator, organization and (for edits) election ownership.
    if (path.startsWith("/storage/v1/object/election-covers/")) {
      const objectPath = path.slice("/storage/v1/object/election-covers/".length);
      if (verb !== "POST" || url.search || !ELECTION_COVER_PATH.test(objectPath) ||
          requestHeaders.get("x-upsert") !== "false") return false;
      let file = body;
      let mime = (requestHeaders.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (body instanceof FormData) {
        if ([...body.keys()].length !== 2 || body.getAll("").length !== 1 ||
            body.getAll("cacheControl").length !== 1 || body.get("cacheControl") !== "3600" || mime) return false;
        file = body.get(""); mime = file instanceof Blob ? file.type : "";
      }
      return file instanceof Blob && Object.hasOwn(ELECTION_COVER_TYPES, mime) &&
        objectPath.endsWith(`.${ELECTION_COVER_TYPES[mime]}`) && file.type === mime &&
        file.size > 0 && file.size <= ELECTION_COVER_MAX_BYTES;
    }
    const storagePath = "[1-9][0-9]*/[1-9][0-9]*/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.](?:jpg|png|webp|mp4|webm|pdf)";
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "application/pdf"]);
    if (verb === "POST" && new RegExp(`^/storage/v1/object/sign/campaign-materials/${storagePath}$`, "i").test(path)) {
      const payload = parseBody(body);
      return payload && Object.keys(payload).length === 1 && Number.isInteger(payload.expiresIn) && payload.expiresIn > 0 && payload.expiresIn <= 900;
    }
    if (allowCandidateManagement !== true) return false;
    if (verb === "POST" && new RegExp(`^/storage/v1/object/campaign-materials/${storagePath}$`, "i").test(path)) {
      if (url.search || requestHeaders.get("x-upsert") !== "false") return false;
      let file = body;
      let contentType = (requestHeaders.get("content-type") || "").split(";")[0].trim().toLowerCase();
      // storage-js wraps browser File/Blob uploads in exactly these two parts.
      // The browser supplies the multipart boundary; MIME/size belong to the file.
      if (body instanceof FormData) {
        const fields = [...body.keys()];
        if (fields.length !== 2 || body.getAll("").length !== 1 ||
            body.getAll("cacheControl").length !== 1 || body.get("cacheControl") !== "3600" || contentType) return false;
        file = body.get("");
        contentType = file instanceof Blob ? file.type : "";
      }
      const limits = { "image/jpeg": 5 * 1024 * 1024, "image/png": 5 * 1024 * 1024, "image/webp": 5 * 1024 * 1024, "video/mp4": 50 * 1024 * 1024, "video/webm": 50 * 1024 * 1024, "application/pdf": 20 * 1024 * 1024 };
      const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm", "application/pdf": "pdf" };
      return file instanceof Blob && allowedTypes.has(contentType) && path.toLowerCase().endsWith(`.${extensions[contentType]}`) &&
        file.size > 0 && file.size <= limits[contentType] && (!file.type || file.type === contentType);
    }
    if (verb === "DELETE" && path === "/storage/v1/object/campaign-materials" && !url.search) {
      const payload = parseBody(body);
      return payload && Object.keys(payload).length === 1 && Array.isArray(payload.prefixes) && payload.prefixes.length === 1 &&
        new RegExp(`^${storagePath}$`, "i").test(payload.prefixes[0]);
    }
    return false;
  }

  if (path === "/auth/v1/token" && verb === "POST") {
    return new Set(["password", "refresh_token"]).has(url.searchParams.get("grant_type"));
  }
  if (path === "/auth/v1/logout" && verb === "POST") return true;
  if (SAFE_AUTH_READS.has(path) && (verb === "GET" || verb === "HEAD")) return true;

  if (path.startsWith("/rest/v1/")) {
    if (verb === "GET" || verb === "HEAD") return true;
    // Existing RLS and removed-election/audit triggers authorize these exact
    // declared-audience writes. No organization claims or electorate writes.
    if (path === "/rest/v1/eligibility_rules") {
      if (!["POST", "PATCH", "DELETE"].includes(verb) ||
          ["content-profile", "accept-profile"].some((key) => requestHeaders.has(key) && requestHeaders.get(key) !== "public") ||
          /resolution=/i.test(requestHeaders.get("prefer") || "") ||
          url.searchParams.get("select") !== "id" || url.searchParams.getAll("select").length !== 1) return false;
      const payload = parseBody(body);
      if (verb === "POST") {
        const row = Array.isArray(payload) && payload.length === 1 ? payload[0] : null;
        if (!row || !Number.isInteger(row.election_id) || row.election_id <= 0 || row.election_id > 2147483647) return false;
        const { election_id: electionId, ...content } = row;
        if (!electionId || !isValidEligibilityRuleContent(content)) return false;
        const columns = url.searchParams.get("columns");
        const supplied = columns && /^"[a-z_]+"(?:,"[a-z_]+")*$/.test(columns) ? columns.split(",").map((key) => key.slice(1, -1)).sort() : [];
        return url.searchParams.getAll("columns").length <= 1 &&
          (!url.searchParams.has("columns") || JSON.stringify(supplied) === JSON.stringify(Object.keys(row).sort())) &&
          [...url.searchParams.keys()].every((key) => ["select", "columns"].includes(key));
      }
      if (!["id", "election_id"].every((key) => url.searchParams.getAll(key).length === 1 && /^eq\.[1-9][0-9]*$/.test(url.searchParams.get(key) || "") &&
          Number(url.searchParams.get(key).slice(3)) <= 2147483647) ||
          ![...url.searchParams.keys()].every((key) => ["select", "id", "election_id"].includes(key))) return false;
      return verb === "DELETE" ? body == null : isValidEligibilityRuleContent(payload);
    }
    // Reviewed organization-wide Partylist CRUD. The JWT-derived production
    // RLS predicate remains authoritative; no bulk writes or parent moves.
    if (path === "/rest/v1/partylists") {
      const positive = (value) => Number.isSafeInteger(value) && value > 0;
      if (!["POST", "PATCH", "DELETE"].includes(verb) ||
          ["content-profile", "accept-profile"].some((key) => requestHeaders.has(key) && requestHeaders.get(key) !== "public") ||
          /resolution=/i.test(requestHeaders.get("prefer") || "") ||
          url.searchParams.get("select") !== "id" || url.searchParams.getAll("select").length !== 1) return false;
      const payload = parseBody(body);
      if (verb === "POST") {
        const row = Array.isArray(payload) && payload.length === 1 ? payload[0] : null;
        if (!row || !positive(row.organization_id)) return false;
        const { organization_id: organizationId, ...content } = row;
        if (!organizationId || !isValidPartylistContent(content)) return false;
        const expected = Object.keys(row).sort();
        const columns = url.searchParams.get("columns");
        const supplied = columns && /^"[a-z_]+"(?:,"[a-z_]+")*$/.test(columns)
          ? columns.split(",").map((key) => key.slice(1, -1)).sort() : [];
        return url.searchParams.getAll("columns").length <= 1 &&
          (!url.searchParams.has("columns") || JSON.stringify(supplied) === JSON.stringify(expected)) &&
          [...url.searchParams.keys()].every((key) => ["select", "columns"].includes(key));
      }
      if (!["id", "organization_id"].every((key) => url.searchParams.getAll(key).length === 1 &&
          /^eq\.[1-9][0-9]*$/.test(url.searchParams.get(key) || "") && positive(Number(url.searchParams.get(key).slice(3)))) ||
          ![...url.searchParams.keys()].every((key) => ["select", "id", "organization_id"].includes(key))) return false;
      return verb === "DELETE" ? body == null : isValidPartylistContent(payload);
    }
    if (verb === "POST" && path === "/rest/v1/rpc/kandid_admin_candidate_directory") {
      const row=parseBody(body),validIds=v=>v===null||Array.isArray(v)&&v.length>0&&v.length<=200&&v.every(id=>Number.isInteger(id)&&id>0&&id<=2147483647);
      return Boolean(row&&Object.keys(row).length===2&&hasOnlyKeys(row,new Set(["p_election_ids","p_student_ids"]))&&
        validIds(row.p_election_ids)&&validIds(row.p_student_ids)&&(row.p_election_ids!==null||row.p_student_ids!==null)&&!url.search);
    }
    if (verb === "POST" && path === "/rest/v1/rpc/kandid_candidate_management_context_v1") {
      const row=parseBody(body);return Boolean(row&&Object.keys(row).length===1&&Number.isInteger(row.p_election_id)&&row.p_election_id>0&&row.p_election_id<=2147483647&&!url.search);
    }
    if (path === "/rest/v1/rpc/kandid_get_election_campaign_publication_v1" && verb === "POST") {
      const row = parseBody(body);
      return Boolean(row && Object.keys(row).length === 1 && Number.isInteger(row.p_election_id) && row.p_election_id > 0 && row.p_election_id <= 2147483647 && !url.search);
    }
    if (path === "/rest/v1/rpc/kandid_publish_election_campaigns_v1" && verb === "POST") {
      const row = parseBody(body);
      return Boolean(allowCandidateManagement === true && row && Object.keys(row).length === 2 &&
        hasOnlyKeys(row, new Set(["p_election_id", "p_roster_fingerprint"])) &&
        Number.isInteger(row.p_election_id) && row.p_election_id > 0 && row.p_election_id <= 2147483647 &&
        typeof row.p_roster_fingerprint === "string" && /^[0-9a-f]{32}$/.test(row.p_roster_fingerprint) && !url.search);
    }
    if (allowCandidateManagement === true && path === "/rest/v1/candidates") {
      const payload=parseBody(body),content=new Set(["partylist_id","photo","bio","platform","credentials","campaign_materials","campaign_media_urls"]);
      const valid=row=>{try{
        if(!row||Array.isArray(row))return false;
        if(row.partylist_id!==undefined&&row.partylist_id!==null&&(!Number.isInteger(row.partylist_id)||row.partylist_id<=0))return false;
        const normalized=validateCandidateValues({position_id:1,student_id:1,...row});
        if(row.campaign_media_urls!==undefined&&JSON.stringify(row.campaign_media_urls)!==JSON.stringify(normalized.campaign_media_urls))return false;
        return true;
      }catch{return false;}};
      if(verb==="POST"){
        const row=Array.isArray(payload)&&payload.length===1?payload[0]:null,keys=row&&Object.keys(row);
        const columns=url.searchParams.get("columns"),expected=keys?.slice().sort(),given=columns&&/^"[a-z_]+"(?:,"[a-z_]+")*$/.test(columns)?columns.split(",").map(k=>k.slice(1,-1)).sort():[];
        return Boolean(row&&hasOnlyKeys(row,new Set(["position_id","student_id",...content]))&&Number.isInteger(row.position_id)&&row.position_id>0&&Number.isInteger(row.student_id)&&row.student_id>0&&valid(row)&&
          (!url.searchParams.has("columns")||JSON.stringify(given)===JSON.stringify(expected))&&url.searchParams.getAll("columns").length<=1&&[...url.searchParams.keys()].every(k=>k==="columns"));
      }
      if(url.searchParams.get("select")!=="id"||url.searchParams.getAll("select").length!==1)return false;
      if(!["PATCH","DELETE"].includes(verb)||!["id","position_id"].every(k=>url.searchParams.getAll(k).length===1&&/^eq\.[1-9][0-9]*$/.test(url.searchParams.get(k)||""))||
        ![...url.searchParams.keys()].every(k=>["select","id","position_id",...content].includes(k)))return false;
      if(verb==="DELETE")return body==null;
      if(payload&&Object.keys(payload).length===1&&payload.position_id===null)return true;
      return Boolean(payload&&Object.keys(payload).length>0&&hasOnlyKeys(payload,content)&&valid(payload));
    }
    if (allowPositionManagement === true && path === "/rest/v1/positions") {
      const payload = parseBody(body);
      const positive = v => Number.isInteger(v) && v > 0 && v <= 2147483647;
      if (url.searchParams.get("select") !== "id" || url.searchParams.getAll("select").length !== 1) return false;
      if (verb === "POST") {
        const row = Array.isArray(payload) && payload.length === 1 ? payload[0] : null;
        if (!row || Object.keys(row).length !== 4 || !hasOnlyKeys(row, new Set(["election_id", "name", "max_votes", "display_order"])) ||
            !positive(row.election_id) || !positive(row.max_votes) || !positive(row.display_order) ||
            typeof row.name !== "string" || !row.name.trim() || row.name.length > 100 || [...row.name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return false;
        const columns = url.searchParams.get("columns");
        const expected = Object.keys(row).sort();
        const supplied = columns && /^"[a-z_]+"(?:,"[a-z_]+")*$/.test(columns) ? columns.split(",").map(k => k.slice(1,-1)).sort() : [];
        return url.searchParams.getAll("columns").length <= 1 && (!url.searchParams.has("columns") || supplied.length === expected.length && supplied.every((k,i) => k === expected[i])) &&
          [...url.searchParams.keys()].every(k => ["columns", "select"].includes(k));
      }
      if (!["PATCH", "DELETE"].includes(verb) || !["id", "election_id"].every(k => url.searchParams.getAll(k).length === 1 && /^eq\.[1-9][0-9]*$/.test(url.searchParams.get(k) || ""))) return false;
      if (![...url.searchParams.keys()].every(k => ["select", "id", "election_id", "name", "max_votes", "display_order", "status"].includes(k))) return false;
      if (verb === "DELETE") return body == null;
      return payload && !Array.isArray(payload) && Object.keys(payload).length > 0 && hasOnlyKeys(payload, new Set(["name", "max_votes", "display_order", "status"])) &&
        (!Object.hasOwn(payload,"name") || typeof payload.name === "string" && payload.name.trim().length > 0 && payload.name.length <= 100 && [...payload.name].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)) &&
        ["max_votes","display_order"].every(k => !Object.hasOwn(payload,k) || positive(payload[k])) &&
        (!Object.hasOwn(payload,"status") || ["active","retired"].includes(payload.status));
    }
    if (allowPositionManagement === true && verb === "POST" && ["/rest/v1/rpc/kandid_can_mutate_election_positions", "/rest/v1/rpc/reorder_election_positions"].includes(path)) {
      const row = parseBody(body), positive = v => Number.isInteger(v) && v > 0 && v <= 2147483647;
      if (!row || !positive(row.p_election_id) || [...url.searchParams.keys()].length) return false;
      if (path.endsWith("/kandid_can_mutate_election_positions")) return hasOnlyKeys(row,new Set(["p_election_id"]));
      return hasOnlyKeys(row,new Set(["p_election_id","p_position_ids","p_display_orders"])) &&
        Array.isArray(row.p_position_ids) && Array.isArray(row.p_display_orders) && row.p_position_ids.length > 0 && row.p_position_ids.length <= 500 && row.p_position_ids.length === row.p_display_orders.length &&
        row.p_position_ids.every(positive) && row.p_display_orders.every(positive) && new Set(row.p_position_ids).size === row.p_position_ids.length && new Set(row.p_display_orders).size === row.p_display_orders.length;
    }
    if (path === "/rest/v1/elections" && allowElectionManagement === true) {
      const payload = parseBody(body);
      const validFields = (row) => row && typeof row === "object" && !Array.isArray(row) &&
        Object.keys(row).length > 0 && hasOnlyKeys(row, new Set(ELECTION_EDIT_FIELDS));
      if (verb === "PATCH") {
        const exactId = (key) => /^eq\.[1-9][0-9]*$/.test(url.searchParams.get(key) || "");
        return validFields(payload) && !Object.hasOwn(payload, "academic_term_id") && exactId("id") && exactId("organization_id") &&
          [...url.searchParams.keys()].every((key) => ["select", "id", "electorate_frozen_at", "electorate_policy_version", "results_released_at", ...ELECTION_EDIT_FIELDS].includes(key));
      }
      if (verb === "POST") {
        // PostgREST's array INSERT adds a quoted columns list. Admit only the
        // exact fields already validated in this single-row payload.
        const columns = url.searchParams.get("columns");
        const row = Array.isArray(payload) && payload.length === 1 ? payload[0] : null;
        const expectedColumns = row && typeof row === "object" ? Object.keys(row).sort() : [];
        const suppliedColumns = columns && /^"[a-z_]+"(?:,"[a-z_]+")*$/.test(columns)
          ? columns.split(",").map((key) => key.slice(1, -1)).sort() : [];
        const matchingColumns = !url.searchParams.has("columns") ||
          (suppliedColumns.length === expectedColumns.length && suppliedColumns.every((key, index) => key === expectedColumns[index]));
        return Array.isArray(payload) && payload.length === 1 && validFields(payload[0]) &&
          Number.isSafeInteger(payload[0].organization_id) && payload[0].organization_id > 0 &&
          Number.isSafeInteger(payload[0].academic_term_id) && payload[0].academic_term_id > 0 &&
          typeof payload[0].title === "string" && payload[0].title.trim().length > 0 &&
          matchingColumns && [...url.searchParams.keys()].every((key) => ["select", "columns"].includes(key)) &&
          url.searchParams.getAll("columns").length <= 1;
      }
      return false;
    }
    if (verb !== "POST") return false;
    if (["/rest/v1/rpc/kandid_get_admin_election_geofence", "/rest/v1/rpc/kandid_get_board_electorate_preview", "/rest/v1/rpc/kandid_get_election_turnout"].includes(path)) {
      const payload = parseBody(body);
      return hasOnlyKeys(payload, new Set(["p_election_id"])) && Number.isSafeInteger(payload.p_election_id) && payload.p_election_id > 0;
    }
    return SAFE_READ_RPC_PATHS.has(path.slice("/rest/v1/".length));
  }

  if (path === "/functions/v1/resolve-student-login" && verb === "POST") {
    const payload = parseBody(body);
    return payload?.action === "login" ||
      (allowStudentAccountSetup === true && isValidStudentSetupPayload(payload));
  }
  if (path === "/functions/v1/link-student-identity" && verb === "POST") {
    return allowStudentAccountSetup === true && isValidStudentIdentityLinkPayload(parseBody(body));
  }
  if (path === "/functions/v1/student-profile" && verb === "POST") {
    const payload = parseBody(body);
    if (payload?.action === "organization_member_count") {
      return hasOnlyKeys(payload, new Set(["action", "organization_id"])) && Number.isSafeInteger(payload.organization_id) && payload.organization_id > 0;
    }
    return Boolean(payload && ["profile", "organization_memberships"].includes(payload.action) && hasOnlyKeys(payload, new Set(["action"])));
  }
  if (path === "/functions/v1/student-notifications" && verb === "POST") {
    const payload = parseBody(body);
    return Boolean(payload && payload.action === "list" && hasOnlyKeys(payload, new Set(["action", "limit", "offset"])) &&
      (payload.limit === undefined || (Number.isInteger(payload.limit) && payload.limit > 0 && payload.limit <= 50)) &&
      (payload.offset === undefined || (Number.isInteger(payload.offset) && payload.offset >= 0 && payload.offset <= 10000)));
  }
  if (path === "/functions/v1/officers-contract" && verb === "POST" && !url.search) {
    const payload = parseBody(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    if (payload.action === "list") {
      return hasOnlyKeys(payload, new Set(["action"]));
    }
    if (payload.action === "incoming_leadership") {
      return hasOnlyKeys(payload, new Set(["action", "organization_id"])) &&
        Number.isSafeInteger(payload.organization_id) && payload.organization_id > 0;
    }
    return false;
  }
  if (path === "/functions/v1/organization-eligibility" && verb === "POST" && !url.search) {
    const payload = parseBody(body);
    return Boolean(payload && typeof payload === "object" && !Array.isArray(payload) &&
      payload.action === "eligible_students_for_organization" &&
      hasOnlyKeys(payload, new Set(["action", "organization_id"])) &&
      Number.isSafeInteger(payload.organization_id) && payload.organization_id > 0);
  }
  if (path === "/functions/v1/manage-election-removal" && verb === "POST") {
    const payload = parseBody(body);
    if (!payload) return false;
    if (payload.action === "review") {
      return hasOnlyKeys(payload, new Set(["action", "election_id"])) &&
        Number.isSafeInteger(payload.election_id) && payload.election_id > 0;
    }
    if (payload.action === "list_removed") {
      return hasOnlyKeys(payload, new Set(["action", "limit", "offset"])) &&
        (payload.limit === undefined || (Number.isInteger(payload.limit) && payload.limit > 0 && payload.limit <= 100)) &&
        (payload.offset === undefined || (Number.isInteger(payload.offset) && payload.offset >= 0 && payload.offset <= 10000));
    }
    if (!allowElectionSoftRemoval || !["soft_remove", "restore"].includes(payload.action)) return false;
    return hasOnlyKeys(payload, new Set(["action", "election_id", "password"])) &&
      Number.isSafeInteger(payload.election_id) && payload.election_id > 0 &&
      typeof payload.password === "string" && payload.password.length > 0 && payload.password.length <= 256;
  }
  if (path === "/functions/v1/board-manual-enrollment" && verb === "POST") {
    const payload = parseBody(body);
    if (!payload) return false;
    if (BOARD_REGISTRATION_ACTIONS.has(payload.action)) {
      return allowBoardStudentRegistration === true && isValidBoardRegistrationPayload(payload);
    }
    if (payload.action === "confirm_board_csv_import") {
      return allowBoardStudentRegistration === true &&
        hasOnlyKeys(payload, new Set(["action", "rows", "evidence_reviewed"])) &&
        payload.evidence_reviewed === true && isValidBoardCsvRows(payload.rows);
    }
    if (BOARD_MANAGEMENT_ACTIONS.has(payload.action)) {
      return allowBoardStudentManagement === true && isValidBoardManagementPayload(payload);
    }
    if (Object.hasOwn(PENDING_BOARD_STUDENT_WRITE_PERMISSIONS, payload.action)) {
      return PENDING_BOARD_STUDENT_WRITE_PERMISSIONS[payload.action] === true;
    }
    if (!SAFE_BOARD_MANUAL_ENROLLMENT_ACTIONS.has(payload.action)) return false;
    if (payload.action === "resolve_student_for_term") {
      return hasOnlyKeys(payload, new Set(["action", "student_number"])) &&
        typeof payload.student_number === "string";
    }
    if (payload.action === "preview_board_csv_import") {
      return hasOnlyKeys(payload, new Set(["action", "rows"])) && Array.isArray(payload.rows);
    }
    return hasOnlyKeys(payload, SAFE_BOARD_LIST_FIELDS);
  }
  if (path === "/functions/v1/vote-access" && verb === "POST") {
    const payload = parseBody(body);
      if (payload?.action === "election_dependency_summary" || payload?.action === "election_results") {
        return hasOnlyKeys(payload, new Set(["action", "election_id"])) &&
          Number.isSafeInteger(payload.election_id) && payload.election_id > 0;
      }
    return Boolean(payload && SAFE_VOTE_ACCESS_ACTIONS.has(payload.action));
  }

  return false;
}

export async function fetchDevelopmentProductionRequest(input, init, fetchImpl = globalThis.fetch, options = {}) {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const body = init?.body ?? (input instanceof Request ? input.body : null);
  const headers = init?.headers ?? (input instanceof Request ? input.headers : undefined);
  if (!isAllowedDevelopmentProductionRequest({ input, method, body, headers, ...options })) {
    throw new Error(DEVELOPMENT_PRODUCTION_WRITE_GUARD_MESSAGE);
  }
  return fetchImpl(input, init);
}

export const DEVELOPMENT_PRODUCTION_WRITE_GUARD_MESSAGE =
  "Blocked by the temporary official-production development write safeguard pending backend activation.";
