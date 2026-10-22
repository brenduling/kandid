import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";
import { corsHeaders, handleCorsPreflight, rejectDisallowedOrigin, serveWithKandidCors } from "../_shared/kandidProductionSecurity.mjs";
import { setupRpc, setupTokenHash } from "../_shared/studentSetupAdmission.ts";

const reply = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const denied = () => reply({ error: "Student identity could not be linked." }, 403);
const uncertain = () => reply({ code: "setup_recovery_required", error: "Setup could not be confirmed. Contact the Electoral Board before retrying." }, 409);
const email = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
async function boundedBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.body || Number(request.headers.get("content-length")) > 8192) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > 8192) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  try {
    const data = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch { return null; }
}

serveWithKandidCors(async (request: Request) => {
  const preflight = handleCorsPreflight(request); if (preflight) return preflight;
  const originError = rejectDisallowedOrigin(request); if (originError) return originError;
  if (request.method !== "POST") return reply({error:"Method not allowed."},405);
  if (Deno.env.get("STUDENT_SETUP_SECURITY_ENABLED") !== "true") return reply({error:"Student setup is unavailable."},503);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply({error:"Student setup is unavailable."},503);
  const authorization = request.headers.get("Authorization");
  if (!authorization) return reply({error:"Authentication required."},401);
  const auth = createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:identity,error:identityError} = await auth.auth.getUser();
  const user = identity?.user;
  if (identityError || !user?.id || !user.email_confirmed_at || !email(user.email)) return denied();
  const body = await boundedBody(request);
  if (!body || Object.keys(body).some(key=>!["student_number","setup_mode","password","setup_token"].includes(key))) return denied();
  const number = typeof body.student_number === "string" ? body.student_number.trim() : "";
  const password = body.password, token = body.setup_token;
  if (!/^[0-9]{1,20}$/.test(number) || body.setup_mode !== true || typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token) ||
      typeof password !== "string" || password.length < 6 || password.length > 256 ||
      !/[A-Za-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) return denied();
  const admin = createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const args = {p_student_number:number,p_auth_user_id:user.id,p_expected_email:email(user.email),p_proof_hash:await setupTokenHash(token)};
  let claimed;
  try { claimed = await setupRpc(admin,"kandid_student_setup_claim_v1",args); }
  catch { return reply({error:"Student setup is temporarily unavailable."},503); }
  if (!claimed || !Number.isSafeInteger(claimed.id) || claimed.student_number !== number ||
      email(claimed.email) !== email(user.email) || !["pending","active"].includes(String(claimed.status)) ||
      claimed.auth_user_id != null) return denied();
  // Exactly one proof can claim this Student before reaching Auth. Never release
  // an uncertain attempt automatically: a timeout may conceal a password write.
  try {
    const response = await fetch(`${url}/auth/v1/user`,{
      method:"PUT",headers:{Authorization:authorization,apikey:anon,"Content-Type":"application/json"},
      body:JSON.stringify({password}),signal:AbortSignal.timeout(10000),
    });
    const updated = await response.json().catch(()=>null);
    if (!response.ok || updated?.id !== user.id || email(updated.email) !== email(user.email) || !updated.email_confirmed_at) {
      console.warn("[student-setup] password_result_unconfirmed"); return uncertain();
    }
  } catch { console.warn("[student-setup] password_request_uncertain"); return uncertain(); }
  let linked;
  try { linked = await setupRpc(admin,"kandid_student_setup_finish_v1",args); }
  catch { console.warn("[student-setup] finalization_unavailable"); return uncertain(); }
  if (!linked || linked.student_number !== number || linked.status !== "active" || !linked.id) {
    console.warn("[student-setup] finalization_rejected"); return uncertain();
  }
  return reply({linked:true,student:{id:linked.id,student_number:linked.student_number,status:linked.status}});
});
