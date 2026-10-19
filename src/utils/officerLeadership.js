export function getIncomingStudentAvailability(studentId, incoming) {
  const id = String(studentId);
  const staged = (incoming?.new_officers || []).find((person) => String(person.student_id) === id);
  if (staged) {
    const type = staged.selection_type === "elected" ? "Elected" : "Appointed";
    return { available: false, reason: `${type} · ${staged.position_title} · Already added` };
  }

  return { available: true, reason: "Eligible" };
}

export function normalizeOfficerPosition(positionTitle) {
  return String(positionTitle || "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

function normalizeOfficerPositionForSort(positionTitle) {
  return String(positionTitle || "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en")
    .replace(/[.]/gu, "")
    .replace(/[-‐‑‒–—]/gu, " ")
    .replace(/\s+/gu, " ");
}

const officerPositionRanks = new Map([
  ["president", 100],
  ["vice president", 200],
  ["secretary", 300],
  ["treasurer", 400],
  ["auditor", 500],
  ["pro", 600],
  ["public relations officer", 600],
  ["business manager", 700],
]);

const positionOrderFields = ["position_display_order", "position_order", "sort_order"];

function getExplicitPositionOrder(officer) {
  const value = positionOrderFields
    .map((field) => officer?.[field] ?? officer?.position?.[field])
    .find((candidate) => candidate !== null && candidate !== undefined && candidate !== "");
  const nestedValue = officer?.position?.display_order
    ?? officer?.election_position?.display_order
    ?? officer?.positions?.display_order;
  const order = Number(value ?? nestedValue);
  return Number.isFinite(order) ? order : null;
}

function getOfficerPositionRank(positionTitle) {
  const normalized = normalizeOfficerPositionForSort(positionTitle);
  const standardRank = officerPositionRanks.get(normalized);
  if (standardRank !== undefined) return { group: 0, rank: standardRank, year: 0 };

  const representative = normalized.match(/^(?:(\d+)(?:st|nd|rd|th)|(first|second|third|fourth)) year representatives?$/u);
  if (representative) {
    const namedYear = { first: 1, second: 2, third: 3, fourth: 4 }[representative[2]];
    const year = Number(representative[1] || namedYear);
    if (year > 0) return { group: 2, rank: 0, year };
  }
  if (/^representatives?$/u.test(normalized)) return { group: 3, rank: 0, year: 0 };

  return { group: 1, rank: 0, year: 0 };
}

function officerNameForSort(officer) {
  const studentName = officer?.student_name
    || [officer?.students?.first_name, officer?.students?.last_name].filter(Boolean).join(" ");
  return String(studentName || officer?.officer_name || "").trim();
}

function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Return a copy of an officer roster sorted for display. Election position
 * order is used when every row carries an explicit position-order value;
 * otherwise use the shared Kandid hierarchy. `officers.display_order` is not
 * used because it orders officer records, not the linked election positions.
 */
export function sortOfficerRoster(records = []) {
  const rows = Array.isArray(records) ? records : [];
  const hasCompletePositionOrder = rows.length > 0
    && rows.every((officer) => getExplicitPositionOrder(officer) !== null);

  return rows
    .map((officer, originalIndex) => ({ officer, originalIndex }))
    .sort((left, right) => {
      const a = left.officer;
      const b = right.officer;
      const organizationOrder = compareText(a?.organization_id, b?.organization_id);
      if (organizationOrder) return organizationOrder;

      if (hasCompletePositionOrder) {
        const explicitOrder = getExplicitPositionOrder(a) - getExplicitPositionOrder(b);
        if (explicitOrder) return explicitOrder;
      }

      const aRank = getOfficerPositionRank(a?.position_title);
      const bRank = getOfficerPositionRank(b?.position_title);
      const hierarchyOrder = aRank.group - bRank.group
        || aRank.rank - bRank.rank
        || aRank.year - bRank.year;
      if (hierarchyOrder) return hierarchyOrder;

      const titleOrder = compareText(normalizeOfficerPositionForSort(a?.position_title), normalizeOfficerPositionForSort(b?.position_title));
      if (titleOrder) return titleOrder;

      const nameOrder = compareText(officerNameForSort(a), officerNameForSort(b));
      if (nameOrder) return nameOrder;

      const idOrder = compareText(a?.id, b?.id);
      return idOrder || left.originalIndex - right.originalIndex;
    })
    .map(({ officer }) => officer);
}

export function getIncomingPositionConflict(positionTitle, incoming, excludeOfficerId = null) {
  const normalizedTitle = normalizeOfficerPosition(positionTitle);
  if (!normalizedTitle) return null;

  const conflict = (incoming?.new_officers || []).find((officer) =>
    String(officer.id) !== String(excludeOfficerId ?? "")
      && normalizeOfficerPosition(officer.position_title) === normalizedTitle
  );
  if (!conflict) return null;
  const positionLabel = String(conflict.position_title || "").trim().replace(/\s+/gu, " ");

  return {
    officer: conflict,
    message: `${positionLabel} is already assigned to ${conflict.student_name || "another student"} as ${conflict.selection_type === "elected" ? "an Elected" : "an Appointed"} officer. Remove or change that assignment before continuing.`,
  };
}

export function getIncomingWinnerPositionConflict(winner, incoming) {
  const sameStudent = (incoming?.new_officers || []).find((officer) =>
    String(officer.student_id) === String(winner?.student_id)
  );
  if (sameStudent && !(sameStudent.selection_type === "elected"
      && String(sameStudent.candidate_id) === String(winner?.candidate_id))) {
    return {
      officer: sameStudent,
      message: `${sameStudent.student_name || "This student"} is already assigned ${sameStudent.position_title} as ${sameStudent.selection_type === "elected" ? "an Elected" : "an Appointed"} officer. Remove that assignment before adding this winner.`,
    };
  }

  const conflict = getIncomingPositionConflict(winner?.position_title, incoming);
  const sameElectedWinner = conflict?.officer.selection_type === "elected"
    && String(conflict.officer.student_id) === String(winner?.student_id)
    && String(conflict.officer.candidate_id) === String(winner?.candidate_id);
  return sameElectedWinner ? null : conflict;
}

function officerDisplayName(officer) {
  return officer?.student_name
    || [officer?.students?.first_name, officer?.students?.last_name].filter(Boolean).join(" ").trim()
    || officer?.officer_name
    || "Another officer";
}

export function formatOfficerPositionTitle(positionTitle) {
  const normalized = normalizeOfficerPositionForSort(positionTitle);
  const standardTitles = new Map([
    ["president", "President"],
    ["vice president", "Vice President"],
    ["secretary", "Secretary"],
    ["treasurer", "Treasurer"],
    ["auditor", "Auditor"],
    ["pio", "PIO"],
    ["public information officer", "PIO"],
    ["pro", "Public Relations Officer"],
    ["public relations officer", "Public Relations Officer"],
    ["business manager", "Business Manager"],
    ["representative", "Representative"],
    ["representatives", "Representatives"],
  ]);
  const standardTitle = standardTitles.get(normalized);
  if (standardTitle) return standardTitle;
  const yearRepresentative = normalized.match(/^(\d+)(?:st|nd|rd|th) year representatives?$/u);
  if (yearRepresentative) return `${yearRepresentative[1]}${ordinalSuffix(Number(yearRepresentative[1]))} Year Representative`;
  const words = String(positionTitle || "").trim().replace(/\s+/gu, " ").split(" ");
  return words.map((word, index) => {
    if (!word) return word;
    if (/^\d+(?:st|nd|rd|th)$/iu.test(word)) return word.toLowerCase();
    if (index > 0 && /^(and|of|for|the)$/iu.test(word)) return word.toLowerCase();
    return `${word.charAt(0).toLocaleUpperCase("en")}${word.slice(1).toLocaleLowerCase("en")}`;
  }).join(" ");
}

export function formatOfficerServiceDate(value) {
  if (!value) return "";
  const input = /^\d{4}-\d{2}-\d{2}$/u.test(String(value))
    ? `${value}T00:00:00+08:00`
    : value;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatOfficerTermLabel(officer) {
  const leadershipYear = String(officer?.leadership_academic_year || "").trim();
  if (leadershipYear) {
    return `AY ${leadershipYear.replace(/\b(\d{4})-(\d{4})\b/u, "$1–$2")}`;
  }

  const hasAcademicTermId = officer?.academic_term_id !== null
    && officer?.academic_term_id !== undefined
    && officer?.academic_term_id !== "";

  if (hasAcademicTermId) {
    const academicTerm = Array.isArray(officer?.academic_term)
      ? officer.academic_term[0]
      : officer?.academic_term;
    const semester = String(academicTerm?.semester || "").trim();
    const academicYear = String(academicTerm?.academic_year || "").trim();
    return semester && academicYear ? `${semester} AY ${academicYear.replace(/\b(\d{4})-(\d{4})\b/u, "$1–$2")}` : "";
  }

  const legacyLabel = String(officer?.term_label || "").trim();
  if (/^\d{4}-\d{4}$/u.test(legacyLabel)) {
    return `AY ${legacyLabel.replace(/\b(\d{4})-(\d{4})\b/u, "$1–$2")}`;
  }
  return legacyLabel.replace(/\b(\d{4})-(\d{4})\b/u, "$1–$2");
}

export function formatOfficerServicePeriod(officer) {
  const start = formatOfficerServiceDate(officer?.service_started_at || officer?.term_start);
  const end = formatOfficerServiceDate(officer?.service_ended_at || officer?.term_end);
  if (start && end) return `Served ${start} – ${end}`;
  if (start) return `Served from ${start}`;
  if (end) return `Served until ${end}`;
  return "";
}

function ordinalSuffix(value) {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "th";
  return ({ 1: "st", 2: "nd", 3: "rd" })[value % 10] || "th";
}

export function getCurrentPositionConflict(positionTitle, currentOfficers = []) {
  const normalizedPosition = normalizeOfficerPosition(positionTitle);
  if (!normalizedPosition) return null;

  const officer = currentOfficers.find((current) =>
    normalizeOfficerPosition(current.position_title) === normalizedPosition
  );
  if (!officer) return null;

  const positionLabel = formatOfficerPositionTitle(officer.position_title || positionTitle);
  return {
    officer,
    message: `${positionLabel} is already occupied by ${officerDisplayName(officer)}.`,
  };
}

export function getCurrentStudentAvailability(studentId, currentOfficers = []) {
  const officer = currentOfficers.find((current) =>
    String(current.student_id) === String(studentId)
  );
  if (!officer) return { available: true, reason: "Eligible" };
  return {
    available: false,
    officer,
    reason: `${officerDisplayName(officer)} is already serving as ${formatOfficerPositionTitle(officer.position_title)} in Current Leadership.`,
  };
}

export function getCurrentWinnerConflict(winner, currentOfficers = []) {
  const positionConflict = getCurrentPositionConflict(winner?.position_title, currentOfficers);
  if (positionConflict) return positionConflict;
  const studentAvailability = getCurrentStudentAvailability(winner?.student_id, currentOfficers);
  if (!studentAvailability.available) {
    return { officer: studentAvailability.officer, message: studentAvailability.reason };
  }
  return null;
}

function normalizedTermLabel(value) {
  return String(value || "").trim().replace(/\s+/gu, " ").toLowerCase();
}

function getTermFieldContext(officers, field, normalize = (value) => String(value || "")) {
  const values = officers.map((officer) => officer?.[field] || null);
  const normalized = new Set(values.map((value) => value === null ? "<missing>" : normalize(value)));
  const ambiguous = normalized.size > 1;
  return {
    ambiguous,
    value: ambiguous ? "" : values[0] || "",
  };
}

/** Current term metadata is inherited only from unanimous current records. */
export function getCurrentOfficerTermContext(currentOfficers = []) {
  const officers = Array.isArray(currentOfficers) ? currentOfficers : [];
  const leadershipYear = getTermFieldContext(officers, "leadership_academic_year", normalizedTermLabel);
  const termStart = getTermFieldContext(officers, "term_start");
  const termEnd = getTermFieldContext(officers, "term_end");
  const noCurrentOfficers = officers.length === 0;
  const requiresConfirmation = false;

  return {
    defaults: {
      leadership_academic_year: leadershipYear.value,
      term_label: leadershipYear.value ? `AY ${leadershipYear.value}` : "",
      term_start: termStart.value,
      term_end: termEnd.value,
    },
    requiresConfirmation,
    leadershipYearAmbiguous: leadershipYear.ambiguous,
    termEndAmbiguous: termEnd.ambiguous,
    termStartAmbiguous: termStart.ambiguous,
    hasCurrentOfficers: !noCurrentOfficers,
  };
}

export function getOfficerServiceDateError(termStart, termEnd) {
  if (termStart && termEnd && termEnd < termStart) {
    return "End of service must be on or after the start date.";
  }
  return "";
}

export async function submitAppointedCurrentOfficer({
  studentId,
  positionTitle,
  positionConflict,
  serviceDateError,
  service,
  onSubmit,
}) {
  if (!studentId) return { submitted: false, field: "student", message: "Choose an eligible student." };
  if (!String(positionTitle || "").trim()) return { submitted: false, field: "position", message: "Enter an appointed position." };
  if (positionConflict) return { submitted: false, field: "position", message: positionConflict.message };
  if (serviceDateError) return { submitted: false, field: "term_end", message: serviceDateError };

  await onSubmit?.({
    student_id: studentId,
    position_title: positionTitle,
    service: { term_end: service?.term_end || null },
    confirm_term_context: false,
  });
  return { submitted: true };
}
