// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ISwapRouter02.sol";
import "./interfaces/IERC20.sol";

/**
 * @title AegisUniswapAdapter
 * @notice Real Uniswap V3 execution adapter for AegisNet on Ethereum Sepolia
 * @dev Interacts with official Uniswap SwapRouter02 (0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E)
 * using real ERC-20 transferFrom, token approvals, and slippage protection.
 */
contract AegisUniswapAdapter {
    address public immutable manager;
    address public owner;

    // Canonical Uniswap SwapRouter02 on Sepolia (Chain ID 11155111)
    address public constant SEPOLIA_SWAP_ROUTER02 = 0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E;
    address public swapRouter;

    // Legacy SwapVM opcode mapping (for backwards-compatibility)
    uint8 public constant OP_EXCHANGE_SWAP = 0x01;
    uint8 public constant OP_SPLIT_ROUTE = 0x02;
    uint8 public constant OP_VERIFY_MIN_OUTPUT = 0x03;
    uint8 public constant OP_UNISWAP_V4_HOP = 0x04;
    uint8 public constant OP_AQUA_DEPOSIT = 0x05;    // Labeled OUT OF SCOPE
    uint8 public constant OP_AQUA_WITHDRAW = 0x06;   // Labeled OUT OF SCOPE

    struct SwapInstruction {
        uint8 opcode;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        bytes extraData;
    }

    event UniswapSwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOut,
        address indexed recipient
    );

    event SwapRouterUpdated(address indexed oldRouter, address indexed newRouter);
    event SwapVMExecuted(address indexed srcToken, address indexed dstToken, uint256 inputAmount, uint256 outputAmount);

    modifier onlyManager() {
        require(msg.sender == manager, "UniswapAdapter: caller is not AegisExecutionManager");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "UniswapAdapter: caller is not owner");
        _;
    }

    constructor(address _manager, address _swapRouter) {
        require(_manager != address(0), "Invalid manager address");
        manager = _manager;
        owner = msg.sender;
        swapRouter = _routerOrDefault(_swapRouter);
    }

    function _routerOrDefault(address _router) internal pure returns (address) {
        return _router == address(0) ? SEPOLIA_SWAP_ROUTER02 : _router;
    }

    function setSwapRouter(address _newRouter) external onlyOwner {
        require(_newRouter != address(0), "Invalid router address");
        emit SwapRouterUpdated(swapRouter, _newRouter);
        swapRouter = _newRouter;
    }

    /**
     * @notice Execute a real Uniswap V3 swap via SwapRouter02
     * @param params ExactInputSingleParams containing tokens, fee, recipient, and slippage bound
     * @param payer Source of tokenIn (caller, user, or adapter balance)
     */
    function executeExactInputSingle(
        ISwapRouter02.ExactInputSingleParams calldata params,
        address payer
    ) external onlyManager returns (uint256 amountOut) {
        return _performUniswapSwap(params, payer);
    }

    /**
     * @notice Helper to construct and execute exactInputSingle with individual arguments
     */
    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        address recipient,
        address payer
    ) external onlyManager returns (uint256 amountOut) {
        ISwapRouter02.ExactInputSingleParams memory params = ISwapRouter02.ExactInputSingleParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: fee == 0 ? 3000 : fee,
            recipient: recipient,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: 0
        });

        return _performUniswapSwap(params, payer);
    }

    /**
     * @notice Backward-compatible execution router for AI Agent strategy calls
     * @dev Replaces fake mathematical simulation with REAL on-chain Uniswap swaps
     */
    function executeSwapVMRoute(
        bytes calldata encodedInstructions
    ) external onlyManager returns (uint256 finalOutputAmount) {
        SwapInstruction[] memory instructions = abi.decode(encodedInstructions, (SwapInstruction[]));
        require(instructions.length > 0, "UniswapAdapter: empty instructions");

        for (uint256 i = 0; i < instructions.length; i++) {
            SwapInstruction memory instr = instructions[i];

            if (instr.opcode == OP_EXCHANGE_SWAP || instr.opcode == OP_SPLIT_ROUTE || instr.opcode == OP_UNISWAP_V4_HOP) {
                // Decode recipient from extraData if provided, otherwise default to manager
                address recipient = msg.sender;
                address payer = msg.sender;
                uint24 fee = 3000;

                if (instr.extraData.length >= 20) {
                    recipient = abi.decode(instr.extraData, (address));
                }

                ISwapRouter02.ExactInputSingleParams memory params = ISwapRouter02.ExactInputSingleParams({
                    tokenIn: instr.tokenIn,
                    tokenOut: instr.tokenOut,
                    fee: fee,
                    recipient: recipient,
                    amountIn: instr.amountIn,
                    amountOutMinimum: instr.minAmountOut,
                    sqrtPriceLimitX96: 0
                });

                finalOutputAmount = _performUniswapSwap(params, payer);
            } else if (instr.opcode == OP_VERIFY_MIN_OUTPUT) {
                require(finalOutputAmount >= instr.minAmountOut, "UniswapAdapter: minimum output threshold breached");
            } else if (instr.opcode == OP_AQUA_DEPOSIT || instr.opcode == OP_AQUA_WITHDRAW) {
                revert("UniswapAdapter: 1inch Aqua opcodes are OUT OF SCOPE. Real swaps route through Uniswap V3.");
            } else {
                revert("UniswapAdapter: unknown opcode");
            }

            emit SwapVMExecuted(instr.tokenIn, instr.tokenOut, instr.amountIn, finalOutputAmount);
        }

        return finalOutputAmount;
    }

    function _performUniswapSwap(
        ISwapRouter02.ExactInputSingleParams memory params,
        address payer
    ) internal returns (uint256 amountOut) {
        require(params.tokenIn != address(0), "UniswapAdapter: zero tokenIn");
        require(params.tokenOut != address(0), "UniswapAdapter: zero tokenOut");
        require(params.recipient != address(0), "UniswapAdapter: zero recipient");
        require(params.amountIn > 0, "UniswapAdapter: zero amountIn");

        // 1. Pull tokenIn into this adapter via real transferFrom
        if (payer != address(this)) {
            bool pulled = IERC20(params.tokenIn).transferFrom(payer, address(this), params.amountIn);
            require(pulled, "UniswapAdapter: tokenIn transferFrom failed");
        }

        // 2. Real ERC-20 approval for Uniswap SwapRouter02
        IERC20(params.tokenIn).approve(swapRouter, 0);
        IERC20(params.tokenIn).approve(swapRouter, params.amountIn);

        // 3. Track recipient's initial balance to verify real token delivery
        uint256 balanceBefore = IERC20(params.tokenOut).balanceOf(params.recipient);

        // 4. Execute the real swap on Uniswap SwapRouter02
        amountOut = ISwapRouter02(swapRouter).exactInputSingle(params);

        // 5. Verify real token delivery and slippage
        uint256 balanceAfter = IERC20(params.tokenOut).balanceOf(params.recipient);
        require(balanceAfter >= balanceBefore + params.amountOutMinimum, "UniswapAdapter: slippage threshold breached");

        emit UniswapSwapExecuted(
            params.tokenIn,
            params.tokenOut,
            params.fee,
            params.amountIn,
            amountOut,
            params.recipient
        );

        return amountOut;
    }
}

