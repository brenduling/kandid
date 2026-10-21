import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getAcademicTermTransitionView } from "../src/utils/academicTermTransitionPresentation.js";

const term = (id, academic_year, semester, status) => ({ id, academic_year, semester, status });
const current = term(4, "2026-2027", "1st Semester", "active");
const next = term(5, "2026-2027", "2nd Semester", "draft");

test("offers only a configured immediate next draft, never a current, closed or skipped term", () => {
  const view = getAcademicTermTransitionView([
    current, next,
    term(6, "2027-2028", "1st Semester", "draft"),
    term(3, "2025-2026", "2nd Semester", "closed"),
  ]);
  assert.equal(view.activeTerm, current);
  assert.deepEqual(view.nextDraftTerms, [next]);
  assert.equal(view.closedTerms.length, 1);
  assert.equal(view.blockedReason, "");
});

test("year rollover offers first semester of the following academic year", () => {
  const target = term(8, "2027-2028", "1st Semester", "draft");
  const view = getAcademicTermTransitionView([{ ...next, status: "active" }, target, current]);
  assert.deepEqual(view.nextDraftTerms, []); // Two active terms must fail closed.
  assert.deepEqual(getAcademicTermTransitionView([{ ...next, status: "active" }, target]).nextDraftTerms, [target]);
});

test("does not guess an active term or bootstrap from historical rows", () => {
  for (const rows of [[], null, [null], [next], [{ ...current, status: "closed" }]]) {
    const view = getAcademicTermTransitionView(rows);
    assert.equal(view.activeTerm, null);
    assert.deepEqual(view.nextDraftTerms, []);
    assert.match(view.blockedReason, /No active academic term/);
  }
});

test("multiple active terms cannot silently resolve to the first row", () => {
  const view = getAcademicTermTransitionView([current, { ...next, status: "active" }]);
  assert.equal(view.activeTerm, null);
  assert.match(view.blockedReason, /Multiple active terms/);
  assert.deepEqual(view.nextDraftTerms, []);
});

test("invalid active identity, year range and semester block the local selection", () => {
  for (const patch of [{ id: 0 }, { id: "invalid" }, { academic_year: "2026-2029" }, { academic_year: "1800-1801" }, { semester: "Summer" }]) {
    const view = getAcademicTermTransitionView([{ ...current, ...patch }, next]);
    assert.match(view.blockedReason, /invalid/);
    assert.deepEqual(view.nextDraftTerms, []);
  }
});

test("duplicate next-term drafts and invalid draft identities cannot become an actionable selection", () => {
  const view = getAcademicTermTransitionView([current, next, { ...next, id: 9 }]);
  assert.match(view.blockedReason, /Conflicting/);
  assert.deepEqual(view.nextDraftTerms, []);
  assert.deepEqual(getAcademicTermTransitionView([current, { ...next, id: 0 }]).nextDraftTerms, []);
});

test("Danger Zone integrates guarded operations without sensitive student-table transport", async () => {
  const page = await readFile(new URL("../src/pages/superadmin/SystemSettings.jsx", import.meta.url), "utf8");
  const component = await readFile(new URL("../src/pages/superadmin/AcademicTermDangerZone.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(component, /supabase|\.rpc\(|functions\.invoke|logAuditEvent/);
  assert.match(component, /activateAcademicTerm\(\{ operationId: review.operation_id, confirmationText \}\)/);
  assert.match(component, /previewAcademicTerm\(selectedTerm.id\)/);
  assert.match(component, /sessionStorage.setItem\(storageKey, review.operation_id\)/);
  assert.match(component, /getAcademicTermTransitionStatus\(pending\)/);
  assert.match(component, /can_refresh === true/);
  assert.match(component, /createAcademicTerm\(nextTerm\)/);
  assert.doesNotMatch(component, /rehearsal|local review complete|Activation is unavailable/i);
  assert.doesNotMatch(page, /\.from\("(?:students|student_term_enrollments|student_organization_terms)"\)/);
});
