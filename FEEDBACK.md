# Uniswap Developer Experience Feedback

**Project:** AegisNet — Autonomous Agent DeFi Matrix & Human Approval Gate  
**Integration:** Real Uniswap V3 Token Swaps via `AegisUniswapAdapter` & `SwapRouter02`  
**Network:** Ethereum Sepolia (Chain ID `11155111`)  
**Target Contract:** Uniswap SwapRouter02 (`0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`)  
**Reference Docs:** [Uniswap Developer Documentation](https://developers.uniswap.org/docs) & [V3 Deployments](https://docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments)  
**Date:** November 2026  

---

## 1. Executive Summary

AegisNet integrates real on-chain decentralized exchange liquidity for autonomous AI agents on Ethereum Sepolia. Using [`AegisUniswapAdapter.sol`](contracts/contracts/AegisUniswapAdapter.sol) and [`ISwapRouter02.sol`](contracts/contracts/interfaces/ISwapRouter02.sol), the protocol routes agent-directed trades through official Uniswap V3 liquidity contracts.

This feedback document captures our honest developer assessment of Uniswap's documentation, contract architecture, SDKs, and testnet ergonomics when integrating contract-to-contract swaps from an autonomous agent gateway.

---

## 2. What Worked Well

1. **Canonical Deployment Tables:**  
   The Ethereum deployments reference page ([`docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments`](https://docs.uniswap.org/contracts/v3/reference/deployments/ethereum-deployments)) clearly provided the official addresses for Sepolia:
   * **SwapRouter02:** `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`
   * **Universal Router:** `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b`
   * **Permit2:** `0x000000000022D473030F116dDEE9F6B43aC78BA3`
   * **WETH9:** `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`
   * **QuoterV2:** `0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3`

2. **`SwapRouter02.exactInputSingle` Contract Interface:**  
   The `ExactInputSingleParams` struct is clean and well-structured for on-chain contract invocations:
   ```solidity
   struct ExactInputSingleParams {
       address tokenIn;
       address tokenOut;
       uint24 fee;
       address recipient;
       uint256 amountIn;
       uint256 amountOutMinimum;
       uint160 sqrtPriceLimitX96;
   }
   ```
   Directly specifying `recipient` allowed [`AegisUniswapAdapter.sol`](contracts/contracts/AegisUniswapAdapter.sol#L162-L177) to route output tokens directly to the user or agent treasury without intermediate custody or extra token transfers.

3. **Standard Fee Tiers:**  
   The three standardized fee tiers (`500` for 0.05%, `3000` for 0.3%, and `10000` for 1%) simplify rule-based and AI-driven trade formulation.

4. **Slippage Enforcement:**  
   Native revert handling when `amountOut < amountOutMinimum` provides robust, on-chain protection against sandwich attacks and execution slippage.

---

## 3. What Was Missing & Friction Encountered

### 3.1 Migration Confusion: `SwapRouter` vs `SwapRouter02` vs `UniversalRouter`
* **Issue:** Documentation across `developers.uniswap.org` and legacy guides often mixes code snippets between:
  1. Legacy `SwapRouter` (from `@uniswap/v3-periphery`), which includes `uint256 deadline` inside `ExactInputSingleParams`.
  2. `SwapRouter02` (from `@uniswap/swap-router-contracts`), which omits `deadline` from `ExactInputSingleParams` and relies on multicall.
  3. `UniversalRouter`, which uses packed bytecode command vectors (`execute(bytes commands, bytes[] inputs)`).
* **Impact:** Developers writing contract integrations encounter compilation errors if using interface files from `@uniswap/v3-periphery` against modern Sepolia deployments.
* **Suggestion:** Add a prominent callout banner distinguishing contract-to-contract interfaces across router versions.

### 3.2 Over-Reliance on Permit2 in Universal Router for Smart Contracts
* **Issue:** The official Uniswap developer guides recommend `UniversalRouter` as the modern entry point. However, `UniversalRouter` is heavily coupled with `Permit2`. While Permit2 is great for user EOA wallets signing off-chain gasless permits in browsers, it adds unnecessary complexity and overhead for autonomous smart contracts executing on behalf of subname agents.
* **Solution:** We selected `SwapRouter02` (`0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`) because it natively supports standard ERC-20 `approve` and `transferFrom` flows cleanly.

### 3.3 Testnet Liquidity & Pool Fragmentation on Sepolia
* **Issue:** While contracts are deployed to Sepolia, testnet liquidity in V3 pools is often sparse or dried up. Multiple faucet USDC versions exist on Sepolia (Circle's native testnet USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` vs various community faucets), leading to pools with zero reserves.
* **Solution:** We built [`MockSwapRouter02.sol`](contracts/contracts/mocks/MockSwapRouter02.sol) for unit tests with full ERC-20 balance accounting, and configured Hardhat forking for live pool execution.

### 3.4 Uniswap Trading API Testnet Support
* **Issue:** The Uniswap Trading API (`https://api.uniswap.org`) is powerful for production quotes and routing on Mainnet, Arbitrum, Base, and Optimism, but testnet support for Sepolia is limited or requires private API access keys.
* **Suggestion:** Offer a free, public sandbox tier of the Routing API with mock testnet quote vectors.

---

## 4. Key Recommendations for Uniswap DevRel

1. **Publish a "Smart Contract Integration" Quickstart:**  
   Most guides assume a React frontend using `wagmi` or the Uniswap SDK. A simple Solidity-to-Solidity guide demonstrating `IERC20.approve` + `SwapRouter02.exactInputSingle` would save hours of trial and error.
2. **Provide Official Mock Contracts in NPM:**  
   Publishing an official `@uniswap/v3-test-utils` or `@uniswap/mock-router` package with pre-funded local pool fixtures would streamline dApp testing.
3. **Canonical Sepolia Faucet Token Guide:**  
   Clearly document the specific Sepolia token addresses that have active liquidity pools on testnet Uniswap V3.

---

## 5. Conclusion

For contract-to-contract DeFi execution, **Uniswap `SwapRouter02` is outstanding, fast, and rock-solid**. Once the interface nuances are navigated, it provides reliable on-chain execution with zero token custody risk.
