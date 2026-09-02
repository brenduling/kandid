import { supabase } from "../lib/supabaseClient";
import { normalizeProgram, selectActiveMemberships } from "./organizationAccess";
import { yearLevelLabel } from "./results";

function isMissingSchemaError(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");

  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST205" ||
    message.includes("could not find the table") ||
    message.includes("could not find a relationship") ||
    message.includes("schema cache")
  );
}

function addProgram(target, value) {
  const normalized = normalizeProgram(value);
  if (!normalized) return;
  if (!target.has(normalized)) {
    target.set(normalized, { code: normalized, label: normalized, name: "" });
  }
}

function addYearLevel(target, value) {
  const label = yearLevelLabel(value);
  if (!label) return;
  target.set(label.toUpperCase(), label);
}

function addYearRange(target, min, max) {
  const minYear = Number(min);
  const maxYear = Number(max);

  if (!Number.isFinite(minYear) || !Number.isFinite(maxYear)) return;

  const start = Math.max(1, Math.min(minYear, maxYear));
  const end = Math.max(start, Math.max(minYear, maxYear));

  for (let year = start; year <= end; year += 1) {
    addYearLevel(target, year);
  }
}

function sortYearLevels(first, second) {
  const firstYear = Number(String(first).match(/\d+/)?.[0] || 0);
  const secondYear = Number(String(second).match(/\d+/)?.[0] || 0);
  return firstYear - secondYear || String(first).localeCompare(String(second));
}

async function fetchOrganizationPrograms(organizationId) {
  if (!organizationId) return [];

  const { data, error } = await supabase
    .from("organization_programs")
    .select("programs(id, code, name)")
    .eq("organization_id", organizationId);

  if (error) {
    if (!isMissingSchemaError(error)) {
      console.warn("Result program coverage lookup failed:", error.message);
    }
    return [];
  }

  return data || [];
}

function programKey(program) {
  return normalizeProgram(program?.code || program?.name || program?.label || program);
}

async function fetchEligibilityRules(electionId) {
  if (!electionId) return [];

  const { data, error } = await supabase
    .from("eligibility_rules")
    .select("program, min_year_level, max_year_level, allow_shs")
    .eq("election_id", electionId);

  if (error) {
    if (!isMissingSchemaError(error)) {
      console.warn("Result eligibility lookup failed:", error.message);
    }
    return [];
  }

  return data || [];
}

async function fetchMembershipDemographics(organizationId) {
  if (!organizationId) return [];

  const { data, error } = await selectActiveMemberships(
    `
      students (
        program,
        year_level,
        is_shs
      )
    `,
    [["organization_id", organizationId]],
  );

  if (error) {
    console.warn("Result membership demographic lookup failed:", error.message);
    return [];
  }

  return data || [];
}

export async function fetchResultDimensions(election) {
  if (!election?.id || !election?.organization_id) {
    return { programs: [], yearLevels: [] };
  }

  const [programLinks, eligibilityRules, memberships] = await Promise.all([
    fetchOrganizationPrograms(election.organization_id),
    fetchEligibilityRules(election.id),
    fetchMembershipDemographics(election.organization_id),
  ]);

  const programs = new Map();
  const yearLevels = new Map();

  eligibilityRules.forEach((rule) => {
    addProgram(programs, rule.program);
    addYearRange(yearLevels, rule.min_year_level, rule.max_year_level);
    if (rule.allow_shs) {
      addYearLevel(yearLevels, 11);
      addYearLevel(yearLevels, 12);
    }
  });

  programLinks.forEach((link) => {
    addProgram(programs, link.programs?.code || link.programs?.name);
    const key = programKey(link.programs);
    programs.set(key, {
      ...programs.get(key),
      code: link.programs?.code || programs.get(key).code,
      label: link.programs?.code || programs.get(key).label,
      name: link.programs?.name || programs.get(key).name,
    });
  });

  memberships.forEach((membership) => {
    addProgram(programs, membership.students?.program);
    addYearLevel(yearLevels, membership.students?.year_level);
  });

  const programDetails = [...programs.values()]
    .sort((first, second) => String(first.label).localeCompare(String(second.label)));

  return {
    programs: programDetails,
    yearLevels: [...yearLevels.values()].sort(sortYearLevels),
  };
}
