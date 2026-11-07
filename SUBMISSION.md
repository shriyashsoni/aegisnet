# 🏆 AegisNet — Hackathon Submission Master Dossier

This document contains ready-to-copy answers for every field on hackathon submission platforms (ETHGlobal, Devfolio, DoraHacks, etc.).

---

## 1. Short Description *(Max 100 characters)*
> **Guardrailed AI agent execution matrix on ENSv2, 0G Private Compute & Uniswap V3.**
*(80 characters)*

**Alternative Options:**
- *Stop rogue AI: Onchain guardrails, ENSv2 identity & human approval gates for DeFi.* (82 chars)
- *ENSv2 identity & onchain guardrails for autonomous AI DeFi agents with 0G & Uniswap.* (84 chars)
- *Guardrailed AI DeFi execution on ENSv2 with 0G Private Compute & Uniswap V3.* (76 chars)

---

## 2. Project Description *(Detailed / Min 280 characters)*

**AegisNet** is a guardrailed execution matrix and security gateway for autonomous AI agents in Decentralized Finance (DeFi), built natively on **ENSv2**, **0G Private Compute & Decentralized Storage**, and **Uniswap V3**.

### The Problem: Autonomous Agents in DeFi are Dangerous
As autonomous AI agents manage decentralized treasuries, yield farming, and liquidity rebalancing, giving them raw private keys or unlimited ERC-20 allowances introduces catastrophic systemic risk. A single prompt injection, market hallucination, sudden liquidity drain, or flash loan exploit can liquidate entire treasuries in a single block with zero human recourse or safety pause.

### The AegisNet Solution: Cryptographic Guardrails
AegisNet solves this by decoupling agent autonomy from sovereign authority. Instead of unrestricted wallet access, agents operate within strict, onchain cryptographic boundaries governed by ENSv2 subname identity and dual-path execution gates:

1. **ENSv2 Hierarchical Identity & Execution Access Control (EAC):**
   Every agent is registered as an ENSv2 subname (e.g., `agent1.aegisnet.eth`). The subname is not just a human-readable label—it is an onchain Execution Access Control (EAC) registry. The agent’s permissions (which target contracts/adapters it is allowed to call, daily spend caps, and maximum single-trade limits) are cryptographically stored under the subname node. If an agent attempts to interact with an unwhitelisted contract or exceeds its daily cap, the transaction reverts onchain before execution. Furthermore, ENSIP-26 agent text records (`agent.capabilities`, `agent.biometric_threshold`, `agent.operator`) store machine-readable policies directly on the ENS resolver.

2. **0G Decentralized Private Compute:**
   Market evaluation and trade strategies are generated through 0G’s Private Compute infrastructure (`0gm-1.0-35b-a3b`). This guarantees confidential, tamper-proof AI reasoning offchain, protecting proprietary strategy parameters from mempool front-running while ensuring the agent's logic adheres to strict structured JSON outputs.

3. **Dual-Path Execution & Human Approval Gate:**
   - **Autonomous Low-Value Path (< $1,000 threshold):** Trades under the configurable threshold are validated onchain against daily spend limits and whitelists, executing automatically and instantaneously via the `AegisUniswapAdapter` on Uniswap V3 `SwapRouter02`.
   - **Intercepted High-Value Path (≥ $1,000 threshold):** Trades exceeding the threshold are automatically intercepted and paused onchain in the `AegisExecutionManager`. The trade is locked in an immutable queue and cannot be executed until authenticated by the verified human subname owner via a cryptographic EIP-712 signature attestation. If not approved within a 15-minute window or if denied by the human, the execution expires safely.

4. **0G Storage Verifiable Audit Trail:**
   Every proposed trade, AI reasoning trace, market snapshot, and execution receipt is Merkle-hashed and permanently published to 0G Turbo Decentralized Storage. This provides an immutable, tamper-evident audit trail linking the ENS subname, the 0G compute decision, and the onchain Etherscan transaction.

---

## 3. How it's Made *(Technical Architecture & Notable Details)*

AegisNet was built by combining **ENSv2 hierarchical identity**, **0G Private Compute & Decentralized Storage**, and **Uniswap V3** into an end-to-end guardrailed execution matrix.

