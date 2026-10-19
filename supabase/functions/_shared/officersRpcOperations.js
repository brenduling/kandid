import { optionalPositiveId, positiveId } from "./idValidation.js";

export function buildOfficerRpcOperation(action, body) {
  switch (action) {
    case "winners":
      return {
        name: "kandid_get_officer_winners",
        args: {
          p_election_id: optionalPositiveId(body.election_id, "Election"),
          p_organization_id: body.organization_id
            ? positiveId(body.organization_id, "Organization")
            : null,
        },
      };
    case "finalize_results":
      return {
        name: "kandid_finalize_officer_results",
        args: { p_election_id: positiveId(body.election_id, "Election") },
      };
    case "update_service":
      return {
        name: "kandid_update_officer_service",
        args: { p_officer_id: positiveId(body.officer_id, "Officer"), p_changes: body.changes || {} },
      };
    case "delete":
      return {
        name: "kandid_delete_officer",
        args: { p_officer_id: positiveId(body.officer_id, "Officer") },
      };
    case "incoming_leadership":
      return {
        name: "kandid_get_incoming_leadership",
        args: { p_organization_id: body.organization_id ? positiveId(body.organization_id, "Organization") : null },
      };
    case "add_incoming_elected":
      return {
        name: "kandid_add_incoming_elected_officer",
        args: {
          p_organization_id: body.organization_id ? positiveId(body.organization_id, "Organization") : null,
          p_candidate_id: positiveId(body.candidate_id, "Candidate"),
          p_service: body.service || {},
        },
      };
    case "add_incoming_appointed":
      return {
        name: "kandid_add_incoming_appointed_officer",
        args: {
          p_organization_id: body.organization_id ? positiveId(body.organization_id, "Organization") : null,
          p_student_id: positiveId(body.student_id, "Student"),
          p_position_title: String(body.position_title || ""),
          p_service: body.service || {},
        },
      };
    case "add_current_officer":
      return {
        name: "kandid_add_current_officer",
        args: {
          p_organization_id: body.organization_id ? positiveId(body.organization_id, "Organization") : null,
          p_selection_type: String(body.selection_type || ""),
          p_student_id: body.student_id ? positiveId(body.student_id, "Student") : null,
          p_candidate_id: body.candidate_id ? positiveId(body.candidate_id, "Candidate") : null,
          p_position_title: String(body.position_title || ""),
          p_service: body.service || {},
          p_confirm_term_context: body.confirm_term_context === true,
        },
      };
    case "update_new_officer":
      return {
        name: "kandid_update_new_officer",
        args: {
          p_new_officer_id: positiveId(body.new_officer_id, "New officer"),
          p_organization_id: body.organization_id ? positiveId(body.organization_id, "Organization") : null,
          p_changes: body.changes || {},
        },
      };
    case "remove_new_officer":
      return {
        name: "kandid_remove_new_officer",
        args: {
          p_new_officer_id: positiveId(body.new_officer_id, "New officer"),
          p_organization_id: body.organization_id ? positiveId(body.organization_id, "Organization") : null,
        },
      };
    case "release_leadership":
      return {
        name: "kandid_release_officer_leadership",
        args: { p_organization_id: body.organization_id ? positiveId(body.organization_id, "Organization") : null },
      };
    default:
      return null;
  }
}
