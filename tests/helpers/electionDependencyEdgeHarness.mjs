import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { ethers } from "ethers";
import * as security from "../../deploy/election-delete-review/rollback/vote-access-v6/functions/_shared/kandidProductionSecurity.mjs";
import * as contracts from "../../deploy/election-delete-review/rollback/vote-access-v6/functions/_shared/voteAccessContracts.mjs";
import { verifyLegacyVoteAnchorEvidence } from "../../deploy/election-delete-review/rollback/vote-access-v6/functions/_shared/legacyVoteAnchorEvidence.mjs";

const boards = [
  { id: 1, auth_user_id: "board", role: "electoral_board", status: "active", organization_id: 10 },
  { id: 2, auth_user_id: "foreign", role: "electoral_board", status: "active", organization_id: 20 },
  { id: 3, auth_user_id: "unassigned", role: "electoral_board", status: "active", organization_id: null },
  { id: 4, auth_user_id: "super", role: "super_admin", status: "active", organization_id: null },
];

export function edgeHarness({ sourcePath, failure, empty = false, token = "board", rpcCount = 1 } = {}) {
  const calls = [], writes = [];
  const tables = {
    admin_users: boards,
    students: [{ id: 100, auth_user_id: "student", status: "active" }],
    elections: [{ id: 1, organization_id: 10, results_released_at: null }],
    positions: empty ? [] : [{ id: 11, election_id: 1 }],
    candidates: empty ? [] : [{ id: 21, position_id: 11, partylist_id: null }],
    votes: [], vote_ballots: [], partylists: [], eligibility_rules: [], election_access_tokens: [],
    election_campaign_snapshots: [], officers: [], officer_new_roster: [], officer_leadership_releases: [],
    election_officer_publications: [], election_officer_publication_entries: [], candidate_media: [],
    archived_elections: [], audit_logs: [],
  };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.options = {}; }
    select(_fields, options = {}) { this.options = options; return this; }
    eq(k, v) { this.filters.push(row => row[k] === v); return this; }
    in(k, values) { this.filters.push(row => values.includes(row[k])); return this; }
    not(k, _operator, value) { this.filters.push(row => row[k] !== value && row[k] !== undefined); return this; }
    is(k, v) { this.filters.push(row => (row[k] ?? null) === v); return this; }
    or(expression) {
      const id = Number(expression.match(/election_id.eq.(\d+)/)?.[1]);
      this.filters.push(row => row.election_id === id || (row.entity_type === "election" && row.entity_id === String(id)));
      return this;
    }
    order() { return this; }
    range(from, to) { this.window = [from, to]; return this; }
    limit(limit) { this.window = [0, limit - 1]; return this; }
    maybeSingle() { this.single = true; return this; }
    insert() { writes.push(this.table); throw new Error("WRITE FORBIDDEN"); }
    update() { writes.push(this.table); throw new Error("WRITE FORBIDDEN"); }
    delete() { writes.push(this.table); throw new Error("WRITE FORBIDDEN"); }
    then(accept, reject) {
      calls.push({ table: this.table, head: this.options.head === true });
      if (failure === this.table) return Promise.resolve({ data: null, error: { message: "synthetic denied" }, count: null }).then(accept, reject);
      let rows = [...(tables[this.table] || [])].filter(row => this.filters.every(filter => filter(row)));
      let count = rows.length;
      if (failure === "null-count" && this.table === "votes") count = null;
      if (failure === "incomplete-page" && this.table === "positions") count += 1;
      if (failure === "null-page" && this.table === "positions") rows = null;
      if (this.window && rows) rows = rows.slice(this.window[0], this.window[1] + 1);
      return Promise.resolve({ data: this.options.head ? null : this.single ? rows?.[0] ?? null : rows, error: null, count }).then(accept, reject);
    }
  }
  let handler;
  const admin = { from: table => new Query(table), rpc: () => { writes.push("admin-rpc"); throw new Error("UNEXPECTED PRIVILEGED RPC"); } };
  const authClient = {
    auth: { getUser: async () => token === "invalid" ? { data: { user: null }, error: new Error("invalid") } : { data: { user: { id: token } }, error: null } },
    rpc: async (name, args) => {
      calls.push({ rpc: name, args, caller: token });
      if (failure === "rpc") return { data: null, error: new Error("synthetic missing RPC") };
      return { data: { election_id: args.p_election_id, frozen_electorate_records: rpcCount }, error: null };
    },
  };
  const bindings = {
    createClient: (_url, key) => key === "synthetic-service" ? admin : authClient,
    ethers,
    corsHeaders: security.corsHeaders,
    handleCorsPreflight: security.handleCorsPreflight,
    rejectDisallowedOrigin: security.rejectDisallowedOrigin,
    serveWithKandidCors: fn => { handler = async request => security.withKandidCors(request, await fn(request)); },
    ...contracts, verifyLegacyVoteAnchorEvidence,
    Deno: { env: { get: key => ({ SUPABASE_URL: "http://synthetic.invalid", SUPABASE_ANON_KEY: "synthetic-public", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service" })[key] } },
    console: { error() {} },
  };
  const source = readFileSync(sourcePath || "deploy/election-delete-review/candidate/supabase/functions/vote-access/index.ts", "utf8");
  const code = transformSync(source, { loader: "ts", format: "esm", target: "es2022" }).code
    .replace(/^import\s[\s\S]*?;\n/gm, "");
  new Function(...Object.keys(bindings), code)(...Object.values(bindings));
  return {
    calls, writes, tables,
    request: (body, headers = { Authorization: "Bearer synthetic-session" }, method = "POST") => handler(new Request("http://synthetic.invalid/functions/v1/vote-access", {
      method, headers: { "Content-Type": "application/json", ...headers }, ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
    })),
  };
}
