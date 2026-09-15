import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ethers } from "https://esm.sh/ethers@6";

const VOTE_REGISTRY_ABI = [
  "function owner() view returns (address)",
  "function recordVoteHash(bytes32 voteHash)",
  "function isVoteHashRecorded(bytes32 voteHash) view returns (bool)",
];

const NETWORK_NAME = "sepolia";
const EXPECTED_CHAIN_ID = 11155111n;
const MAX_BALLOTS_PER_RUN = 1;
const SIGNER_LEASE_SECONDS = 120;
const RECEIPT_WAIT_TIMEOUT_MS = 20000;
const FALLBACK_MIN_SEND_BALANCE_WEI = 1000000000000000n;

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
  return String(error || "Unknown ballot blockchain anchoring error.");
}

function isValidBytes32Hash(value: unknown) {
  return typeof value === "string" && /^0x[0-9a-f]{64}$/.test(value);
}

function isPermanentBlockchainError(message: string) {
  const normalized = message.toLowerCase();
  return [
    "insufficient funds",
    "configured signer is not the contract owner",
    "unexpected blockchain network",
    "invalid ballot hash",
    "execution reverted",
    "call exception",
  ].some((snippet) => normalized.includes(snippet));
}

async function waitForReceiptWithTimeout(
  tx: ethers.TransactionResponse,
): Promise<ethers.TransactionReceipt | null> {
  let timeoutId: number | undefined;

  const timeout = new Promise<null>((resolve) => {
    timeoutId = setTimeout(() => resolve(null), RECEIPT_WAIT_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      tx.wait(1),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function estimateRequiredBalanceWei(
  contract: ethers.Contract,
  provider: ethers.JsonRpcProvider,
  ballotHash: string,
) {
  const estimatedGas = await contract.recordVoteHash.estimateGas(ballotHash);
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;

  if (!gasPrice) return FALLBACK_MIN_SEND_BALANCE_WEI;

  const estimatedCost = estimatedGas * gasPrice;
  return estimatedCost > FALLBACK_MIN_SEND_BALANCE_WEI
    ? estimatedCost
    : FALLBACK_MIN_SEND_BALANCE_WEI;
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
  const registryAddress =
    Deno.env.get("VOTE_REGISTRY_ADDRESS") ||
    Deno.env.get("VITE_VOTE_REGISTRY_ADDRESS");

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

  const results: Array<Record<string, unknown>> = [];

  try {
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

    const { data: submittedRows, error: submittedClaimError } =
      await adminClient.rpc("claim_next_submitted_ballot_anchor");

    if (submittedClaimError) {
      console.error("Submitted ballot reconciliation claim failed:", submittedClaimError);
      results.push({
        status: "submitted_claim_failed",
        error: "Could not claim submitted ballot reconciliation work.",
      });
    } else {
      const submitted = Array.isArray(submittedRows) ? submittedRows[0] : null;

      if (submitted) {
        const ballotId = String(submitted.ballot_id || "");
        const ballotHash = String(submitted.ballot_hash || "");
        const transactionHash = String(submitted.blockchain_tx_id || "");

        if (!isValidBytes32Hash(ballotHash)) {
          await adminClient.rpc("mark_ballot_manual_review", {
            p_ballot_id: ballotId,
            p_ballot_hash: ballotHash,
            p_reason: "Submitted ballot has an invalid ballot hash.",
          });
          results.push({ status: "manual_review_required", ballot_id: ballotId });
        } else {
          const receipt = await provider.getTransactionReceipt(transactionHash);

          if (!receipt) {
            results.push({
              status: "confirmation_pending",
              ballot_id: ballotId,
              tx_hash: transactionHash,
            });
          } else if (receipt.status === 1) {
            const { error: successError } = await adminClient.rpc(
              "mark_ballot_anchor_success",
              {
                p_ballot_id: ballotId,
                p_ballot_hash: ballotHash,
                p_transaction_hash: transactionHash,
                p_block_number: Number(receipt.blockNumber),
                p_anchored_at: new Date().toISOString(),
              },
            );

            if (successError) {
              console.error("Ballot tx confirmed but DB finalization failed:", successError);
              results.push({
                status: "blockchain_recorded_db_finalize_failed",
                ballot_id: ballotId,
                tx_hash: transactionHash,
              });
            } else {
              results.push({
                status: "anchored",
                ballot_id: ballotId,
                tx_hash: transactionHash,
                block_number: Number(receipt.blockNumber),
              });
            }
          } else {
            const { error: failureError } = await adminClient.rpc(
              "mark_ballot_anchor_failure",
              {
                p_ballot_id: ballotId,
                p_ballot_hash: ballotHash,
                p_error: "Blockchain transaction receipt returned a failed status.",
                p_permanent: true,
              },
            );

            if (failureError) {
              console.error("Could not mark failed ballot receipt:", failureError);
            }

            results.push({
              status: "anchor_failed",
              ballot_id: ballotId,
              tx_hash: transactionHash,
            });
          }
        }
      }
    }

    for (let attempt = 0; attempt < MAX_BALLOTS_PER_RUN; attempt++) {
      const leaseOwner = crypto.randomUUID();
      const { data: leaseAcquired, error: leaseError } = await adminClient.rpc(
        "acquire_ballot_anchor_signer_lease",
        {
          p_owner_token: leaseOwner,
          p_lease_seconds: SIGNER_LEASE_SECONDS,
        },
      );

      if (leaseError) {
        console.error("Signer lease acquisition failed:", leaseError);
        results.push({
          status: "signer_lease_failed",
          error: "Could not acquire signer lease.",
        });
        break;
      }

      if (leaseAcquired !== true) {
        results.push({
          status: "signer_busy",
          message: "Another ballot anchor worker is currently using the signer.",
        });
        break;
      }

      let leaseReleased = false;

      try {
        const { data: claimedRows, error: claimError } = await adminClient.rpc(
          "claim_next_ballot_anchor",
        );

        if (claimError) {
          console.error("Ballot anchor claim failed:", claimError);
          results.push({
            status: "claim_failed",
            error: "Could not claim ballot anchor work.",
          });
          break;
        }

        const claimed = Array.isArray(claimedRows) ? claimedRows[0] : null;

        if (!claimed) {
          break;
        }

        const ballotId = String(claimed.ballot_id || "");
        const ballotHash = String(claimed.ballot_hash || "");

        try {
          if (!isValidBytes32Hash(ballotHash)) {
            throw new Error("Invalid ballot hash.");
          }

          const alreadyRecorded = await contract.isVoteHashRecorded(ballotHash);

          if (alreadyRecorded) {
            const { error: manualReviewError } = await adminClient.rpc(
              "mark_ballot_manual_review",
              {
                p_ballot_id: ballotId,
                p_ballot_hash: ballotHash,
                p_reason:
                  "Ballot hash already exists on-chain, but transaction metadata is unavailable from this worker path.",
              },
            );

            if (manualReviewError) {
              console.error("Could not mark ballot for manual review:", manualReviewError);
              results.push({
                status: "manual_review_transition_failed",
                ballot_id: ballotId,
              });
              break;
            }

            results.push({
              status: "manual_review_required",
              ballot_id: ballotId,
              message: "Ballot hash already exists on-chain and requires manual review.",
            });
            continue;
          }

          const signerBalance = await provider.getBalance(signerAddress);
          const requiredBalance = await estimateRequiredBalanceWei(
            contract,
            provider,
            ballotHash,
          );

          if (signerBalance < requiredBalance) {
            throw new Error("Signer wallet balance is too low for a safe Sepolia transaction attempt.");
          }

          const tx = await contract.recordVoteHash(ballotHash);

          const { error: submittedError } = await adminClient.rpc(
            "mark_ballot_anchor_submitted",
            {
              p_ballot_id: ballotId,
              p_ballot_hash: ballotHash,
              p_transaction_hash: tx.hash,
              p_network: NETWORK_NAME,
              p_contract_address: registryAddress,
            },
          );

          if (submittedError) {
            console.error("Ballot tx submitted but DB tx hash persistence failed:", submittedError);
            const { error: manualReviewError } = await adminClient.rpc(
              "mark_ballot_manual_review",
              {
                p_ballot_id: ballotId,
                p_ballot_hash: ballotHash,
                p_reason:
                  `Blockchain transaction was submitted, but tx hash persistence failed. Transaction hash: ${tx.hash}`,
              },
            );

            if (manualReviewError) {
              console.error(
                "Could not mark ballot for manual review after tx persistence failure:",
                manualReviewError,
              );
            }

            results.push({
              status: "blockchain_submitted_db_persist_failed",
              ballot_id: ballotId,
              tx_hash: tx.hash,
            });
            break;
          }

          const { error: releaseBeforeWaitError } = await adminClient.rpc(
            "release_ballot_anchor_signer_lease",
            {
              p_owner_token: leaseOwner,
            },
          );

          leaseReleased = true;

          if (releaseBeforeWaitError) {
            console.error("Signer lease release before receipt wait failed:", releaseBeforeWaitError);
          }

          const receipt = await waitForReceiptWithTimeout(tx);

          if (!receipt) {
            results.push({
              status: "submitted",
              ballot_id: ballotId,
              tx_hash: tx.hash,
              message: "Transaction hash persisted; confirmation will be reconciled later.",
            });
            continue;
          }

          if (receipt.status !== 1) {
            throw new Error("Blockchain transaction receipt returned a failed status.");
          }

          const { error: successError } = await adminClient.rpc(
            "mark_ballot_anchor_success",
            {
              p_ballot_id: ballotId,
              p_ballot_hash: ballotHash,
              p_transaction_hash: tx.hash,
              p_block_number: Number(receipt.blockNumber),
              p_anchored_at: new Date().toISOString(),
            },
          );

          if (successError) {
            console.error("Ballot blockchain succeeded but DB finalization failed:", successError);
            results.push({
              status: "blockchain_recorded_db_finalize_failed",
              ballot_id: ballotId,
              tx_hash: tx.hash,
            });
            break;
          }

          results.push({
            status: "anchored",
            ballot_id: ballotId,
            tx_hash: tx.hash,
            block_number: Number(receipt.blockNumber),
          });
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          const permanent = isPermanentBlockchainError(errorMessage);

          const { error: failureError } = await adminClient.rpc(
            "mark_ballot_anchor_failure",
            {
              p_ballot_id: ballotId,
              p_ballot_hash: ballotHash,
              p_error: errorMessage,
              p_permanent: permanent,
            },
          );

          if (failureError) {
            console.error("Could not mark ballot anchor failure:", failureError);
          }

          console.error("Ballot blockchain anchoring failed:", error);

          results.push({
            status: permanent ? "manual_review_required" : "anchor_failed",
            ballot_id: ballotId,
            error: "Ballot blockchain anchoring failed.",
          });
          break;
        }
      } finally {
        if (!leaseReleased) {
          const { error: releaseError } = await adminClient.rpc(
            "release_ballot_anchor_signer_lease",
            {
              p_owner_token: leaseOwner,
            },
          );

          if (releaseError) {
            console.error("Signer lease release failed:", releaseError);
          }
        }
      }
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error("Ballot anchor worker failed:", error);
    return jsonResponse({
      ok: false,
      error: isPermanentBlockchainError(errorMessage)
        ? errorMessage
        : "Ballot anchor worker failed.",
    }, 500);
  }

  if (results.length === 0) {
    return jsonResponse({
      ok: true,
      status: "idle",
      processed: 0,
      message: "No pending ballot hashes to anchor.",
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
