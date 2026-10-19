const ANCHOR_STATUS_PRESENTATION = Object.freeze({
  pending: { label: "Pending", tone: "processing" },
  anchoring: { label: "Anchoring", tone: "processing" },
  submitted: { label: "Submitted", tone: "processing" },
  anchored: { label: "Anchored", tone: "anchored" },
  anchor_failed: { label: "Anchor failed", tone: "attention" },
  manual_review: { label: "Needs review", tone: "attention" },
});

export function ballotAnchorPresentation(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return ANCHOR_STATUS_PRESENTATION[normalized] || {
    label: normalized ? normalized.replaceAll("_", " ") : "Status unavailable",
    tone: "unknown",
  };
}
