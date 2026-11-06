// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAegisExecutionManager
 * @notice Interface for AegisNet execution orchestration and human approval gatekeeper
 */
interface IAegisExecutionManager {
    struct ExecutionRequest {
        bytes32 requestId;
        address agentAddress;
        address targetContract;
        bytes callData;
        uint256 valueUSD;
        uint256 createdAt;
        uint256 deadline;
        bool isVerified;
        bool isExecuted;
        bool isCancelled;
    }

    event ExecutionRequested(
        bytes32 indexed requestId,
        address indexed agent,
        address indexed targetContract,
        uint256 valueUSD,
        bool requiresBiometrics
    );
    event ExecutionApproved(
        bytes32 indexed requestId,
        uint256 indexed nullifierHash
    );
    event ExecutionExecuted(
        bytes32 indexed requestId,
        address indexed targetContract,
        bool success,
        bytes returnData
    );
    event ExecutionCancelled(bytes32 indexed requestId);
    event RelayerSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event OwnerNullifierBound(address indexed owner, uint256 indexed nullifier);

    function setRelayerSigner(address _signer) external;
    function relayerSigner() external view returns (address);

    function bindOwnerNullifier(address ownerAddress, uint256 nullifier) external;
    function ownerToNullifier(address ownerAddress) external view returns (uint256);
    function nullifierToOwner(uint256 nullifier) external view returns (address);

    function requestExecution(
        address targetContract,
        bytes calldata callData,
        uint256 valueUSD
    ) external returns (bytes32 requestId, bool requiresBiometrics);

    function approveWithRelayer(
        bytes32 requestId,
        uint256 nullifierHash,
        bytes calldata signature
    ) external;

    function verifyBiometricsWithRelayer(
        bytes32 requestId,
        uint256 nullifierHash,
        bytes calldata signature
    ) external;

    function executeVerifiedTransaction(
        bytes32 requestId
    ) external returns (bool success, bytes memory returnData);

    function cancelExecution(bytes32 requestId) external;

    function isRequestPending(bytes32 requestId) external view returns (bool);

    function isRequestReadyForExecution(bytes32 requestId) external view returns (bool);

    function isRequestExpired(bytes32 requestId) external view returns (bool);

    function isNullifierUsed(uint256 nullifierHash) external view returns (bool);

    function getExecutionRequest(bytes32 requestId) external view returns (ExecutionRequest memory);

    function EXECUTION_EXPIRY_DURATION() external view returns (uint256);
}

