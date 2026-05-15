import "@nomicfoundation/hardhat-ethers";

const sepoliaUrl = process.env.SEPOLIA_RPC_URL || "";
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || "";

const networks = {};

if (sepoliaUrl) {
  networks.sepolia = {
    type: "http",
    url: sepoliaUrl,
    accounts: deployerKey ? [deployerKey] : [],
  };
}

export default {
  solidity: "0.8.24",
  networks,
};
