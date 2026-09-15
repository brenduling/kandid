import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function parsePositiveInteger(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} is required.`);
  }
  return number;
}

function cleanText(value: unknown, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Server configuration is incomplete." }, 500);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization) {
    return jsonResponse({ error: "Authentication required." }, 401);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user?.id) {
    return jsonResponse({ error: "Invalid or expired session." }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  let electionId: number;
  try {
    electionId = parsePositiveInteger(body.election_id, "Election");
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Invalid receipt request." }, 400);
  }

  const requestedBallotId = cleanText(body.ballot_id, 80);
  if (requestedBallotId && !isUuid(requestedBallotId)) {
    return jsonResponse({ error: "Invalid receipt request." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: `Bearer ${serviceRoleKey}` } },
    auth: { persistSession: false },
  });

  const { data: studentRows, error: studentError } = await adminClient
    .from("students")
    .select("id, auth_user_id, status")
    .eq("auth_user_id", user.id)
    .limit(2);

  if (studentError) {
    console.error("[get-student-ballot-receipt] student lookup failed", {
      code: studentError.code || null,
      message: studentError.message || "Unknown database error.",
    });
    return jsonResponse({ error: "Unable to verify receipt access." }, 500);
  }

  if (!studentRows || studentRows.length !== 1) {
    return jsonResponse({ error: "Receipt access is not available for this account." }, 403);
  }

  const student = studentRows[0];
  if (student.auth_user_id !== user.id || student.status !== "active") {
    return jsonResponse({ error: "Receipt access is not available for this account." }, 403);
  }

  let ballotQuery = adminClient
    .from("vote_ballots")
    .select(`
      id,
      election_id,
      student_id,
      ballot_hash,
      hash_version,
      canonical_submitted_at,
      blockchain_anchor_status,
      blockchain_network,
      blockchain_tx_id,
      blockchain_block_number,
      blockchain_anchored_at,
      blockchain_contract_address
    `)
    .eq("student_id", Number(student.id))
    .eq("election_id", electionId);

  if (requestedBallotId) {
    ballotQuery = ballotQuery.eq("id", requestedBallotId);
  }

  const { data: ballots, error: ballotError } = await ballotQuery.limit(2);

  if (ballotError) {
    console.error("[get-student-ballot-receipt] ballot lookup failed", {
      code: ballotError.code || null,
      message: ballotError.message || "Unknown database error.",
    });
    return jsonResponse({ error: "Unable to load receipt verification details." }, 500);
  }

  if (!ballots || ballots.length === 0) {
    return jsonResponse({ data: { ballot: null } });
  }

  if (ballots.length !== 1) {
    console.error("[get-student-ballot-receipt] ambiguous ballot ownership result", {
      student_id: Number(student.id),
      election_id: electionId,
    });
    return jsonResponse({ error: "Receipt verification details need review." }, 409);
  }

  const ballot = ballots[0];
  if (Number(ballot.student_id) !== Number(student.id) || Number(ballot.election_id) !== electionId) {
    return jsonResponse({ error: "Receipt access is not available for this account." }, 403);
  }

  return jsonResponse({
    data: {
      ballot: {
        ballot_id: ballot.id,
        id: ballot.id,
        election_id: ballot.election_id,
        ballot_hash: ballot.ballot_hash,
        hash_version: ballot.hash_version,
        canonical_submitted_at: ballot.canonical_submitted_at,
        blockchain_anchor_status: ballot.blockchain_anchor_status,
        blockchain_network: ballot.blockchain_network,
        blockchain_tx_id: ballot.blockchain_tx_id,
        blockchain_block_number: ballot.blockchain_block_number,
        blockchain_anchored_at: ballot.blockchain_anchored_at,
        blockchain_contract_address: ballot.blockchain_contract_address,
      },
    },
  });
});
