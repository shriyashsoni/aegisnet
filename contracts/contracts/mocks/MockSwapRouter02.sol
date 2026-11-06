// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/ISwapRouter02.sol";
import "../interfaces/IERC20.sol";

/**
 * @title MockSwapRouter02
 * @notice Realistic mock of Uniswap SwapRouter02 for local and unit test execution
 * @dev Performs real ERC-20 transferFrom from caller and real transfer of tokenOut to recipient
 */
contract MockSwapRouter02 is ISwapRouter02 {
    uint256 public rateNumerator = 997; // 0.3% pool fee simulation (default V3 fee tier 3000)
    uint256 public rateDenominator = 1000;

    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address indexed recipient
    );

    function setExchangeRate(uint256 _numerator, uint256 _denominator) external {
        require(_denominator > 0, "Invalid denominator");
        rateNumerator = _numerator;
        rateDenominator = _denominator;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable override returns (uint256 amountOut) {
        require(params.tokenIn != address(0), "Invalid tokenIn");
        require(params.tokenOut != address(0), "Invalid tokenOut");
        require(params.recipient != address(0), "Invalid recipient");
        require(params.amountIn > 0, "Zero amountIn");

        // 1. Real ERC-20 pull from caller
        bool pulled = IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        require(pulled, "MockRouter: transferFrom failed");

        // 2. Real output computation
        amountOut = (params.amountIn * rateNumerator) / rateDenominator;
        require(amountOut >= params.amountOutMinimum, "MockRouter: slippage breached (Too little received)");

        // 3. Real ERC-20 delivery to recipient
        bool sent = IERC20(params.tokenOut).transfer(params.recipient, amountOut);
        require(sent, "MockRouter: transfer to recipient failed");

        emit SwapExecuted(params.tokenIn, params.tokenOut, params.amountIn, amountOut, params.recipient);
    }

    function exactInput(
        ExactInputParams calldata params
    ) external payable override returns (uint256 amountOut) {
        require(params.recipient != address(0), "Invalid recipient");
        require(params.amountIn > 0, "Zero amountIn");

        // Simple single-hop simulation for path
        amountOut = (params.amountIn * rateNumerator) / rateDenominator;
        require(amountOut >= params.amountOutMinimum, "MockRouter: slippage breached");
    }
}
