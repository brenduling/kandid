// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract KandidVoteRegistry {
    address public owner;

    struct VoteRecord {
        bytes32 voteHash;
        uint256 recordedAt;
        address recorder;
    }

    mapping(bytes32 => VoteRecord) private records;

    event VoteHashRecorded(bytes32 indexed voteHash, address indexed recorder, uint256 recordedAt);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function recordVoteHash(bytes32 voteHash) external onlyOwner {
        require(voteHash != bytes32(0), "Invalid hash");
        require(records[voteHash].recordedAt == 0, "Vote hash already recorded");

        records[voteHash] = VoteRecord({
            voteHash: voteHash,
            recordedAt: block.timestamp,
            recorder: msg.sender
        });

        emit VoteHashRecorded(voteHash, msg.sender, block.timestamp);
    }

    function isVoteHashRecorded(bytes32 voteHash) external view returns (bool) {
        return records[voteHash].recordedAt != 0;
    }

    function getVoteRecord(bytes32 voteHash) external view returns (VoteRecord memory) {
        require(records[voteHash].recordedAt != 0, "Vote hash not found");
        return records[voteHash];
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        require(nextOwner != address(0), "Invalid owner");
        owner = nextOwner;
    }
}
