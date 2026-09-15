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

function cleanText(value: unknown, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

function parsePositiveInteger(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label} is required.`);
  }
  return number;
}

function parseScheduleWallClock(value: unknown) {
  if (!value) return null;
  const match = String(value).trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/,
  );

  if (!match) {
    const fallback = new Date(String(value));
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  const [, year, month, day, hour = "00", minute = "00", second = "00"] = match;
  return new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 8,
    Number(minute),
    Number(second),
  ));
}

function getElectionPhase(election: Record<string, unknown>, now = new Date()) {
  const campaignStart = election?.campaign_start ? parseScheduleWallClock(election.campaign_start) : null;
  const campaignEnd = election?.campaign_end ? parseScheduleWallClock(election.campaign_end) : null;
  const votingStart = election?.start_date ? parseScheduleWallClock(election.start_date) : null;
  const votingEnd = election?.end_date ? parseScheduleWallClock(election.end_date) : null;
  const status = cleanText(election?.status, 40) || "draft";

  if (status === "draft") return "draft";
  if (status === "archived") return "archived";
  if (status === "closed") return "closed";
  if (campaignStart && campaignEnd && now < campaignStart) return "campaign_upcoming";
  if (campaignStart && campaignEnd && now >= campaignStart && now < campaignEnd) return "campaign";
  if (campaignEnd && votingStart && now >= campaignEnd && now < votingStart) return "waiting";
  if (votingStart && votingEnd && now >= votingStart && now < votingEnd) return "voting";
  if (votingEnd && now >= votingEnd) return "closed";
  if (status === "active" && votingStart && now < votingStart) return "scheduled";
  return status;
}

function normalizeSelectedVotes(selectedVotes: unknown) {
  if (!selectedVotes || typeof selectedVotes !== "object") {
    throw new Error("Ballot selections are required.");
  }

  return Object.values(selectedVotes as Record<string, Record<string, unknown>>).flatMap((vote) => {
    const positionId = parsePositiveInteger(vote.position_id, "Position");
    if (vote.is_abstain) {
      return [{
        position_id: positionId,
        candidate_id: null,
        is_abstain: true,
      }];
    }

    const candidateIds = Array.isArray(vote.candidate_ids)
      ? vote.candidate_ids
      : vote.candidate_id
        ? [vote.candidate_id]
        : [];

    return candidateIds.map((candidateId) => ({
      position_id: positionId,
      candidate_id: parsePositiveInteger(candidateId, "Candidate"),
      is_abstain: false,
    }));
  });
}

function safelyLogBackgroundNudgeFailure(
  error: unknown,
  context: Record<string, unknown>,
) {
  console.error("Ballot anchor background nudge failed:", {
    ...context,
    error: error instanceof Error ? error.message : String(error || "Unknown error."),
  });
}

async function nudgeBallotAnchorWorker(
  supabaseUrl: string,
  anonKey: string,
  workerToken: string,
  context: Record<string, unknown>,
) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/anchor-ballot-hashes`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        "Content-Type": "application/json",
        "x-anchor-worker-token": workerToken,
      },
      body: JSON.stringify({
        source: "submit-vote",
      }),
    });

    if (!response.ok) {
      console.error("Ballot anchor background nudge returned non-success status:", {
        ...context,
        status: response.status,
      });
      return;
    }

    console.log("Ballot anchor background nudge accepted:", {
      ...context,
      status: response.status,
    });
  } catch (error) {
    safelyLogBackgroundNudgeFailure(error, context);
  }
}

