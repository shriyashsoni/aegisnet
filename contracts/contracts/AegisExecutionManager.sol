// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IAegisSubnameRegistry.sol";

/**
 * @title AegisExecutionManager
 * @notice Central Orchestrator & Human Approval Gatekeeper
 * @dev Enforces guardrailed execution and human approval for autonomous AI agent transactions.
 */
contract AegisExecutionManager {
    IAegisSubnameRegistry public immutable registry;

    address public owner;
    address public relayerSigner; // Authorized relayer for off-chain verified human approval sessions

    // Governance & nullifier parameters
    uint256 public immutable externalNullifier;

    // Track used nullifiers to prevent replay attacks
    mapping(uint256 => bool) public usedNullifiers;

    // Pending Execution Request for Human Approval Interception
    struct ExecutionRequest {
        bytes32 requestId;
        address agentAddress;
        address targetContract;
        bytes callData;
        uint256 valueUSD;
        uint256 createdAt;
        bool isVerified;
        bool isExecuted;
        bool isCancelled;
    }

    mapping(bytes32 => ExecutionRequest) public executionRequests;

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
    event ExecutionExecuted(bytes32 indexed requestId, address indexed targetContract, bool success, bytes returnData);
    event ExecutionCancelled(bytes32 indexed requestId);

    modifier onlyOwner() {
        require(msg.sender == owner, "AegisManager: caller is not owner");
        _;
    }

    constructor(
        address _registry,
        uint256 _externalNullifier,
        address _relayerSigner
    ) {
        owner = msg.sender;
        registry = IAegisSubnameRegistry(_registry);
        externalNullifier = _externalNullifier;
        relayerSigner = _relayerSigner;
    }

    function setRelayerSigner(address _signer) external onlyOwner {
        relayerSigner = _signer;
    }

    /**
     * @notice Submit a proposed transaction execution from an autonomous AI agent
     * @param targetContract Whitelisted target contract address
     * @param callData Encoded call payload for swap/liquidity positioning
     * @param valueUSD Estimated transaction dollar value in 18 decimals
     */
    function requestExecution(
        address targetContract,
        bytes calldata callData,
        uint256 valueUSD
    ) external returns (bytes32 requestId, bool requiresBiometrics) {
        (bool isAllowed, bool biometricReq, bytes32 subnameNode) = registry.isAgentAuthorized(
            msg.sender,
            targetContract,
            valueUSD
        );

        require(isAllowed, "AegisManager: Agent or target not authorized by ENS EAC");

        requestId = keccak256(
            abi.encodePacked(
                msg.sender,
                targetContract,
                keccak256(callData),
                valueUSD,
                block.timestamp,
                block.chainid
            )
        );

        executionRequests[requestId] = ExecutionRequest({
            requestId: requestId,
            agentAddress: msg.sender,
            targetContract: targetContract,
            callData: callData,
            valueUSD: valueUSD,
            createdAt: block.timestamp,
            isVerified: !biometricReq, // Pre-verified if below threshold
            isExecuted: false,
            isCancelled: false
        });

        emit ExecutionRequested(requestId, msg.sender, targetContract, valueUSD, biometricReq);

        // If below threshold ($1,000), execute immediately atomically
        if (!biometricReq) {
            _executeTransaction(requestId, subnameNode);
        }

        return (requestId, biometricReq);
    }

    /**
     * @notice Approve execution via trusted relayer ECDSA signature
     * @param requestId Pending execution request ID
     * @param nullifierHash Single-use nullifier derived from human approval session
     * @param signature Cryptographic relayer signature attesting human approval
     */
    function approveWithRelayer(
        bytes32 requestId,
        uint256 nullifierHash,
        bytes calldata signature
    ) public {
        ExecutionRequest storage req = executionRequests[requestId];
        require(req.requestId != bytes32(0), "AegisManager: non-existent request");
        require(!req.isExecuted, "AegisManager: already executed");
        require(!req.isCancelled, "AegisManager: request cancelled");
        require(!usedNullifiers[nullifierHash], "AegisManager: nullifier used");

        bytes32 hash = keccak256(abi.encodePacked(requestId, nullifierHash, address(this), block.chainid));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));

        address recovered = recoverSigner(ethSignedHash, signature);
        require(recovered == relayerSigner, "AegisManager: invalid relayer signature");

        usedNullifiers[nullifierHash] = true;
        req.isVerified = true;

        emit ExecutionApproved(requestId, nullifierHash);
    }

    /**
     * @notice Backward-compatible alias for existing frontend/scripts
     */
    function verifyBiometricsWithRelayer(
        bytes32 requestId,
        uint256 nullifierHash,
        bytes calldata signature
    ) external {
        approveWithRelayer(requestId, nullifierHash, signature);
    }

    /**
     * @notice Execute an approved & verified transaction
     */
    function executeVerifiedTransaction(bytes32 requestId) external returns (bool success, bytes memory returnData) {
        ExecutionRequest storage req = executionRequests[requestId];
        require(req.isVerified, "AegisManager: pending human approval");
        require(!req.isExecuted, "AegisManager: request already executed");
        require(!req.isCancelled, "AegisManager: request cancelled");

        (, , bytes32 subnameNode) = registry.isAgentAuthorized(req.agentAddress, req.targetContract, req.valueUSD);
        return _executeTransaction(requestId, subnameNode);
    }

    /**
     * @notice Cancel pending execution (human owner fallback path)
     */
    function cancelExecution(bytes32 requestId) external {
        ExecutionRequest storage req = executionRequests[requestId];
        require(req.requestId != bytes32(0), "AegisManager: invalid request");
        require(!req.isExecuted, "AegisManager: request already executed");

        (, , bytes32 subnameNode) = registry.isAgentAuthorized(req.agentAddress, req.targetContract, req.valueUSD);
        IAegisSubnameRegistry.AgentPermissions memory perm = registry.getAgentPermissions(subnameNode);

        require(msg.sender == perm.ownerAddress || msg.sender == owner || msg.sender == perm.agentAddress, "AegisManager: unauthorized cancel");

        req.isCancelled = true;
        emit ExecutionCancelled(requestId);
    }

    function _executeTransaction(
        bytes32 requestId,
        bytes32 subnameNode
    ) internal returns (bool success, bytes memory returnData) {
        ExecutionRequest storage req = executionRequests[requestId];
        req.isExecuted = true;

        // Record spend in registry
        registry.recordSpend(subnameNode, req.valueUSD);

        // Forward call to whitelisted DeFi target contract
        (success, returnData) = req.targetContract.call(req.callData);
        require(success, "AegisManager: low level target call failed");

        emit ExecutionExecuted(requestId, req.targetContract, success, returnData);
    }

    /**
     * @notice Returns true if request exists and is awaiting human approval
     */
    function isRequestPending(bytes32 requestId) external view returns (bool) {
        ExecutionRequest storage req = executionRequests[requestId];
        return req.requestId != bytes32(0) && !req.isVerified && !req.isExecuted && !req.isCancelled;
    }

    /**
     * @notice Returns true if request is approved and ready to be executed
     */
    function isRequestReadyForExecution(bytes32 requestId) external view returns (bool) {
        ExecutionRequest storage req = executionRequests[requestId];
        return req.requestId != bytes32(0) && req.isVerified && !req.isExecuted && !req.isCancelled;
    }

    /**
     * @notice Returns true if nullifier has already been consumed
     */
    function isNullifierUsed(uint256 nullifierHash) external view returns (bool) {
        return usedNullifiers[nullifierHash];
    }

    /**
     * @notice Retrieve full execution request details
     */
    function getExecutionRequest(bytes32 requestId) external view returns (ExecutionRequest memory) {
        return executionRequests[requestId];
    }

    function recoverSigner(bytes32 messageHash, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        return ecrecover(messageHash, v, r, s);
    }
}
