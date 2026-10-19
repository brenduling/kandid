import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const STUDENTS = "src/pages/board/Students.jsx";
const POPUP = "src/components/PopupOverlay.jsx";

const source = readFileSync(STUDENTS, "utf8");
const popup = readFileSync(POPUP, "utf8");

// Isolate the registry search control and the Remove modal so assertions cannot be
// satisfied by a matching attribute somewhere else on the page.
function sliceBetween(text, startNeedle, endNeedle) {
  const start = text.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing start marker: ${startNeedle}`);
  const end = text.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing end marker: ${endNeedle}`);
  return text.slice(start, end);
}

const searchControl = sliceBetween(
  source,
  '<div className="search-shell board-students-search">',
  "<label className=\"board-students-sort-field\">",
);

const removeModal = sliceBetween(
  source,
  '<div className="popup-sheet board-registry-sheet is-danger"',
  "<div className=\"popup-sheet max-w-2xl\">",
);

const reauthBlock = sliceBetween(
  removeModal,
  'aria-labelledby="board-student-remove-reauth"',
  "</section>",
);

// ROOT CAUSE: the modal's password field had no paired username field, so browser
// password managers treated the page's first eligible text input - the registry
// search - as the username and filled the Board email into it.
test("the reauthentication password has a correctly paired username field", () => {
  assert.match(reauthBlock, /autoComplete="current-password"/);

  const usernameAt = reauthBlock.indexOf('autoComplete="username"');
  const passwordAt = reauthBlock.indexOf('autoComplete="current-password"');

  assert.notEqual(usernameAt, -1, "reauth block needs an autocomplete=username field");
  assert.ok(
    usernameAt < passwordAt,
    "the username field must precede the password field so the browser pairs them",
  );
});

test("the paired username field is display-only and cannot be edited or submitted", () => {
  const accountField = sliceBetween(
    reauthBlock,
    'id="board-student-remove-account"',
    'aria-describedby="board-student-remove-account-help"',
  );

  assert.match(accountField, /readOnly/, "the officer must not change the verified identity");
  assert.match(accountField, /type="email"/);
  assert.match(accountField, /value=\{boardAccountEmail\}/);
  // A name attribute would let the value be serialized or autofilled elsewhere.
  assert.ok(!/\sname=/.test(accountField), "username field must carry no name attribute");
  assert.ok(!/onChange/.test(accountField), "username field must not be editable");
});

test("the Board account email is sourced from the signed-in profile, not from the student", () => {
  assert.match(source, /const boardAccountEmail = user\?\.email \|\| "";/);
  // It must not be sourced from the student being removed.
  assert.ok(
    !/removeDialog[^\n]*\.email/.test(source),
    "the Board account email must never come from the student record",
  );
});

// The registry search must be semantically a search field and must not be a
// candidate for credential interpretation.
test("the registry search is a semantic search field excluded from credential autofill", () => {
  assert.match(searchControl, /type="search"/);
  assert.match(searchControl, /autoComplete="off"/);

  for (const token of ["username", "email", "current-password", "new-password"]) {
    assert.ok(
      !new RegExp(`autoComplete="${token}"`).test(searchControl),
      `search must not advertise autocomplete="${token}"`,
    );
  }
  assert.ok(!/type="password"/.test(searchControl));
});

test("the registry search keeps its own accessible name and controlled state", () => {
  assert.match(searchControl, /aria-label="Search students"/);
  assert.match(searchControl, /value=\{search\}/);
  assert.match(searchControl, /setSearch\(e\.target\.value\)/);
});

