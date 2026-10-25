import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { getStudentSetupLookupFailure } from "../src/utils/studentSetupLookupFailure.js";
import { readStudentSetupRecognition } from "../src/utils/studentSetupRecognition.js";

const source = readFileSync("src/utils/auth.js", "utf8")
  .replace(/^import .*;\r?\n/gm, "").replace(/import\.meta\.env/g, "testEnvironment").replace(/^export /gm, "");
const valid = { data: { recognition_version: 4, student_number: "700001", verification_required: true,
  masked_first_name: "Sy" + "•".repeat(7), masked_last_name: "S" + "•".repeat(6), program: "BSIT", year_level: 1 } };
function harness(response, failure) {
  const calls = [];
  const context = { testEnvironment: {}, readStudentSetupRecognition, supabase: { auth: { onAuthStateChange() {} }, functions: { async invoke(name, options) {
    calls.push({ name, ...options });
    if (failure) throw failure;
    return response;
  } } } };
  runInNewContext(source + "\nglobalThis.inspect = inspectStudentSetup;", context);
  return { calls, inspect: () => context.inspect({ studentNumber: "700001" }) };
}

test("masked v4 inspection succeeds and carries only server-masked fields", async () => {
  const h = harness({ data: valid, error: null });
  const result = await h.inspect();
  assert.equal(result.error, null);
  assert.deepEqual(result.data, { student_number: "700001", verification_required: true,
    masked_first_name: valid.data.masked_first_name, masked_last_name: valid.data.masked_last_name,
    program: "BSIT", year_level: 1 });
  assert.equal(result.data.full_name, undefined);
  assert.equal(result.data.email, undefined);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].body.action, "inspect_setup");
  assert.deepEqual(Object.keys(h.calls[0].body).sort(), ["action", "student_number"]);
});

test("v8, malformed, overbroad and mismatched success payloads fail as contract errors without retries", async () => {
  for (const data of [null, { data: { verification_required: true } }, { data: { ...valid.data, student_number: "700002" } },
    { data: { recognition_version: 3, student_number: "700001", verification_required: true } },
    { data: { recognition_version: 2, student_number: "700001", student_details: { full_name: "Synthetic Student", program: "BSIT", year_level: 1 } } },
    { data: { ...valid.data, masked_first_name: "Synthetic" } },
    { data: { ...valid.data, masked_last_name: "student@example.invalid" } },
    { data: { ...valid.data, year_level: 99 } },
    { data: { ...valid.data, email: "private@example.invalid" } },
    { data: { ...valid.data, student_details: { email: "private@example.invalid" } } }]) {
    const h = harness({ data, error: null });
    const r = await h.inspect();
    assert.equal(r.data, null);
    assert.equal(r.error.code, "student_setup_contract_mismatch");
    assert.equal(getStudentSetupLookupFailure(r.error).kind, "contract");
    assert.equal(h.calls.length, 1);
  }
});

test("known HTTP failures retain their classification even when named TypeError", async () => {
  for (const [status, kind] of [[429, "rate_limit"], [401, "authorization"], [403, "authorization"], [404, "unavailable"], [503, "service"]]) {
    const error = { name: "TypeError", context: new Response("sensitive response", { status, headers: { "Retry-After": "120" } }) };
    const h = harness({ data: null, error });
    const r = await h.inspect();
    assert.equal(r.error, error);
    assert.equal(getStudentSetupLookupFailure(error).kind, kind);
    assert.equal(h.calls.length, 1);
  }
});

test("response-body interruptions and SDK transport failures never automatically retry", async () => {
  for (const name of ["TypeError", "SyntaxError", "FunctionsFetchError", "FunctionsRelayError", "AbortError"]) {
    const error = Object.assign(new Error("private diagnostic"), { name });
    const h = harness(null, error);
    await assert.rejects(h.inspect(), e => e === error);
    assert.equal(getStudentSetupLookupFailure(error).kind, "transport");
    assert.equal(h.calls.length, 1);
  }
});

test("rate-limit messages use bounded Retry-After and do not expose raw errors", () => {
  for (const [header, minutes] of [["120", 2], ["0", 15], ["invalid", 15], ["999999", 60]]) {
    const error = { message: "secret@example.invalid", context: new Response("private", { status: 429, headers: { "Retry-After": header } }) };
    const failure = getStudentSetupLookupFailure(error);
    assert.match(failure.message, new RegExp(`Wait ${minutes} minutes`));
    assert.doesNotMatch(JSON.stringify(failure), /secret|example|private/);
  }
});

test("unknown failures stay generic and the UI preserves errors without logging responses", () => {
  assert.equal(getStudentSetupLookupFailure({ message: "private@example.invalid" }).kind, "unknown");
  const ui = readFileSync("src/pages/auth/StudentSetup.jsx", "utf8");
  assert.match(ui, /catch \(error\)\s*\{\s*result = \{ error \}/);
  assert.match(ui, /getStudentSetupLookupFailure\(result.error\)/);
  assert.doesNotMatch(ui, /Record check interrupted|console\.(log|error)\(/);
});
