// Local byte-for-byte inventory only; never connects to Supabase or a database.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
const files=[
 'supabase/migrations/20261019011416_candidate_duplicate_check_privacy_compatibility.sql',
 'supabase/migrations/20261019011420_election_campaign_publication.sql',
 'src/components/CandidateManagement.jsx','src/components/ElectionCampaignPublication.jsx','src/components/ElectionCampaignPublication.css',
 'src/utils/candidateManagementContract.js','src/utils/electionCampaignPublication.js','src/utils/developmentProductionWriteGuard.js',
 'src/pages/board/Candidates.css','src/pages/superadmin/Candidates.css','src/pages/student/Campaign.jsx',
 'tests/electionCampaignPublication.test.mjs','tests/candidateManagementContract.test.mjs','tests/developmentProductionWriteGuard.test.mjs',
 'scripts/isolated-election-campaign-publication/run.mjs','scripts/isolated-election-campaign-publication/assertions.sql',
 'scripts/isolated-election-campaign-publication/production-functions.json','scripts/isolated-election-campaign-publication/browser.mjs',
 'deploy/election-campaign-publication-review/REVIEW.md','deploy/election-campaign-publication-review/PREFLIGHT.sql',
 'deploy/election-campaign-publication-review/DUPLICATE_POSTFLIGHT.sql','deploy/election-campaign-publication-review/POSTFLIGHT.sql',
];
const inventory=Object.fromEntries(files.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase()]));
writeFileSync('deploy/election-campaign-publication-review/SHA256SUMS.json',JSON.stringify(inventory,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(inventory).filter(([path])=>path.startsWith('supabase/migrations/'))),null,2));
