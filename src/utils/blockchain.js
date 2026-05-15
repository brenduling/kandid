import { ethers } from "ethers";

const DEFAULT_ETHERSCAN_TX_BASE_URL = "https://sepolia.etherscan.io/tx/";
const SEPOLIA_CHAIN_ID = 11155111;

export const VOTE_REGISTRY_ABI = [
  "function owner() view returns (address)",
  "function recordVoteHash(bytes32 voteHash)",
  "function isVoteHashRecorded(bytes32 voteHash) view returns (bool)",
  "function getVoteRecord(bytes32 voteHash) view returns (tuple(bytes32 voteHash,uint256 recordedAt,address recorder))",
  "event VoteHashRecorded(bytes32 indexed voteHash, address indexed recorder, uint256 recordedAt)",
];

export function getBlockchainConfig() {
  return {
    chainId: Number(import.meta.env.VITE_SEPOLIA_CHAIN_ID || SEPOLIA_CHAIN_ID),
    contractAddress: import.meta.env.VITE_VOTE_REGISTRY_ADDRESS || "",
    explorerTxBaseUrl:
      import.meta.env.VITE_ETHERSCAN_TX_BASE_URL || DEFAULT_ETHERSCAN_TX_BASE_URL,
  };
}

export function getBlockchainExplorerTxUrl(txHash) {
  if (!txHash) return "";
  return `${getBlockchainConfig().explorerTxBaseUrl}${txHash}`;
}

export async function hashVoteRecord({
  studentId,
  electionId,
  positionId,
  candidateId,
  isAbstain,
  submittedAt,
}) {
  const normalized = JSON.stringify({
    studentId: Number(studentId),
    electionId: Number(electionId),
    positionId: Number(positionId),
    candidateId: candidateId == null ? null : Number(candidateId),
    isAbstain: Boolean(isAbstain),
    submittedAt,
  });

  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return `0x${Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function connectBlockchainWallet() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No Ethereum wallet found. Install MetaMask or a compatible wallet.");
  }

  const browserProvider = new ethers.BrowserProvider(window.ethereum);
  await browserProvider.send("eth_requestAccounts", []);
  const network = await browserProvider.getNetwork();
  const expectedChainId = BigInt(getBlockchainConfig().chainId);

  if (network.chainId !== expectedChainId) {
    throw new Error("Please switch your wallet to Ethereum Sepolia.");
  }

  const signer = await browserProvider.getSigner();

  return {
    provider: browserProvider,
    signer,
    address: await signer.getAddress(),
  };
}

export function getVoteRegistryContract(signerOrProvider) {
  const { contractAddress } = getBlockchainConfig();

  if (!contractAddress) {
    throw new Error("Missing VITE_VOTE_REGISTRY_ADDRESS in the frontend environment.");
  }

  return new ethers.Contract(contractAddress, VOTE_REGISTRY_ABI, signerOrProvider);
}

export async function recordVoteHashOnChain(contract, voteHash) {
  const tx = await contract.recordVoteHash(voteHash);
  const receipt = await tx.wait();

  return {
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber ?? null,
  };
}

export async function checkVoteHashOnChain(contract, voteHash) {
  return contract.isVoteHashRecorded(voteHash);
}
