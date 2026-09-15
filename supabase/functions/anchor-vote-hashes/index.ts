import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ethers } from "https://esm.sh/ethers@6";

const VOTE_REGISTRY_ABI = [
  "function owner() view returns (address)",
  "function recordVoteHash(bytes32 voteHash)",
  "function isVoteHashRecorded(bytes32 voteHash) view returns (bool)",
];

const NETWORK_NAME = "sepolia";
const EXPECTED_CHAIN_ID = 11155111n;
const MAX_VOTES_PER_RUN = 2;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown blockchain anchoring error.");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const anchorWorkerToken = Deno.env.get("ANCHOR_WORKER_TOKEN");

  if (!anchorWorkerToken) {
    return jsonResponse({
      ok: false,
      error: "Anchor worker authorization is not configured.",
    }, 500);
  }

  const providedWorkerToken = req.headers.get("x-anchor-worker-token");

  if (providedWorkerToken !== anchorWorkerToken) {
    return jsonResponse({
      ok: false,
      error: "Unauthorized.",
    }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const sepoliaRpcUrl = Deno.env.get("SEPOLIA_RPC_URL");
  const deployerPrivateKey = Deno.env.get("DEPLOYER_PRIVATE_KEY");
  const registryAddress = Deno.env.get("VOTE_REGISTRY_ADDRESS");

  if (
    !supabaseUrl ||
    !serviceRoleKey ||
    !sepoliaRpcUrl ||
    !deployerPrivateKey ||
    !registryAddress
  ) {
    return jsonResponse(
      { error: "Server blockchain configuration is incomplete." },
      500,
    );
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const provider = new ethers.JsonRpcProvider(sepoliaRpcUrl);
  const signer = new ethers.Wallet(deployerPrivateKey, provider);
  const contract = new ethers.Contract(
    registryAddress,
    VOTE_REGISTRY_ABI,
    signer,
  );

  const network = await provider.getNetwork();

  if (network.chainId !== EXPECTED_CHAIN_ID) {
    return jsonResponse({ error: "Unexpected blockchain network." }, 500);
  }

  const contractOwner = await contract.owner();
  const signerAddress = await signer.getAddress();

  if (contractOwner.toLowerCase() !== signerAddress.toLowerCase()) {
    return jsonResponse(
      { error: "Configured signer is not the contract owner." },
      500,
    );
  }

  const results: Array<Record<string, unknown>> = [];

  for (let attempt = 0; attempt < MAX_VOTES_PER_RUN; attempt++) {
    const { data: claimedRows, error: claimError } = await adminClient.rpc(
      "claim_next_vote_anchor",
    );

    if (claimError) {
      console.error("Vote anchor claim failed:", claimError);
      results.push({
        status: "claim_failed",
        error: "Could not claim vote anchor work.",
      });
      break;
    }

    const claimed = Array.isArray(claimedRows) ? claimedRows[0] : null;

    if (!claimed) {
      break;
    }

    const voteId = Number(claimed.vote_id);
    const voteHash = String(claimed.vote_hash || "");

    try {
      const alreadyRecorded = await contract.isVoteHashRecorded(voteHash);

      if (alreadyRecorded) {
        const { error: manualReviewError } = await adminClient.rpc(
          "mark_vote_anchor_manual_review",
          {
            p_vote_id: voteId,
            p_vote_hash: voteHash,
            p_reason:
              "Vote hash already exists on-chain, but transaction metadata is unavailable from this worker path.",
          },
        );

        if (manualReviewError) {
          console.error("Could not mark anchor for manual review:", manualReviewError);
          results.push({
            status: "manual_review_transition_failed",
            vote_id: voteId,
          });
          break;
        }

        results.push({
          status: "manual_review_required",
          vote_id: voteId,
          message: "Vote hash already exists on-chain and requires manual review.",
        });
        continue;
      }

      const tx = await contract.recordVoteHash(voteHash);
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error("Blockchain transaction receipt was not returned.");
      }

      const { error: successError } = await adminClient.rpc(
        "mark_vote_anchor_success",
        {
          p_vote_id: voteId,
          p_vote_hash: voteHash,
          p_transaction_hash: tx.hash,
          p_network: NETWORK_NAME,
          p_contract_address: registryAddress,
          p_block_number: Number(receipt.blockNumber),
        },
      );

      if (successError) {
        console.error("Blockchain succeeded but DB finalization failed:", successError);
        results.push({
          status: "blockchain_recorded_db_finalize_failed",
          vote_id: voteId,
          tx_hash: tx.hash,
        });
        break;
      }

      results.push({
        status: "anchored",
        vote_id: voteId,
        tx_hash: tx.hash,
        block_number: Number(receipt.blockNumber),
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      const { error: failureError } = await adminClient.rpc(
        "mark_vote_anchor_failure",
        {
          p_vote_id: voteId,
          p_vote_hash: voteHash,
          p_error: errorMessage,
        },
      );

      if (failureError) {
        console.error("Could not mark anchor failure:", failureError);
      }

      console.error("Blockchain anchoring failed:", error);

      results.push({
        status: "anchor_failed",
        vote_id: voteId,
        error: "Blockchain anchoring failed.",
      });
      break;
    }
  }

  if (results.length === 0) {
    return jsonResponse({
      ok: true,
      status: "idle",
      processed: 0,
      message: "No pending vote hashes to anchor.",
    });
  }

  return jsonResponse({
    ok: true,
    status: "completed",
    processed: results.length,
    anchored: results.filter((result) => result.status === "anchored").length,
    results,
  });
});
