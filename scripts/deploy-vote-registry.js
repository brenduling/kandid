import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";

const rpcUrl = process.env.SEPOLIA_RPC_URL;
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;

if (!rpcUrl || !privateKey) {
  throw new Error("Missing SEPOLIA_RPC_URL or DEPLOYER_PRIVATE_KEY.");
}

const artifactPath = path.resolve(
  "artifacts",
  "contracts",
  "KandidVoteRegistry.sol",
  "KandidVoteRegistry.json",
);

if (!fs.existsSync(artifactPath)) {
  throw new Error("Contract artifact not found. Run `npm run chain:compile` first.");
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);
const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

const contract = await factory.deploy();
await contract.waitForDeployment();

console.log("KandidVoteRegistry deployed");
console.log("address:", await contract.getAddress());
console.log("owner:", await contract.owner());
