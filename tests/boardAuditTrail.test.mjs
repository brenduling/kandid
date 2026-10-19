import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  boardAuditActionLabel,
  boardAuditActorLabel,
  boardAuditActorRole,
  boardAuditCategoryLabel,
  boardAuditSafeDetails,
  buildBoardAuditRpcArgs,
} from "../src/utils/boardAuditTrail.js";

const root = new URL("../", import.meta.url);
const page = await readFile(new URL("src/pages/board/AuditTrail.jsx", root), "utf8");
const app = await readFile(new URL("src/App.jsx", root), "utf8");
const navigation = await readFile(new URL("src/config/navigation.js", root), "utf8");
const stylesheet = await readFile(new URL("src/pages/board/AuditTrail.css", root), "utf8");
const foundationMigration = await readFile(new URL("supabase/migrations/20261002130000_trusted_audit_foundation.sql", root), "utf8");

test("Board audit RPC parameters use the exact trusted contract and never send an organization", () => {
  const args = buildBoardAuditRpcArgs({
    cursor: { created_at: "2026-10-01T12:00:00Z", id: 81 },
    pageSize: 50,
    category: "elections",
    electionId: "28",
    search: "Results",
  });
  assert.deepEqual(args, {
    p_before_created_at: "2026-10-01T12:00:00Z",
    p_before_id: 81,
    p_page_size: 50,
    p_category: "elections",
    p_event_type: null,
    p_election_id: "28",
    p_search: "Results",
  });
  assert.equal(Object.hasOwn(args, "p_organization_id"), false);
  assert.match(page, /supabase\.rpc\("kandid_list_board_audit_events", buildBoardAuditRpcArgs/);
  assert.doesNotMatch(page, /from\(["']audit_logs["']\)/);
});

test("action labels are readable and unknown event types fall back without hiding the event", () => {
  assert.equal(boardAuditActionLabel("results_published"), "Results published");
  assert.equal(boardAuditActionLabel("custom_event_added"), "Custom Event Added");
  assert.equal(boardAuditCategoryLabel("students"), "Students & membership");
});

test("legacy records are explicitly identified without pretending the actor is known", () => {
  assert.equal(boardAuditActorLabel({ is_legacy: true, actor_name: "Legacy administrator", actor_role: "unknown" }), "Legacy record");
  assert.equal(boardAuditActorRole({ is_legacy: true, actor_role: "unknown" }), "Historical activity");
  assert.equal(boardAuditActorLabel({ is_legacy: false, actor_name: "Mariel", actor_role: "electoral_board" }), "Mariel");
});

test("details expose only changed-field names and safe program names/codes, not raw JSON", () => {
  const details = boardAuditSafeDetails({
    changed_fields: ["campaign_start", "status"],
    safe_details: {
      before_programs: [{ id: 1, code: "BSIT", name: "Information Technology" }],
      after_programs: [{ id: 2, code: "BSCS", name: "Computer Science" }],
      private_metadata: "must not be presented",
    },
  });
  assert.deepEqual(details, {
    changedFields: ["Campaign start", "Status"],
    beforePrograms: ["Information Technology (BSIT)"],
    afterPrograms: ["Computer Science (BSCS)"],
  });
  assert.equal(boardAuditSafeDetails({ changed_fields: [], safe_details: {} }), null);
  assert.doesNotMatch(page, /event\.metadata|private_metadata|vote_hash|ballot_id|transaction_hash|nonce|receipt/);
});

test("Board route and navigation expose only the Board Audit Trail destination", () => {
  assert.match(app, /const BoardAuditTrail = lazy\(\(\) => import\("\.\/pages\/board\/AuditTrail"\)\)/);
  assert.match(app, /path="audit-trail"[\s\S]*?element=\{<BoardAuditTrail \/>\}/);
  assert.match(navigation, /name: "Audit Trail", path: "\/board\/audit-trail"/);
  assert.doesNotMatch(navigation, /name: "Audit Trail", path: "\/super-admin\//);
});

test("page preserves loading/error/empty states, filter reset, and keyset append pagination", () => {
  assert.match(page, /board-audit-skeleton-list/);
  assert.match(page, /Audit activity is unavailable/);
  assert.match(page, /No activity matches these filters/);
  assert.match(page, /No activity has been recorded yet/);
  assert.match(page, /setEvents\(\(current\) => \{/);
  assert.match(page, /\.\.\.current, \.\.\.olderEvents\.filter/);
  assert.match(page, /cursor: nextCursor/);
  assert.match(page, /Load older activity/);
  assert.match(foundationMigration, /order by coalesce\(l\.created_at, l\.timestamp\) desc, l\.id desc/i);
  assert.match(page, /events\.map\(\(event\) => <AuditRow/);
  assert.doesNotMatch(page, /events\.sort\(/);
  assert.match(stylesheet, /@media \(max-width: 640px\)/);
});
