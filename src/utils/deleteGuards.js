import { supabase } from "../lib/supabaseClient";

async function countRows(table, column, value) {
  if (value == null) return 0;
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);

  if (error) {
    console.warn(`Dependency count failed for ${table}.${column}:`, error);
    return 0;
  }

  return count || 0;
}

async function getPositionIds(electionId) {
  const { data, error } = await supabase
    .from("positions")
    .select("id")
    .eq("election_id", electionId);
  if (error) return [];
  return (data || []).map((item) => item.id);
}

async function getCandidateIdsByPartylist(partylistId) {
  const { data, error } = await supabase
    .from("candidates")
    .select("id")
    .eq("partylist_id", partylistId);
  if (error) return [];
  return (data || []).map((item) => item.id);
}

async function getElectionPhaseCounts(electionId) {
  if (!electionId) return { votes: 0, tokens: 0 };
  const [votes, tokens] = await Promise.all([
    countRows("votes", "election_id", electionId),
    countRows("election_access_tokens", "election_id", electionId),
  ]);
  return { votes, tokens };
}

async function countRowsByFilters(table, filters = []) {
  let query = supabase
    .from(table)
    .select("id", { count: "exact", head: true });

  filters.forEach(([column, value]) => {
    query = query.eq(column, value);
  });

  const { count, error } = await query;

  if (error) {
    console.warn(`Dependency count failed for ${table}:`, error);
    return 0;
  }

  return count || 0;
}

async function getElectionIdsByOrganization(organizationId) {
  if (!organizationId) return [];
  const { data, error } = await supabase
    .from("elections")
    .select("id, status")
    .eq("organization_id", organizationId);

  if (error) return [];
  return data || [];
}

async function getPositionIdsByElections(electionIds = []) {
  if (electionIds.length === 0) return [];
  const { data, error } = await supabase
    .from("positions")
    .select("id")
    .in("election_id", electionIds);

  if (error) return [];
  return (data || []).map((item) => item.id).filter(Boolean);
}

export async function analyzeMembershipDependencies({ studentId, organizationId }) {
  const dependencies = [];
  let severity = "remove";
  let recommendation = "This organization membership can be removed after confirmation.";

  if (!studentId || !organizationId) {
    return { dependencies, blocked: false, severity, recommendation };
  }

  const elections = await getElectionIdsByOrganization(organizationId);
  const electionIds = elections.map((election) => election.id).filter(Boolean);
  const positionIds = await getPositionIdsByElections(electionIds);

  const [currentOfficers, pastOfficers, votes] = await Promise.all([
    countRowsByFilters("officers", [
      ["student_id", studentId],
      ["organization_id", organizationId],
      ["is_current", true],
    ]),
    countRowsByFilters("officers", [
      ["student_id", studentId],
      ["organization_id", organizationId],
      ["is_current", false],
    ]),
    electionIds.length
      ? supabase
          .from("votes")
          .select("id", { count: "exact", head: true })
          .eq("student_id", studentId)
          .in("election_id", electionIds)
          .then(({ count, error }) => {
            if (error) {
              console.warn("Membership vote dependency count failed:", error);
              return 0;
            }
            return count || 0;
          })
      : 0,
  ]);

  let candidates = 0;
  if (positionIds.length > 0) {
    const { count, error } = await supabase
      .from("candidates")
      .select("id", { count: "exact", head: true })
      .eq("student_id", studentId)
      .in("position_id", positionIds);
    candidates = error ? 0 : count || 0;
  }

  const activeElections = elections.filter((election) =>
    ["active", "ongoing", "open", "scheduled", "draft"].includes(
      String(election.status || "").toLowerCase(),
    ),
  ).length;

  [
    ["Current officer role", currentOfficers],
    ["Past officer history", pastOfficers],
    ["Candidate records", candidates],
    ["Vote records", votes],
    ["Active or upcoming elections", activeElections],
  ].forEach(([label, count]) => {
    if (count > 0) dependencies.push({ label, count });
  });

  if (votes > 0 || candidates > 0 || currentOfficers > 0 || pastOfficers > 0) {
    severity = "deactivate";
    recommendation =
      "This membership is connected to election or officer history. Preserve the relationship and use deactivation after the membership lifecycle migration is applied.";
  } else if (activeElections > 0) {
    severity = "warning";
    recommendation =
      "This organization has active or upcoming elections. Confirm the impact before removing access.";
  }

  return {
    dependencies,
    blocked: severity === "deactivate",
    severity,
    recommendation,
  };
}

