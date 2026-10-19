const bytes32Pattern = /^0x[0-9a-f]{64}$/i;
const transactionHashPattern = /^0x[0-9a-f]{64}$/i;
const addressPattern = /^0x[0-9a-f]{40}$/i;

export class LegacyAnchorEvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LegacyAnchorEvidenceError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new LegacyAnchorEvidenceError(code, message);
}

function sameHex(first, second) {
  return typeof first === "string" && typeof second === "string" &&
    first.toLowerCase() === second.toLowerCase();
}

/** Validate chain evidence and return only values read from trusted RPC evidence/config. */
export async function verifyLegacyVoteAnchorEvidence({
  requestedTransactionHash,
  expectedVoteHash,
  expectedChainId,
  observedChainId,
  configuredContractAddress,
  receipt,
  parseRegistryEvent,
  isVoteHashRecorded,
  getBlock,
}) {
  if (!transactionHashPattern.test(String(requestedTransactionHash || "")) ||
      !bytes32Pattern.test(String(expectedVoteHash || "")) ||
      !addressPattern.test(String(configuredContractAddress || ""))) {
    fail("INVALID_INPUT", "Blockchain verification input is invalid.");
  }
  if (BigInt(observedChainId) !== BigInt(expectedChainId)) {
    fail("CHAIN_MISMATCH", "The configured RPC is not connected to the expected network.");
  }
  if (!receipt || Number(receipt.status) !== 1 || !sameHex(receipt.to, configuredContractAddress)) {
    fail("INVALID_RECEIPT", "The transaction is not a successful registry transaction.");
  }
  if (!transactionHashPattern.test(String(receipt.hash || "")) ||
      !sameHex(receipt.hash, requestedTransactionHash)) {
    fail("INVALID_RECEIPT", "The RPC receipt does not match the requested transaction.");
  }
  if (!Number.isSafeInteger(Number(receipt.blockNumber)) || Number(receipt.blockNumber) < 0 || !receipt.blockHash) {
    fail("INVALID_RECEIPT", "The transaction receipt has no valid block reference.");
  }

  let matchingEvent = false;
  for (const log of Array.isArray(receipt.logs) ? receipt.logs : []) {
    if (!sameHex(log.address, configuredContractAddress)) continue;
    try {
      const event = parseRegistryEvent(log);
      if (event?.name === "VoteHashRecorded" && sameHex(String(event.args?.voteHash || ""), expectedVoteHash)) {
        matchingEvent = true;
        break;
      }
    } catch {
      // Ignore unrelated or undecodable logs; the required matching event must exist.
    }
  }
  if (!matchingEvent) fail("EVENT_MISMATCH", "The receipt lacks the expected registry event.");

  let recorded;
  let block;
  try {
    [recorded, block] = await Promise.all([
      isVoteHashRecorded(expectedVoteHash),
      getBlock(Number(receipt.blockNumber)),
    ]);
  } catch {
    fail("RPC_UNAVAILABLE", "Blockchain evidence could not be retrieved.");
  }
  if (recorded !== true) fail("REGISTRY_MISMATCH", "The registry does not confirm this vote hash.");
  if (!block || Number(block.number) !== Number(receipt.blockNumber) ||
      !sameHex(block.hash, receipt.blockHash) ||
      !Number.isSafeInteger(Number(block.timestamp)) || Number(block.timestamp) < 0) {
    fail("BLOCK_MISMATCH", "The transaction block evidence is unavailable or inconsistent.");
  }

  return {
    transaction_hash: receipt.hash.toLowerCase(),
    contract_address: configuredContractAddress.toLowerCase(),
    block_number: Number(receipt.blockNumber),
    anchored_at: new Date(Number(block.timestamp) * 1000).toISOString(),
  };
}
