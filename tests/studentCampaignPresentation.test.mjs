import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Student Campaign uses the published-only RPC and groups candidates by election position", async () => {
  const campaign = await readFile(new URL("src/pages/student/Campaign.jsx", root), "utf8");
  assert.match(campaign, /rpc\("kandid_get_student_published_campaign"/);
  assert.match(campaign, /positions\.map\(/);
  assert.match(campaign, /candidate\.position_id === position\.id/);
  assert.match(campaign, /candidate\.display_name/);
  assert.match(campaign, /candidate\.photo_url/);
  assert.match(campaign, /candidate\.platform/);
  assert.match(campaign, /candidate\.credentials/);
  assert.match(campaign, /candidate\.partylist/);
});

test("campaign materials render as signed image, video, document, or HTTPS link resources", async () => {
  const campaign = await readFile(new URL("src/pages/student/Campaign.jsx", root), "utf8");
  const css = await readFile(new URL("src/index.css", root), "utf8");
  assert.match(campaign, /resolveCampaignMaterialUrl\(supabase, source\)/);
  assert.match(campaign, /className="student-campaign-material-image"/);
  assert.match(campaign, /<img src=\{url\} alt=\{label\}/);
  assert.match(campaign, /className="student-campaign-material-video" controls/);
  assert.match(campaign, /View or download PDF/);
  assert.match(campaign, /Open campaign link/);
  assert.match(campaign, /No campaign materials have been shared yet\./);
  assert.match(css, /student-campaign-material-image img/);
  assert.match(css, /student-campaign-material-video/);
});

test("Student Elections uses its shared clock for explicit campaign phase and does not alter ballot actions", async () => {
  const elections = await readFile(new URL("src/pages/student/Elections.jsx", root), "utf8");
  assert.match(elections, /const now = useElectionClock\(\)/);
  assert.match(elections, /getCampaignWindowPhase\(election, now\)/);
  assert.match(elections, /Campaign phase/);
  assert.match(elections, /View Campaign/);
  assert.match(elections, /StudentBallotAction electionId=\{election\.id\}/);
  const ballotAction = await readFile(new URL("src/components/student/StudentBallotAction.jsx", root), "utf8");
  assert.match(ballotAction, /navigate\(`\/student\/vote\/\$\{electionId\}`\)/);
});
