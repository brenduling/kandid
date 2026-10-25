// All setup entry points use the same service-only PostgreSQL admission contract.
// The database is authoritative; an API page length is never evidence of uniqueness.
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export type SetupStudent = {
  id: number; student_number: string; email: string; status: "pending" | "active";
  auth_user_id: string | null; full_name: string | null; program: string | null; year_level: number | null;
  first_name?: string | null; last_name?: string | null;
};
export async function setupRpc(client: RpcClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error || (data !== null && (typeof data !== "object" || Array.isArray(data)))) {
    throw new Error("Setup admission unavailable");
  }
  return data as Record<string, unknown> | null;
}
export async function setupAdmission(client: RpcClient, number: string, user?: { id: string; email?: string }) {
  const data = await setupRpc(client, "kandid_student_setup_admission_v1", {
    p_student_number: number, p_auth_user_id: user?.id || null, p_expected_email: user?.email || null,
  });
  return data as SetupStudent | null;
}
export async function setupTokenHash(token: string) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(hash, byte => byte.toString(16).padStart(2,"0")).join("");
}
export function newSetupToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2,"0")).join("");
}
export function setupDetails(record: SetupStudent) {
  return { full_name: record.full_name, program: record.program, year_level: record.year_level };
}
// Pre-OTP recognition masking, applied server-side only. The result must never
// contain a complete name part: at most the first two characters of the first
// name and the first character of the last name are visible, every name part
// keeps at least three mask bullets, and a one-character part is never shown.
function maskNamePart(value: unknown, preferredVisible: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  const chars = [...normalized];
  if (chars.length === 1) return "••••";
  const visible = chars.length <= 3 ? 1 : Math.min(preferredVisible, chars.length - 1);
  return chars.slice(0, visible).join("") + "•".repeat(Math.max(chars.length - visible, 3));
}
export function maskedSetupRecognition(record: SetupStudent) {
  let firstName = typeof record.first_name === "string" ? record.first_name : null;
  let lastName = typeof record.last_name === "string" ? record.last_name : null;
  if (firstName === null && lastName === null && typeof record.full_name === "string") {
    // Compatibility with admission records that expose only the combined name.
    const tokens = record.full_name.trim().split(/\s+/).filter(Boolean);
    firstName = tokens[0] || null;
    lastName = tokens.length > 1 ? tokens[tokens.length - 1] : null;
  }
  return {
    masked_first_name: maskNamePart(firstName, 2),
    masked_last_name: maskNamePart(lastName, 1),
    program: record.program,
    year_level: record.year_level,
  };
}
