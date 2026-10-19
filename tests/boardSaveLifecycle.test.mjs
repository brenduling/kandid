import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

for (const [page, table, fetchName] of [
  ["Partylists", "partylists", "fetchPartylists"],
  ["EligibilityRules", "eligibility_rules", "fetchRules"],
]) {
  const source = readFileSync(`src/pages/board/${page}.jsx`, "utf8");
  const start = source.indexOf("async function handleSubmit(e)");
  const end = source.indexOf(page === "Partylists" ? "  /* --- guided form" : "  async function handleDelete", start);
  const handlerSource = source.slice(start, end).trim();
  function setup({ editing = null, outcome = "success", busy = false } = {}) {
    const calls = { busy: [], success: [], errors: [], closed: 0, refreshes: 0, payloads: [] };
    const response = async () => {
      if (outcome === "throw") throw new Error("synthetic transport rejection");
      return { error: outcome === "error" ? { message: "Synthetic save denied" } : null };
    };
    const supabase = { from: (name) => {
      assert.equal(name, table);
      return {
        insert: async (payload) => { calls.payloads.push(payload[0]); return response(); },
        update: (payload) => { calls.payloads.push(payload); return { eq: async (column, id) => { assert.equal(column, "id"); assert.equal(id, editing.id); return response(); } }; },
      };
    } };
    const form = { name: "Synthetic Party", description: "Test", election_id: "4", program: "BSIT", min_year_level: "1", max_year_level: "4", allow_shs: false };
    const deps = { busy, editing, mutationPending: { current: busy }, user: { id: 73, role: "electoral_board" }, step: 3, goNext: () => {}, setStep: () => {}, orgId: 73, form, supabase,
      submission: { current: async (values, organizationId) => { calls.payloads.push({ ...values, organization_id: organizationId, election_id: Number(values.election_id) }); return response(); } },
      savePartylistEdit: async (_client, _original, values, organizationId) => { calls.payloads.push({ ...values, organization_id: organizationId, election_id: Number(values.election_id) }); return response(); },
      saveEligibilityRuleEdit: async (_client, _original, values) => { calls.payloads.push({ ...values, election_id: Number(values.election_id) }); return response(); },
      setBusy: (value) => calls.busy.push(value), prompt: { success: (message) => calls.success.push(message), error: (message) => calls.errors.push(message) },
      closeForm: () => { calls.closed += 1; }, [fetchName]: async () => { calls.refreshes += 1; },
    };
    const names = Object.keys(deps);
    const handler = new Function(...names, `return ${handlerSource};`)(...Object.values(deps));
    return { calls, submit: () => handler({ preventDefault() {} }) };
  }
  test(`${page}: create and edit release saving state after confirmed success`, async () => {
    for (const editing of [null, { id: 9 }]) {
      const { calls, submit } = setup({ editing });
      await submit();
      assert.deepEqual(calls.busy, [true, false]);
      assert.equal(calls.success.length, 1);
      assert.equal(calls.errors.length, 0);
      assert.equal(calls.closed, 1);
      assert.equal(calls.refreshes, 1);
      if (page === "Partylists") assert.equal(calls.payloads[0].organization_id, 73);
      else assert.equal(calls.payloads[0].election_id, 4);
    }
  });
  test(`${page}: returned and thrown failures retain the form, report failure, and allow retry`, async () => {
    for (const outcome of ["error", "throw"]) {
      const { calls, submit } = setup({ outcome });
      await submit();
      assert.deepEqual(calls.busy, [true, false]);
      assert.equal(calls.success.length, 0);
      assert.equal(calls.errors.length, 1);
      assert.equal(calls.closed, 0);
      assert.equal(calls.refreshes, 0);
    }
    const duplicate = setup({ busy: true });
    await duplicate.submit();
    assert.equal(duplicate.calls.payloads.length, 0);
  });
}
