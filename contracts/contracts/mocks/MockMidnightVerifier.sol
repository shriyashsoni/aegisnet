// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IMidnightVerifier.sol";

contract MockMidnightVerifier is IMidnightVerifier {
    bool public shouldPass = true;

    function setShouldPass(bool _pass) external {
        shouldPass = _pass;
    }

    function verifyMidnightProof(
        bytes32,
        bytes32,
        uint256,
        bytes32,
        bytes calldata
    ) external view override returns (bool) {
        require(shouldPass, "MockMidnightVerifier: invalid Midnight ZK proof");
        return true;
    }
}
