import { supabase } from "../lib/supabaseClient";
import { formatLocalDateTime as formatSharedLocalDateTime } from "./time";

export function formatLocalDateTime(value) {
  return formatSharedLocalDateTime(value, "-");
}

export function getElectionLocationLabel(election) {
  const label = String(election?.location_label || "").trim();
  if (label) return label;
  if (election?.voting_access_mode === "anywhere") return "Anywhere";
  return "Location not specified";
}

export function normalizeElectionDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function validateElectionSchedule(form, { requireCampaign = true } = {}) {
  const campaignStart = normalizeElectionDateTime(form?.campaign_start);
  const campaignEnd = normalizeElectionDateTime(form?.campaign_end);
  const votingStart = normalizeElectionDateTime(form?.start_date);
  const votingEnd = normalizeElectionDateTime(form?.end_date);
  const publishable = form?.status !== "draft" && form?.status !== "archived";

  if (!form?.title?.trim?.()) return "Election title is required.";
  if (!form?.organization_id && form?.organization_id !== 0) return "Organization is required.";

  if (requireCampaign && publishable && (!campaignStart || !campaignEnd)) {
    return "Campaign start and end are required before publishing an election.";
  }

  if (!votingStart || !votingEnd) {
    return "Voting start and end are required.";
  }

  if (votingEnd <= votingStart) {
    return "Voting end must be after voting start.";
  }

  if ((campaignStart && !campaignEnd) || (!campaignStart && campaignEnd)) {
    return "Campaign start and end must be completed together.";
  }

  if (campaignStart && campaignEnd) {
    if (campaignEnd <= campaignStart) {
      return "Campaign end must be after campaign start.";
    }

    if (campaignEnd > votingStart) {
      return "Campaign end must be before or equal to voting start.";
    }
  }

  if (
    form?.voting_access_mode === "location_range" &&
    (form?.geo_lat === "" || form?.geo_lng === "" || form?.geo_radius_meters === "")
  ) {
    return "Latitude, longitude, and radius are required for location-range voting.";
  }

  return "";
}

export function getElectionPhase(election, now = new Date()) {
  const campaignStart = election?.campaign_start
    ? new Date(election.campaign_start)
    : null;
  const campaignEnd = election?.campaign_end
    ? new Date(election.campaign_end)
    : null;
  const votingStart = election?.start_date ? new Date(election.start_date) : null;
  const votingEnd = election?.end_date ? new Date(election.end_date) : null;
  const status = election?.status || "draft";

  if (status === "draft") return "draft";
  if (status === "archived") return "archived";
  if (status === "closed") return "closed";

  if (
    campaignStart &&
    campaignEnd &&
    now < campaignStart
  ) {
    return "campaign_upcoming";
  }

  if (
    campaignStart &&
    campaignEnd &&
    now >= campaignStart &&
    now < campaignEnd
  ) {
    return "campaign";
  }

  if (
    campaignEnd &&
    votingStart &&
    now >= campaignEnd &&
    now < votingStart
  ) {
    return "waiting";
  }

  if (votingStart && votingEnd && now >= votingStart && now < votingEnd) {
    return "voting";
  }

  if (votingEnd && now >= votingEnd) {
    return "closed";
  }

  if (status === "active" && votingStart && now < votingStart) {
    return "scheduled";
  }

  return status;
}

export async function fetchAuthoritativeNow() {
  const { data, error } = await supabase.rpc("kandid_server_time");

  if (!error && data) {
    const serverNow = new Date(data);
    if (!Number.isNaN(serverNow.getTime())) return serverNow;
  }

  return new Date();
}

export function canStudentViewResults(election, now = new Date()) {
  if (!election) return false;

  if (election.results_released_at) {
    return true;
  }

  const phase = getElectionPhase(election, now);
  return election.student_result_visibility === "realtime" && phase === "voting";
}