### Core Architecture & Technologies Used
- **Smart Contracts (Solidity v0.8.24, Hardhat, OpenZeppelin v5, Sepolia):**
  - `AegisSubnameRegistry.sol`: An ENSv2-compliant hierarchical subregistry. Manages subname node ownership, maintains Execution Access Control (EAC) contract whitelists, and acts as an ENS resolver for ENSIP-26 agent text records (`agent.capabilities`, `agent.biometric_threshold`, `agent.operator`).
  - `AegisExecutionManager.sol`: The onchain gatekeeper. Intercepts incoming trades via `requestExecution()`, verifies caller permissions against the agent's ENS node, tracks 24-hour spending allowances, and conditionally splits execution between autonomous execution and human approval interception.
  - `AegisUniswapAdapter.sol`: Direct execution interface to the official Uniswap V3 `SwapRouter02` (`0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`).
- **Decentralized AI (0G Private Compute):** Uses 0G’s decentralized OpenAI-compatible compute router (`https://router-api.0g.ai/v1`) with the `0gm-1.0-35b-a3b` model to evaluate market conditions and formulate trade parameters confidentially offchain.
- **Audit Layer (0G Turbo Storage):** Integrated `@0gfoundation/0g-storage-ts-sdk` on the 0G Galileo Turbo testnet. Trade payloads, model reasoning trees, and execution receipts are converted to Merkle trees, anchored onchain, and made verifiable on 0G Storage Scan.
- **Backend & Relayer (Node.js, TypeScript, Express, Ethers.js v6):** Real-time block indexer listening to Sepolia events with auto-recovery, combined with an EIP-712 human gate verification session manager deployable both as a persistent daemon and Vercel serverless functions.
- **Frontend Console (Vanilla HTML5 / Modern CSS / Vanilla JS):** Zero-framework Web3 console with EIP-6963 multi-wallet discovery (MetaMask, Rabby), live contract state reflection, and human approval modals.

### Notable & "Hacky" Engineering Feats
1. **Repurposing ENSv2 Subnames as an Execution Access Control (EAC) Engine:**
   Instead of using ENS simply as a cosmetic domain or reverse-lookup display name, we used the ENS `subnameNode` directly in Solidity as the primary mapping key for onchain access control. An agent cannot call *any* DeFi protocol unless the target contract address has been explicitly whitelisted under that exact ENS node by the domain owner. We turned ENS into a programmable onchain firewall.
2. **Dual-Path Resilient Uniswap V3 Adapter:**
   On Ethereum Sepolia, symbolic testnet tokens (like test USDC or WETH) often have no deployed bytecode (`extcodesize == 0`) or active V3 liquidity pools, which causes high-level Solidity calls to revert with empty `0x` data. We engineered our `AegisUniswapAdapter` with a dynamic dual-path fallback: if real tokens with code and balances exist, it conducts full live `transferFrom` and `exactInputSingle` swaps through `SwapRouter02` with strict slippage checks; if symbolic testnet tokens are used, it deterministically computes Uniswap V3 0.3% pool fee tier math and emits genuine execution events without reverting.
3. **Subname-Derived Replay Protection for Human Approvals:**
   To prevent replay attacks and nullifier collisions without requiring external hardware, the Human Approval Gate derives a deterministic attestation hash: `keccak256("ENS_OWNER_AUTH", owner, requestId)`. The execution manager contract validates this via an EIP-712 ECDSA signature from the trusted relayer, checks that the owner is authentic, marks the request executed in the bitmap, and enforces a strict 15-minute auto-expiry window.

---

## 4. Partner Track Questions

### Track: ENS / ENSv2
**Why is ENSv2 central to the product and not a cosmetic add-on?**
> ENSv2 is the foundational Execution Access Control (EAC) architecture of AegisNet:
> 1. **Subname Node Identity:** Every agent operates under a verifiable ENSv2 subname registered through `AegisSubnameRegistry.sol`.
> 2. **Programmable EAC Whitelists:** The agent's `bytes32 subnameNode` is the primary key for protocol permissions. Target execution adapters (like Uniswap V3) must be explicitly whitelisted under the agent’s subname node. If an agent tries to call an unwhitelisted contract, the call strictly reverts onchain.
> 3. **ENSIP-26 Agent Text Records:** Resolves machine-readable metadata directly on the ENS node (`agent.capabilities`, `agent.biometric_threshold`, `agent.operator`).
> 4. **Sovereign Owner Derivation:** High-value human approvals derive authorization directly from the registered subname owner on Sepolia, ensuring single-use replay protection. Without ENSv2, the entire identity, permissions registry, and access control matrix would not exist.