function scheduleBallotAnchorNudge(
  supabaseUrl: string,
  context: Record<string, unknown>,
) {
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const workerToken = Deno.env.get("ANCHOR_WORKER_TOKEN");

  if (!anonKey || !workerToken) {
    console.warn("Ballot anchor background nudge skipped: worker configuration is incomplete.", context);
    return;
  }

  const task = nudgeBallotAnchorWorker(supabaseUrl, anonKey, workerToken, context);
  const edgeRuntime = (
    globalThis as typeof globalThis & {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
    }
  ).EdgeRuntime;

  if (typeof edgeRuntime?.waitUntil === "function") {
    edgeRuntime.waitUntil(task);
    return;
  }

  task.catch((error) => safelyLogBackgroundNudgeFailure(error, context));
  console.warn("Ballot anchor background nudge scheduled without EdgeRuntime.waitUntil support.", context);
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
    return jsonResponse({ error: "Your session has expired. Please sign in again." }, 401);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const {
    data: { user: authUser },
    error: authError,
  } = await authClient.auth.getUser();

  if (authError || !authUser?.id) {
    return jsonResponse({ error: "Your session has expired. Please sign in again." }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  let electionId: number;
  let normalizedVotes: Array<{ position_id: number; candidate_id: number | null; is_abstain: boolean }>;

  try {
    electionId = parsePositiveInteger(body.election_id, "Election");
    normalizedVotes = normalizeSelectedVotes(body.selected_votes);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Invalid ballot." }, 400);
  }

  if (normalizedVotes.length === 0) {
    return jsonResponse({ error: "Ballot selections are required." }, 400);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data: student, error: studentError } = await adminClient
    .from("students")
    .select("id, auth_user_id, student_number, first_name, last_name, status")
    .eq("auth_user_id", authUser.id)
    .maybeSingle();

  if (studentError || !student) {
    return jsonResponse({ error: "Your student account is not allowed to submit this ballot." }, 403);
  }

  if (student.auth_user_id !== authUser.id || student.status !== "active") {
    return jsonResponse({ error: "Your student account is not allowed to submit this ballot." }, 403);
  }

  const { data: election, error: electionError } = await adminClient
    .from("elections")
    .select("id, organization_id, status, campaign_start, campaign_end, start_date, end_date")
    .eq("id", electionId)
    .single();

  if (electionError || !election?.organization_id) {
    console.error("ELECTION_VERIFY_FAILED", {
      electionId,
      election,
      error: electionError
        ? {
          message: electionError.message,
          code: electionError.code,
          details: electionError.details,
          hint: electionError.hint,
        }
        : null,
    });

    return jsonResponse({ error: "Election could not be verified." }, 404);
  }

  if (getElectionPhase(election, new Date()) !== "voting") {
    return jsonResponse({ error: "Voting is not open for this election right now." }, 409);
  }

  const { data: activeTerm, error: termError } = await adminClient
    .from("academic_terms")
    .select("id")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (termError || !activeTerm?.id) {
    return jsonResponse({ error: "Active academic term could not be verified." }, 409);
  }

  const { data: participationRows, error: participationError } = await adminClient.rpc(
    "resolve_student_organization_participation",
    {
      target_student_id: Number(student.id),
      target_organization_id: Number(election.organization_id),
      target_academic_term_id: Number(activeTerm.id),
    },
  );

  const participation = Array.isArray(participationRows)
    ? participationRows[0]
    : participationRows;

  if (participationError || participation?.allowed !== true) {
    return jsonResponse({ error: "This student is not eligible for this election." }, 403);
  }

  const { data: positions, error: positionError } = await adminClient
    .from("positions")
    .select("id, max_votes")
    .eq("election_id", electionId);

  if (positionError) {
    return jsonResponse({ error: "Unable to verify ballot positions." }, 500);
  }

  const positionById = new Map((positions || []).map((position) => [Number(position.id), position]));
  if (positionById.size === 0) {
    return jsonResponse({ error: "No ballot positions found for this election." }, 400);
  }

  const votesByPosition = new Map<number, Array<{ position_id: number; candidate_id: number | null; is_abstain: boolean }>>();
  normalizedVotes.forEach((vote) => {
    const current = votesByPosition.get(vote.position_id) || [];
    current.push(vote);
    votesByPosition.set(vote.position_id, current);
  });

  if (votesByPosition.size !== positionById.size) {
    return jsonResponse({ error: "Please select a vote or abstain for every position." }, 400);
  }

  for (const [positionId, votes] of votesByPosition.entries()) {
    const position = positionById.get(positionId);
    if (!position) {
      return jsonResponse({ error: "Ballot includes a position that does not belong to this election." }, 400);
    }

    const abstainCount = votes.filter((vote) => vote.is_abstain).length;
    const candidateVotes = votes.filter((vote) => !vote.is_abstain);
    const maxVotes = Math.max(Number(position.max_votes || 1), 1);

    if (abstainCount > 0 && votes.length > 1) {
      return jsonResponse({ error: "Abstain cannot be combined with candidate selections." }, 400);
    }

    if (abstainCount === 0 && candidateVotes.length === 0) {
      return jsonResponse({ error: "Please select a candidate or abstain for every position." }, 400);
    }

    if (candidateVotes.length > maxVotes) {
      return jsonResponse({ error: "A position has more selected candidates than allowed." }, 400);
    }
  }

  const candidateIds = normalizedVotes
    .map((vote) => vote.candidate_id)
    .filter((candidateId): candidateId is number => Number.isInteger(candidateId));

  if (candidateIds.length > 0) {
    const { data: candidates, error: candidateError } = await adminClient
      .from("candidates")
      .select("id, position_id")
      .in("id", candidateIds);

    if (candidateError) {
      return jsonResponse({ error: "Unable to verify ballot candidates." }, 500);
    }

    const candidateById = new Map((candidates || []).map((candidate) => [Number(candidate.id), candidate]));
    for (const vote of normalizedVotes) {
      if (vote.candidate_id == null) continue;
      const candidate = candidateById.get(Number(vote.candidate_id));
      if (!candidate || Number(candidate.position_id) !== Number(vote.position_id)) {
        return jsonResponse({ error: "Ballot includes a candidate that does not belong to the selected position." }, 400);
      }
    }
  }

  const { data: insertedVotes, error: insertError } = await adminClient.rpc(
    "insert_v2_vote_rows",
    {
      p_student_id: Number(student.id),
      p_election_id: electionId,
      p_votes: normalizedVotes,
    },
  );

  if (insertError) {
    const message = String(insertError.message || "");

    if (message.includes("This student has already voted in this election.")) {
      return jsonResponse(
        {
          error: "This student has already voted in this election.",
          already_voted: true,
        },
        409,
      );
    }

    console.error("V2 vote insertion failed:", insertError);
    return jsonResponse({ error: "Vote could not be recorded." }, 500);
  }

  const createdVotes = Array.isArray(insertedVotes) ? insertedVotes : [];

  if (createdVotes.length === 0) {
    console.error("V2 vote insertion returned no rows.");
    return jsonResponse({ error: "Vote could not be recorded." }, 500);
  }

  const submittedAt = String(
    createdVotes[0]?.canonical_vote_timestamp || "",
  );
  const ballotId = typeof createdVotes[0]?.ballot_id === "string"
    ? createdVotes[0].ballot_id
    : null;

  const responseBody = {
    data: {
      submitted_at: submittedAt,
      vote_count: createdVotes.length,
      ballot_id: ballotId,
    },
  };

  scheduleBallotAnchorNudge(supabaseUrl, {
    ballot_id: ballotId,
    election_id: electionId,
    vote_count: createdVotes.length,
  });

  return jsonResponse(responseBody);
});
