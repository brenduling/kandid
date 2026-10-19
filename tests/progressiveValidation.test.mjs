import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getProgressiveFieldError,
  shouldShowProgressiveError,
} from "../src/utils/progressiveValidation.js";

const layer = await readFile(new URL("../src/components/ProgressiveValidationLayer.jsx", import.meta.url), "utf8");
const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
const studentSetup = await readFile(new URL("../src/pages/auth/StudentSetup.jsx", import.meta.url), "utf8");
const boardElection = await readFile(new URL("../src/pages/board/BoardElectionSetup.jsx", import.meta.url), "utf8");
const adminElection = await readFile(new URL("../src/pages/superadmin/Elections.jsx", import.meta.url), "utf8");
const candidateManagement = await readFile(new URL("../src/components/CandidateManagement.jsx", import.meta.url), "utf8");

function field({ label = "Election name", type = "text", value = "", required = false, min = "", max = "", validity = {}, dataset = {}, related = {} } = {}) {
  const form = { querySelector: (selector) => related[selector] || null };
  return {
    tagName: type === "textarea" ? "TEXTAREA" : "INPUT",
    type,
    name: "",
    value,
    required,
    min,
    max,
    validity,
    dataset,
    form,
    labels: [{ textContent: label }],
    getAttribute: () => null,
  };
}

test("untouched required values remain neutral; blur or submit can reveal the required message", () => {
  const input = field({ required: true });
  const error = getProgressiveFieldError(input);
  assert.equal(error, "Election name is required.");
  assert.equal(shouldShowProgressiveError(error, { touched: false, submitted: false }), false);
  assert.equal(shouldShowProgressiveError(error, { touched: true }), true);
  assert.equal(shouldShowProgressiveError(error, { submitted: true }), true);
});

test("field labels exclude already-rendered error portals on every validation pass", () => {
  const input = field({ label: "Password Password is required.", type: "password", required: true, validity: { valueMissing: true } });
  input.labels[0].cloneNode = () => {
    const clone = { textContent: "Password Password is required.", querySelectorAll() { return [{ remove() { clone.textContent = "Password"; } }]; } };
    return clone;
  };
  for (let i = 0; i < 10; i++) assert.equal(getProgressiveFieldError(input), "Password is required.");
});

test("typed format errors appear and disappear when corrected", () => {
  const input = field({ label: "Email", type: "email", value: "not-an-email", validity: { typeMismatch: true } });
  assert.equal(getProgressiveFieldError(input), "Enter a valid email address.");
  input.value = "student@example.edu";
  input.validity = {};
  assert.equal(getProgressiveFieldError(input), "");
});

test("date cross-field conflict is recomputed as the dependent value changes", () => {
  const start = { value: "2026-10-05T17:00" };
  const end = field({
    label: "Voting end",
    value: "2026-10-04T17:00",
    dataset: { afterField: "#voting-start", afterLabel: "voting start", afterMessage: "Voting must end after it starts." },
    related: { "#voting-start": start },
  });
  assert.equal(getProgressiveFieldError(end), "Voting must end after it starts.");
  end.value = "2026-10-06T17:00";
  assert.equal(getProgressiveFieldError(end), "");
});

test("custom schedule controls and selects expose their own required state", () => {
  const date = field({
    label: "Voting start",
    dataset: { validationField: "true", validationRequired: "true", validationValue: "" },
  });
  assert.equal(getProgressiveFieldError(date), "Voting start is required.");
  date.dataset.validationValue = "2026-10-05T17:00";
  assert.equal(getProgressiveFieldError(date), "");

  const select = field({ label: "Academic term", type: "select-one", required: true, validity: { valueMissing: true } });
  assert.equal(getProgressiveFieldError(select), "Academic term is required.");
});

test("range errors read clearly for numeric and time inputs", () => {
  assert.equal(
    getProgressiveFieldError(field({ label: "Year level", type: "number", value: "0", validity: { rangeUnderflow: true }, min: "1" })),
    "Year level must be at least 1.",
  );
  assert.equal(
    getProgressiveFieldError(field({ label: "Start time", type: "time", value: "07:00", validity: { rangeUnderflow: true }, min: "08:00" })),
    "Choose a start time within the allowed range.",
  );
});

test("password matching reuses Kandid's existing password requirements", () => {
  const password = { value: "Kandid1!" };
  const confirmation = field({
    label: "Confirm password",
    type: "password",
    value: "Different1!",
    dataset: { matchField: "#new-password", matchMessage: "Confirm password must match your new password." },
    related: { "#new-password": password },
  });
  assert.equal(getProgressiveFieldError(confirmation), "Confirm password must match your new password.");
  confirmation.value = password.value;
  assert.equal(getProgressiveFieldError(confirmation), "");

  const weak = field({ type: "password", value: "x", dataset: { passwordPolicy: "true" } });
  assert.match(getProgressiveFieldError(weak), /^Password must include at least 6 characters, a number, a symbol\.$/);
});

test("shared layer mounts globally, blocks invalid submission, focuses first error, and leaves valid submit handlers intact", () => {
  assert.match(app, /<ProgressiveValidationLayer\s*\/>/);
  assert.match(layer, /event\.preventDefault\(\)/);
  assert.match(layer, /event\.stopPropagation\(\)/);
  assert.match(layer, /first\.focus/);
  assert.match(layer, /first\.scrollIntoView/);
  assert.match(layer, /if \(!errors\.length\) return/);
  assert.match(layer, /aria-invalid/);
  assert.match(layer, /aria-describedby/);
});

test("multi-step checks are scoped to rendered fields in the current form step", () => {
  assert.match(layer, /function isRenderedField\(field\)/);
  assert.match(layer, /field\.closest\("\[hidden\], \[aria-hidden='true'\]"\)/);
  assert.match(layer, /field\.getClientRects\(\)\.length > 0/);
  assert.match(layer, /const errors = showErrors\(form, true\)/);
});

test("representative Student, Board, and Super Admin forms expose progressive rules", () => {
  assert.match(studentSetup, /data-password-policy="true"/);
  assert.match(studentSetup, /data-match-field="#student-setup-new-password"/);
  assert.match(studentSetup, /data-validation-group="otp"/);
  assert.match(boardElection, /data-progressive-next="true"/);
  assert.match(boardElection, /afterMessage=/);
  assert.match(adminElection, /afterField=/);
  assert.match(candidateManagement, /required/);
});