// STATE ISOLATION: search and confirmation must never share a setter or a ref.
test("the registry search setter is used only by the search input itself", () => {
  const setters = source.match(/setSearch\(/g) || [];
  assert.equal(setters.length, 1, "setSearch must have exactly one call site");
  assert.match(searchControl, /setSearch\(/);
});

test("no removal handler can write to the registry search", () => {
  const removalCode = sliceBetween(
    source,
    "function handleRemoveMembership",
    "function handleRestoreMembership",
  );

  assert.ok(!/setSearch\(/.test(removalCode), "removal code must never set the search query");
  assert.ok(!/setDebouncedSearch\(/.test(removalCode));
  assert.ok(!/setCurrentPage\(/.test(removalCode));
});

test("opening or closing the Remove dialog cannot alter the search query", () => {
  // No effect may seed or reset the search query, so a pre-existing value survives
  // the whole open/close cycle.
  const effects = source.match(/useEffect\([\s\S]*?\n {2}\}, \[[^\]]*\]\);/g) || [];
  for (const effect of effects) {
    assert.ok(!/setSearch\(/.test(effect), "no effect may write the search query");
  }
});

// SECURITY: the password must never reach registry state, the URL, storage, or a log.
test("the password can never reach the registry search", () => {
  const removalCode = sliceBetween(
    source,
    "function handleRemoveMembership",
    "function handleRestoreMembership",
  );

  assert.ok(
    !/setSearch\([^)]*removePassword/.test(source),
    "password must never be passed to the search setter",
  );
  assert.ok(
    !/setSearch\([^)]*removeConfirmId/.test(source),
    "Student ID must never be passed to the search setter",
  );
  assert.ok(!/value=\{removePassword\}/.test(searchControl));
  assert.ok(!/removePassword/.test(searchControl));
});

test("the password is never persisted, logged, or placed in the URL", () => {
  assert.ok(!/localStorage\.setItem\([^)]*removePassword/.test(source));
  assert.ok(!/sessionStorage\.setItem\([^)]*removePassword/.test(source));
  assert.ok(!/console\.[a-z]+\([^)]*removePassword/.test(source));
  assert.ok(!/console\.[a-z]+\([^)]*password/i.test(source));

  // The removal request must carry only the four contract fields, and nothing else
  // (in particular no Board email and no username field value).
  const payload = sliceBetween(
    removalCodeOfConfirm(),
    "removeBoardStudentParticipation({",
    "});",
  );
  const keys = (payload.match(/^\s*(\w+)\s*[,:]/gm) || []).map((k) => k.replace(/[^\w]/g, ""));
  assert.deepEqual(keys.sort(), ["confirmStudentNumber", "password", "reason", "studentId"]);
  assert.ok(!/boardAccountEmail/.test(payload), "the Board email is never sent to the function");
  assert.ok(!/email/i.test(payload), "no email field may be sent to the function");

  // The query string must never carry a credential.
  assert.ok(!/searchParams\.set\([^)]*password/i.test(source));
  assert.ok(!/useSearchParams[\s\S]{0,200}password/.test(source));
});

function removalCodeOfConfirm() {
  return sliceBetween(
    source,
    "async function confirmRemoveMembership",
    "function handleRestoreMembership",
  );
}

// MODAL FOCUS: reuse the existing shared overlay rather than a second modal system.
test("the Remove dialog reuses the shared PopupOverlay focus trap", () => {
  assert.match(removeModal, /role="dialog"/);
  assert.match(removeModal, /aria-modal="true"/);
  assert.match(removeModal, /aria-labelledby="board-student-remove-title"/);

  // Background stays interactive-free: the overlay is portaled to document.body and
  // carries a Tab focus trap, so the registry search cannot be tabbed to.
  assert.match(popup, /createPortal\(/);
  assert.match(popup, /document\.body/);
  assert.match(popup, /event\.key !== "Tab"/);
  assert.match(popup, /event\.preventDefault\(\)/);
  assert.match(popup, /first\?\.focus\?\.\(\)/);
  assert.match(popup, /document\.body\.style\.overflow = "hidden"/);
});

test("the Remove dialog is not a form, so no credential field can be submitted implicitly", () => {
  assert.ok(!/<form/.test(removeModal), "Remove dialog must not be a form element");
  assert.ok(!/type="submit"/.test(removeModal), "Remove dialog has no submit path");
});

test("the Remove dialog exposes every control by an accessible name", () => {
  for (const id of [
    "board-student-remove-confirm",
    "board-student-remove-password",
    "board-student-remove-account",
  ]) {
    assert.match(removeModal, new RegExp(`<label htmlFor="${id}">`), `${id} needs a real label`);
    assert.match(removeModal, new RegExp(`id="${id}"`), `${id} must exist`);
  }
  assert.match(removeModal, /aria-label="Close remove student"/);
  assert.match(
    removeModal,
    /aria-label=\{removePasswordVisible \? "Hide password" : "Show password"\}/,
  );
  assert.match(removeModal, /aria-pressed=\{removePasswordVisible\}/);
});