export async function analyzeDeleteDependencies(entityType, entity) {
  const id = typeof entity === "object" ? entity?.id : entity;
  const dependencies = [];
  let severity = "delete";
  let recommendation = "This record can be deleted after confirmation.";

  if (!id) return { dependencies, blocked: false, severity, recommendation };

  if (entityType === "organization") {
    const [
      members,
      programMappings,
      elections,
      officers,
      boardUsers,
    ] = await Promise.all([
      countRows("student_organizations", "organization_id", id),
      countRows("organization_programs", "organization_id", id),
      countRows("elections", "organization_id", id),
      countRows("officers", "organization_id", id),
      countRows("admin_users", "organization_id", id),
    ]);

    [
      ["Student memberships", members],
      ["Program mappings", programMappings],
      ["Elections", elections],
      ["Officers", officers],
      ["Board/admin assignments", boardUsers],
    ].forEach(([label, count]) => {
      if (count > 0) dependencies.push({ label, count });
    });

    if (dependencies.length > 0) {
      severity = elections > 0 ? "archive" : "blocked";
      recommendation =
        elections > 0
          ? "This organization has election history. Archive or resolve related records before permanent deletion."
          : "Resolve these related records before deleting the organization.";
    }
  }

  if (entityType === "student") {
    const [memberships, candidates, officers, votes] = await Promise.all([
      countRows("student_organizations", "student_id", id),
      countRows("candidates", "student_id", id),
      countRows("officers", "student_id", id),
      countRows("votes", "student_id", id),
    ]);

    [
      ["Organization memberships", memberships],
      ["Candidate records", candidates],
      ["Officer records", officers],
      ["Vote records", votes],
    ].forEach(([label, count]) => {
      if (count > 0) dependencies.push({ label, count });
    });

    if (votes > 0 || candidates > 0 || officers > 0) {
      severity = "archive";
      recommendation =
        "This student is connected to election history. Disable the account or review related records instead of deleting voting history.";
    } else if (memberships > 0) {
      severity = "cleanup";
      recommendation =
        "Organization memberships can be removed first, then the student record can be deleted.";
    }
  }

  if (entityType === "election") {
    const positionIds = await getPositionIds(id);
    const [positions, partylists, eligibilityRules, votes, tokens] = await Promise.all([
      countRows("positions", "election_id", id),
      countRows("partylists", "election_id", id),
      countRows("eligibility_rules", "election_id", id),
      countRows("votes", "election_id", id),
      countRows("election_access_tokens", "election_id", id),
    ]);

    let candidates = 0;
    if (positionIds.length > 0) {
      const { count, error } = await supabase
        .from("candidates")
        .select("id", { count: "exact", head: true })
        .in("position_id", positionIds);
      candidates = error ? 0 : count || 0;
    }

    [
      ["Positions", positions],
      ["Candidates", candidates],
      ["Partylists", partylists],
      ["Eligibility rules", eligibilityRules],
      ["Votes", votes],
      ["Access tokens", tokens],
    ].forEach(([label, count]) => {
      if (count > 0) dependencies.push({ label, count });
    });

    if (votes > 0) {
      severity = "archive";
      recommendation =
        "This election contains voting records and should be archived instead of permanently deleted.";
    } else if (dependencies.length > 0) {
      severity = "blocked";
      recommendation =
        "Resolve the related setup records before deleting this election.";
    }
  }

  if (entityType === "position") {
    const [candidates, votes] = await Promise.all([
      countRows("candidates", "position_id", id),
      countRows("votes", "position_id", id),
    ]);
    if (candidates > 0) dependencies.push({ label: "Candidates", count: candidates });
    if (votes > 0) dependencies.push({ label: "Vote records", count: votes });
    if (dependencies.length > 0) {
      severity = votes > 0 ? "archive" : "blocked";
      recommendation =
        votes > 0
          ? "This position is connected to voting history and should not be permanently deleted."
          : "Review or disconnect the linked candidates before deleting this position.";
    }
  }

  if (entityType === "candidate") {
    const voteCount = await countRows("votes", "candidate_id", id);
    if (voteCount > 0) dependencies.push({ label: "Vote records", count: voteCount });

    if (voteCount > 0) {
      severity = "archive";
      recommendation =
        "This candidate is connected to voting history. Withdraw or disqualify the candidate if supported by your election rules, but keep the historical vote record intact.";
    }
  }

  if (entityType === "partylist") {
    const candidateIds = await getCandidateIdsByPartylist(id);
    const candidates = candidateIds.length;
    let votes = 0;

    if (candidateIds.length > 0) {
      const { count, error } = await supabase
        .from("votes")
        .select("id", { count: "exact", head: true })
        .in("candidate_id", candidateIds);
      votes = error ? 0 : count || 0;
    }

    if (candidates > 0) dependencies.push({ label: "Candidates", count: candidates });
    if (votes > 0) dependencies.push({ label: "Vote records", count: votes });

    if (votes > 0) {
      severity = "archive";
      recommendation =
        "This partylist is connected to voting history. Preserve it for results, receipts, and verification.";
    } else if (candidates > 0) {
      severity = "blocked";
      recommendation =
        "Detach or reassign linked candidates first, then delete the partylist.";
    }
  }

  if (entityType === "officer") {
    const isCurrent = Boolean(entity?.is_current);
    if (isCurrent) dependencies.push({ label: "Current officer assignment", count: 1 });
    if (entity?.student_id) dependencies.push({ label: "Linked student record", count: 1 });
    if (entity?.organization_id) dependencies.push({ label: "Organization history", count: 1 });

    if (isCurrent) {
      severity = "blocked";
      recommendation =
        "End the officer term by marking the record as previous and setting a term end date before deleting it.";
    } else if (dependencies.length > 0) {
      severity = "archive";
      recommendation =
        "This officer entry is historical organization data. Keep it unless it was created by mistake.";
    }
  }

  if (entityType === "eligibility_rule") {
    const { votes, tokens } = await getElectionPhaseCounts(entity?.election_id);
    if (votes > 0) dependencies.push({ label: "Election vote records", count: votes });
    if (tokens > 0) dependencies.push({ label: "Election access tokens", count: tokens });

    if (votes > 0) {
      severity = "archive";
      recommendation =
        "This rule belongs to an election with voting history. Keep it as part of the historical access configuration.";
    } else {
      severity = "delete";
      recommendation =
        "Deleting this rule changes who can vote in the election. Confirm only if the election setup should no longer use it.";
    }
  }

  if (entityType === "admin_user") {
    if (entity?.role === "super_admin") dependencies.push({ label: "System administrator access", count: 1 });
    if (entity?.role === "electoral_board") dependencies.push({ label: "Electoral board access", count: 1 });
    if (entity?.organization_id) dependencies.push({ label: "Assigned organization", count: 1 });

    severity = "security";
    recommendation =
      "Disable this account to remove access while preserving the access history. Permanently delete only if the account was created in error.";
  }

  if (entityType === "archived_election") {
    severity = "archive";
    recommendation =
      "Archived election records are historical records. Keep them for reporting and verification unless this archive entry was created incorrectly.";
  }

  return {
    dependencies,
    blocked: dependencies.length > 0 && severity !== "cleanup" && severity !== "security",
    severity,
    recommendation,
  };
}

export function dependencyMessage(entityLabel, analysis) {
  if (!analysis?.dependencies?.length) {
    return `${entityLabel} has no detected blocking dependencies. Confirm to delete permanently.`;
  }

  const lines = analysis.dependencies
    .map((item) => `${item.count} ${item.label}`)
    .join("\n");

  return `${entityLabel} cannot be safely deleted yet.\n\nRelated records:\n${lines}\n\n${analysis.recommendation}`;
}
