import { supabase } from "../lib/supabaseClient";
import { officersContract } from "./officersContract";
import { listAdminUsers } from "./adminUsers";
import { getVoteDependencyCount } from "./voteAccess";
import { loadAdminCandidates } from "./adminCandidates";
import { isAutomaticVoterEligibilityEnabled } from "./automaticVoterEligibility";

async function countVoteRecords(entityType, id, context) {
  const { count, error } = await getVoteDependencyCount(entityType, id, context);
  if (error) {
    console.warn(`Vote dependency count failed for ${entityType}:`, error);
    // Fail closed: an unavailable trusted count must never make a destructive
    // dependency check look clear.
    return 1;
  }
  return count;
}

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
    countVoteRecords("election", electionId),
    countRows("election_access_tokens", "election_id", electionId),
  ]);
  return { votes, tokens };
}

async function countAdminUsersByOrganization(organizationId) {
  const { data, error } = await listAdminUsers();
  if (error) {
    console.warn("Admin user dependency count failed:", error);
    return 0;
  }

  return (data || []).filter(
    (admin) => Number(admin.organization_id) === Number(organizationId),
  ).length;
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

  const [officerCounts, votes] = await Promise.all([
    officersContract("student_counts", { student_id: studentId, organization_id: organizationId })
      .catch((error) => {
        console.warn("Officer membership dependency count failed:", error);
        return { current: 0, previous: 0 };
      }),
    electionIds.length
      ? countVoteRecords("student_in_organization", studentId, { organization_id: organizationId })
      : 0,
  ]);
  const currentOfficers = officerCounts.current || 0;
  const pastOfficers = officerCounts.previous || 0;

  let candidates = 0;
  if (positionIds.length > 0) {
    const { data, error } = await loadAdminCandidates({
      electionIds,
      studentIds: [studentId],
    });
    candidates = error ? 1 : (data || []).filter((candidate) => positionIds.includes(candidate.position_id)).length;
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

/**
 * Legacy client-side advisory checks used by Candidates, Elections, Eligibility
 * Rules, Officers, Partylists, Positions, Students, Users/Roles, and Archives.
 * Organization deletion uses the trusted database readiness/delete RPCs instead;
 * these client counts can fail open and are not an authorization boundary.
 */
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
      countRows("officer_directory", "organization_id", id),
      countAdminUsersByOrganization(id),
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
    const [memberships, candidates, officerCounts, votes] = await Promise.all([
      countRows("student_organizations", "student_id", id),
      loadAdminCandidates({ studentIds: [id] }).then(({ data, error }) => {
        if (error) {
          console.warn("Candidate dependency count failed:", error);
          return 1;
        }
        return (data || []).length;
      }),
      officersContract("student_counts", { student_id: id }).catch((error) => {
        console.warn("Officer student dependency count failed:", error);
        return { total: 0 };
      }),
      countVoteRecords("student", id),
    ]);
    const officers = officerCounts.total || 0;

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
    /* Partylists are deliberately absent from this list. They are
       organization-level and are no longer owned by an election, so their
       existence must not block an election deletion. */
    const [positions, eligibilityRules, votes, tokens] = await Promise.all([
      countRows("positions", "election_id", id),
      countRows("eligibility_rules", "election_id", id),
      countVoteRecords("election", id),
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
      countVoteRecords("position", id),
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
    const voteCount = await countVoteRecords("candidate", id);
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
      votes = await countVoteRecords("partylist", id);
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
        "This rule belongs to an election with voting history. Keep it as part of the historical declared audience.";
    } else {
      severity = "delete";
      recommendation =
        isAutomaticVoterEligibilityEnabled(import.meta.env)
          ? "Deleting this rule removes an additional voting restriction. Verified organization membership and term enrollment still apply. Rules cannot be changed after a recorded vote or an existing electorate freeze."
          : "Deleting this rule removes its declared audience metadata. Enrollment, organization participation and the locked electorate continue to determine voting access.";
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
