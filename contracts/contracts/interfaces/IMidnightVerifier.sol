// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IMidnightVerifier
 * @notice Interface for Midnight Network Zero-Knowledge Proof Verifier on EVM
 * @dev Verifies SNARK proofs produced by Midnight Compact smart contracts
 */
interface IMidnightVerifier {
    /**
     * @notice Verify a Midnight ZK proof for confidential approval
     * @param proofHash Hash identifier of the zero-knowledge proof
     * @param requestId Unique identifier of the pending execution request
     * @param nullifierHash Single-use nullifier derived from Midnight private state
     * @param clearanceCommitment Commitment emitted by the Compact circuit
     * @param proof Serialized ZK proof payload
     */
    function verifyMidnightProof(
        bytes32 proofHash,
        bytes32 requestId,
        uint256 nullifierHash,
        bytes32 clearanceCommitment,
        bytes calldata proof
    ) external view returns (bool);
}
