import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Clock,
  ExternalLink,
  Link2,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import {
  checkVoteHashOnChain,
  connectBlockchainWallet,
  getBlockchainConfig,
  getBlockchainExplorerTxUrl,
  getVoteRegistryContract,
  recordVoteHashOnChain,
} from "../../utils/blockchain";

function BlockchainVerification() {
  const [votes, setVotes] = useState([]);
  const [walletAddress, setWalletAddress] = useState("");
  const [contractOwner, setContractOwner] = useState("");
  const [walletError, setWalletError] = useState("");
  const [loading, setLoading] = useState(true);
  const [recordingId, setRecordingId] = useState(null);
  const [verifyingId, setVerifyingId] = useState(null);

  const { contractAddress } = getBlockchainConfig();

  useEffect(() => {
    fetchVotes();
  }, []);

  async function fetchVotes() {
    setLoading(true);

    const { data, error } = await supabase
      .from("votes")
      .select(`
        *,
        students (
          student_number,
          first_name,
          last_name
        ),
        elections (
          title
        ),
        positions (
          name
        )
      `)
      .order("id", { ascending: false });

    if (!error) {
      setVotes(data || []);
    }

    setLoading(false);
  }

  async function connectWallet() {
    try {
      setWalletError("");
      const { signer, address } = await connectBlockchainWallet();
      const contract = getVoteRegistryContract(signer);
      const owner = await contract.owner();
      setWalletAddress(address);
      setContractOwner(owner);
    } catch (error) {
      setWalletError(error.message || "Failed to connect blockchain wallet.");
    }
  }

  async function recordVote(vote) {
    try {
      setRecordingId(vote.id);
      setWalletError("");

      const { signer } = await connectBlockchainWallet();
      const contract = getVoteRegistryContract(signer);
      const { txHash } = await recordVoteHashOnChain(contract, vote.vote_hash);

      const { error } = await supabase
        .from("votes")
        .update({ blockchain_tx_id: txHash })
        .eq("id", vote.id);

      if (error) {
        throw new Error(error.message || "Failed to save blockchain transaction.");
      }

      await fetchVotes();
    } catch (error) {
      setWalletError(error.message || "Failed to record vote on Sepolia.");
    } finally {
      setRecordingId(null);
    }
  }

  async function verifyVote(vote) {
    try {
      setVerifyingId(vote.id);
      setWalletError("");

      const { provider } = await connectBlockchainWallet();
      const contract = getVoteRegistryContract(provider);
      const recorded = await checkVoteHashOnChain(contract, vote.vote_hash);

      alert(
        recorded
          ? "Vote hash is recorded on the Sepolia contract."
          : "Vote hash is not recorded on the Sepolia contract yet.",
      );
    } catch (error) {
      setWalletError(error.message || "Failed to verify vote hash on-chain.");
    } finally {
      setVerifyingId(null);
    }
  }

  const verified = votes.filter((vote) => vote.blockchain_tx_id).length;
  const pending = votes.filter((vote) => !vote.blockchain_tx_id && vote.vote_hash).length;
  const missingHash = votes.filter((vote) => !vote.vote_hash).length;

  const contractState = useMemo(() => {
    if (!contractAddress) return "Missing contract";
    if (!walletAddress) return "Wallet disconnected";
    return "Wallet connected";
  }, [contractAddress, walletAddress]);

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="page-kicker">Sepolia Verification</div>
          <h1 className="page-title">
            Blockchain
            <span className="page-title-accent"> registry monitor</span>
          </h1>
          <p className="page-subtitle">
            Connect a Sepolia wallet, push pending vote hashes to the vote registry
            contract, and confirm the transaction hash stored with each ballot.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <button onClick={connectWallet} className="secondary-btn">
            <Wallet size={18} />
            {walletAddress ? "Reconnect Wallet" : "Connect Sepolia Wallet"}
          </button>
          <button
            onClick={() => {
              fetchVotes();
            }}
            className="primary-btn"
          >
            <RefreshCw size={18} />
            Refresh
          </button>
        </div>
      </div>

      <div className="section-grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        <div className="metric-card lift-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                Verified Records
              </p>
              <h2 className="mt-4 text-4xl font-black">{verified}</h2>
            </div>
            <ShieldCheck className="text-[#36936f]" />
          </div>
        </div>

        <div className="metric-card lift-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                Pending On-Chain
              </p>
              <h2 className="mt-4 text-4xl font-black">{pending}</h2>
            </div>
            <Clock className="text-[#c98a22]" />
          </div>
        </div>

        <div className="metric-card lift-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                Missing Hash
              </p>
              <h2 className="mt-4 text-4xl font-black">{missingHash}</h2>
            </div>
            <AlertTriangle className="text-[#cb4f58]" />
          </div>
        </div>

        <div className="metric-card lift-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                Contract State
              </p>
              <h2 className="mt-4 text-xl font-black">{contractState}</h2>
            </div>
            <Link2 className="text-[#11806a]" />
          </div>
        </div>
      </div>

      <div className="section-grid grid-cols-1 xl:grid-cols-[0.88fr_1.12fr]">
        <div className="trust-card">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white/10 p-3 text-[#9ce7dd]">
              <Wallet size={22} />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                Active Wallet
              </p>
              <h2 className="mt-1 text-2xl font-black">Sepolia writer access</h2>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <div className="rounded-2xl bg-white/8 px-4 py-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                Contract Address
              </p>
              <p className="mt-2 break-all text-sm text-white/78">
                {contractAddress || "Set VITE_VOTE_REGISTRY_ADDRESS in the frontend env."}
              </p>
            </div>
            <div className="rounded-2xl bg-white/8 px-4 py-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                Wallet Address
              </p>
              <p className="mt-2 break-all text-sm text-white/78">
                {walletAddress || "No wallet connected"}
              </p>
            </div>
            <div className="rounded-2xl bg-white/8 px-4 py-4">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">
                Contract Owner
              </p>
              <p className="mt-2 break-all text-sm text-white/78">
                {contractOwner || "Unknown until wallet connects"}
              </p>
            </div>
          </div>

          {walletError ? (
            <div className="mt-4 rounded-2xl bg-[rgba(203,79,88,0.14)] px-4 py-3 text-sm text-white">
              {walletError}
            </div>
          ) : null}
        </div>

        <div className="soft-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
                Blockchain Flow
              </p>
              <h3 className="mt-2 text-2xl font-black">How this integration works</h3>
            </div>
            <span className="status-pill">Hardhat + Ethers</span>
          </div>

          <div className="mt-6 space-y-3">
            {[
              "Student voting still writes ballots to Supabase first, including a deterministic vote hash.",
              "The blockchain page connects a Sepolia wallet and records the pending hash to the VoteRegistry contract.",
              "The returned transaction hash is saved back to votes.blockchain_tx_id for receipt and audit visibility.",
              "Anyone with the hash and contract can later verify whether the ballot proof exists on-chain.",
            ].map((item) => (
              <div key={item} className="info-row !items-start">
                <p className="compact-copy text-[#102220]">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="section-grid grid-cols-1">
        <div className="table-shell">
          <div className="border-b border-[rgba(104,86,72,0.08)] px-6 py-5">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#55726b]">
              Vote Registry Queue
            </p>
            <h3 className="mt-2 text-xl font-black">Pending and verified vote hashes</h3>
          </div>

          {loading ? (
            <div className="px-6 py-8 text-sm text-gray-500">Loading blockchain records...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="table-head text-white">
                  <tr>
                    <th className="px-6 py-4">Voter</th>
                    <th className="px-6 py-4">Election</th>
                    <th className="px-6 py-4">Position</th>
                    <th className="px-6 py-4">Vote Hash</th>
                    <th className="px-6 py-4">Transaction</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {votes.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="px-6 py-10 text-center text-gray-500">
                        No vote records found.
                      </td>
                    </tr>
                  ) : (
                    votes.map((vote) => {
                      const status = vote.blockchain_tx_id
                        ? "Verified"
                        : vote.vote_hash
                          ? "Pending"
                          : "Missing Hash";

                      return (
                        <tr key={vote.id} className="border-b border-[rgba(104,86,72,0.08)] last:border-b-0">
                          <td className="px-6 py-4">
                            <p className="font-bold">
                              {vote.students?.first_name} {vote.students?.last_name}
                            </p>
                            <p className="text-xs text-gray-500">{vote.students?.student_number}</p>
                          </td>
                          <td className="px-6 py-4">{vote.elections?.title || "-"}</td>
                          <td className="px-6 py-4">{vote.positions?.name || "-"}</td>
                          <td className="px-6 py-4 text-xs font-mono">
                            <span className="block max-w-[240px] truncate">{vote.vote_hash || "-"}</span>
                          </td>
                          <td className="px-6 py-4 text-xs font-mono">
                            {vote.blockchain_tx_id ? (
                              <a
                                href={getBlockchainExplorerTxUrl(vote.blockchain_tx_id)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-2 text-[#11806a] underline-offset-2 hover:underline"
                              >
                                <ExternalLink size={13} />
                                <span className="max-w-[180px] truncate">{vote.blockchain_tx_id}</span>
                              </a>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-xs font-bold uppercase ${
                                status === "Verified"
                                  ? "bg-[rgba(54,147,111,0.14)] text-[#25704f]"
                                  : status === "Pending"
                                    ? "bg-[rgba(208,138,34,0.14)] text-[#9a6518]"
                                    : "bg-[rgba(203,79,88,0.14)] text-[#a23846]"
                              }`}
                            >
                              {status}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex justify-end gap-2">
                              {!vote.blockchain_tx_id && vote.vote_hash ? (
                                <button
                                  onClick={() => recordVote(vote)}
                                  disabled={recordingId === vote.id}
                                  className="primary-btn !w-auto !px-3 !py-2 text-sm"
                                >
                                  {recordingId === vote.id ? "Recording..." : "Record On-Chain"}
                                </button>
                              ) : null}
                              {vote.vote_hash ? (
                                <button
                                  onClick={() => verifyVote(vote)}
                                  disabled={verifyingId === vote.id}
                                  className="secondary-btn !w-auto !px-3 !py-2 text-sm"
                                >
                                  {verifyingId === vote.id ? "Checking..." : "Verify"}
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default BlockchainVerification;