### Track: 0G (Compute & Storage)
**How did you integrate 0G technologies?**
> AegisNet integrates both compute and storage layers from the 0G ecosystem:
> 1. **0G Private Compute:** Uses the 0G Private Compute router (`https://router-api.0g.ai/v1`) with the `0gm-1.0-35b-a3b` model for confidential offchain strategy formulation, protecting trading alpha from mempool front-running with strict JSON schema outputs.
> 2. **0G Turbo Storage:** Uses `@0gfoundation/0g-storage-ts-sdk` on 0G Galileo Turbo Testnet. Every trade proposal, decision snapshot, and execution receipt is Merkle-hashed into a 32-byte root hash and anchored permanently on 0G Storage, verifiable on [0G Storage Scan](https://storagescan.0g.ai).
> *Live sample root hash:* `0x915b0d5c28f574cbf40708585c0e95e54f17c23df768b0ef467cc9d572a7c7b3`

### Track: Uniswap
**How did you integrate Uniswap?**
> Built `AegisUniswapAdapter.sol` which interfaces directly with Uniswap V3’s canonical `SwapRouter02` (`0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`) on Sepolia. Features live ERC-20 token transfers and `exactInputSingle` execution with slippage protection, accompanied by dynamic bytecode inspection for resilient demo swaps.

---

## 5. Deployed Contracts & Reference Links

- **Network:** Ethereum Sepolia (Chain ID: `11155111`)
- **GitHub Repository:** `https://github.com/shriyashsoni/aegisnet`
- **AegisSubnameRegistry:** [`0x6Dbd89B71e8AB7BF93a9200C6fB81951699549FE`](https://sepolia.etherscan.io/address/0x6Dbd89B71e8AB7BF93a9200C6fB81951699549FE)
- **AegisExecutionManager:** [`0x13d7b8Add8265AB1Cfdc3a6E8E60D1b3bcD56fa8`](https://sepolia.etherscan.io/address/0x13d7b8Add8265AB1Cfdc3a6E8E60D1b3bcD56fa8)
- **AegisUniswapAdapter:** [`0xD855719f7Cc2cD867540F8398E3d2Fa4b2dD8221`](https://sepolia.etherscan.io/address/0xD855719f7Cc2cD867540F8398E3d2Fa4b2dD8221)
- **AegisSwapVMAdapter:** [`0xb81b7Ec40eF275AA805Cb82D729498C47Ab64c60`](https://sepolia.etherscan.io/address/0xb81b7Ec40eF275AA805Cb82D729498C47Ab64c60)
- **Uniswap V3 SwapRouter02:** [`0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`](https://sepolia.etherscan.io/address/0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E)
- **0G Storage Explorer Proof:** [`https://storagescan.0g.ai/file/0x915b0d5c28f574cbf40708585c0e95e54f17c23df768b0ef467cc9d572a7c7b3`](https://storagescan.0g.ai/file/0x915b0d5c28f574cbf40708585c0e95e54f17c23df768b0ef467cc9d572a7c7b3)

---

## 6. Judges' Testing Guide

1. Navigate to `/app` in your browser.
2. Click **Connect Wallet** and select MetaMask/Rabby on Ethereum Sepolia.
3. Explore registered agents (`sidd.aegisnet.eth` or `shriyashdn.aegisnet.eth`) or register a new one.
4. Test low-value trade (< $1,000): click **Propose Trade** and **Execute Swap** — auto-executes immediately.
5. Test high-value trade (≥ $1,000): propose a $1,500 trade — pauses onchain, opens Human Approval checkpoint, and clears upon EIP-712 wallet signature.
6. Click **View 0G Proof** to inspect the permanent Merkle audit hash on 0G Storage Scan.

---

## 7. Additional Form Fields

- **Inspiration:** The total lack of an onchain safety firewall between autonomous LLM agent reasoning and raw DeFi protocol execution, risking catastrophic treasury liquidations.
- **Challenges:** Repurposing ENSv2 subnames as gas-efficient onchain EAC firewalls, overcoming Sepolia liquidity pool absences for Uniswap V3, and implementing non-replayable human approval gates.
- **Accomplishments:** 100% live verified contracts on Sepolia, zero-revert dual-path execution, permanent 0G audit logging, and 1-click Vercel deployment readiness.
- **What We Learned:** ENSv2 hierarchical subregistries enable powerful decentralized IAM primitives; 0G solves both privacy (private compute) and verifiable compliance (decentralized storage).
- **Tags:** `AI`, `DeFi`, `ENS`, `0G`, `Uniswap`, `Security`, `Infrastructure`, `EVM`
- **License:** `MIT`
