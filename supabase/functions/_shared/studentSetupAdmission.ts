// All setup entry points use the same service-only PostgreSQL admission contract.
// The database is authoritative; an API page length is never evidence of uniqueness.
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export type SetupStudent = {
  id: number; student_number: string; email: string; status: "pending" | "active";
  auth_user_id: string | null; full_name: string | null; program: string | null; year_level: number | null;
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
