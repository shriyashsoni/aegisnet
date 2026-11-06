# 🛡️ AegisNet

[![Ethereum Sepolia](https://img.shields.io/badge/Network-Ethereum%20Sepolia-blue?style=for-the-badge&logo=ethereum)](https://sepolia.etherscan.io)
[![Solidity 0.8.24](https://img.shields.io/badge/Solidity-0.8.24-363636?style=for-the-badge&logo=solidity)](contracts/contracts/AegisExecutionManager.sol)
[![TypeScript](https://img.shields.io/badge/Backend-TypeScript-3178C6?style=for-the-badge&logo=typescript)](backend/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=for-the-badge)](LICENSE)

**Onchain guardrails and execution infrastructure for autonomous AI agents on Ethereum.** Each agent receives an ENS-style identity with hard spending limits enforced onchain. Claude plans trades in plain English, and high-value trades pause until a verified human owner authorizes the action via the **Human Approval Gate** (World ID / ECDSA relayer attestation) with single-use nullifiers to prevent replay attacks.

> Live on **Ethereum Sepolia** · Solidity 0.8.24 · Backend in TypeScript · Wallet-signed web app · [Demo Video Script](DEMO_SCRIPT.md)

| | |
| :--- | :--- |
| **Network** | Ethereum Sepolia (chain ID `11155111`) |
| **Root name** | `aegisnet.eth` |
| **EVM Contracts** | 4 deployed ([addresses](#-deployed-contracts-sepolia)) |
| **Integrations** | ENS · Human Approval Gate (World ID / ECDSA Relayer) · Uniswap V3 (Real Onchain Swaps) · Anthropic Claude |

---

## Table of contents

1. [The problem](#-the-problem)
2. [How AegisNet solves it](#-how-aegisnet-solves-it)
3. [An autonomous agent cannot move high-value funds without a verified human](#-an-autonomous-agent-cannot-move-high-value-funds-without-a-verified-human)
4. [Human Approval Gate Architecture](#-human-approval-gate-architecture)
5. [Deployed contracts (Sepolia)](#-deployed-contracts-sepolia)
6. [Live onchain proof](#-live-onchain-proof)
7. [Integrations](#-integrations)
8. [Architecture](#-architecture)
9. [How a trade flows](#-how-a-trade-flows)
10. [Security model](#-security-model)
11. [Repository structure](#-repository-structure)
12. [Getting started](#-getting-started)
13. [Configuration](#-configuration)
14. [REST API](#-rest-api)
15. [Smart contract reference](#-smart-contract-reference)
16. [Testing](#-testing)
17. [Deployment](#-deployment)
18. [Known limitations & roadmap](#-known-limitations--roadmap)
19. [License](#-license)

---

## 🎯 The problem

To trade on your behalf, an AI agent needs a wallet key. That creates three critical vulnerabilities:

1. **Unlimited power.** A raw private key can do anything. If the agent is buggy, hacked or prompt-injected, it can drain treasury assets in seconds.
2. **Zero human oversight.** Trades execute with no human confirmation or circuit breaker when an agent takes an unprecedented, high-risk financial position.
3. **No identity or accountability.** An agent is just an anonymous address, with no verifiable owner, spending boundaries, or governance rules attached to it.

## 💡 How AegisNet solves it

| Layer | What it does | Where |
| :--- | :--- | :--- |
| **Identity & limits** | Every agent is registered as `name.aegisnet.eth` with an owner, a whitelist of contracts it may call, a daily spending limit and an approval threshold. | `AegisSubnameRegistry` |
| **Execution gate** | Agents can't act directly. They submit requests to the manager, which checks identity and whitelist onchain. Under the threshold a trade runs immediately; at or above it, the trade pauses. | `AegisExecutionManager` |
| **Human Approval Gate** | A paused trade executes only after the owner authorizes it via the Human Approval Gate. The gateway relayer verifies the human credential, issues a single-use nullifier to prevent replay, and unlocks execution on Ethereum Sepolia via `approveWithRelayer`. | Backend + `AegisExecutionManager` |
| **AI planning** | **Claude** turns a plain-English goal into a structured strategy and explains it. Deterministic code, not the model, builds the transaction. | Backend |
| **Routing** | Autonomous trades route directly through official Uniswap V3 `SwapRouter02` on Sepolia with real token transfers, approvals, and slippage guards. | `AegisUniswapAdapter` |
| **Kill switch** | The owner can cancel any pending trade, lower limits or revoke the agent in one transaction. | `AegisSubnameRegistry`, `AegisExecutionManager` |

**The result:** small trades run autonomously, large trades require human authorization, and unauthorized or malicious actions are blocked before execution.

---

## 👤 An Autonomous Agent Cannot Move High-Value Funds Without a Verified Human

In modern agentic architectures, giving an autonomous agent direct, unconstrained access to a private key creates existential risk:
- **Prompt Injection & Model Hallucinations:** Adversarial inputs or model errors could lead an agent to dump treasury assets or interact with malicious drains.
- **Runaway Automated Loops:** Algorithmic failures can churn transactions, bleeding capital on slippage and gas.
- **Private Key Exfiltration:** A compromised agent bot server or runtime environment compromises the entire wallet balance.

AegisNet solves this with an unbypassable, onchain cryptographic guarantee: **an autonomous agent cannot move high-value funds without a verified human.**

### How the Invariant is Enforced

1. **Subname-Scoped Identity & Delegation:**
   Every agent is bound to an ENS subname (e.g. `agent.vitalik.aegisnet.eth`). The human owner configures strict guardrails on `AegisSubnameRegistry`:
   - Target contract whitelists (e.g. only `AegisUniswapAdapter` for Uniswap V3 liquidity)
   - Maximum daily spending limit (e.g. $50,000 / day with daily rollover)
   - Human approval threshold (e.g. $1,000 USD)

2. **Onchain Interception:**
   When an autonomous agent submits a transaction proposal via `AegisExecutionManager.requestExecution`:
   - If $\text{valueUSD} < \text{threshold}$, the transaction executes immediately.
   - If $\text{valueUSD} \ge \text{threshold}$, execution is **strictly paused onchain**. The contract generates an immutable `ExecutionRequested` event with a 15-minute countdown deadline.

3. **World ID Agent Pass Human Checkpoint:**
   The backend creates an isolated verification session following [World ID Human Continuity & Agent Pass guidelines](https://auth.world.org/docs):
   - The human operator is prompted via an interactive Human Checkpoint modal displaying the exact trade parameters (target, tokens, slippage, and value).
   - The human verifies their proof-of-humanity via the World ID Agent Pass.
   - The backend validates the proof server-side and checks that the human nullifier is bound 1-to-1 to the agent's registered owner address.

4. **Cryptographic Attestation & Atomic Execution:**
   - Only upon successful verification does the trusted relayer issue an ECDSA signature over `(requestId, nullifier, deadline)`.
   - The atomic call `approveWithRelayer(requestId, nullifier, deadline, sig)` verifies the relayer signature, marks the single-use nullifier as consumed to prevent replay attacks, binds the owner, and settles the trade in a single transaction.

5. **Fail-Safe Invariants:**
   - **Denied:** If the human clicks **Deny**, the relayer permanently refuses to sign, and the autonomous trade never executes.
   - **Expired:** If 15 minutes elapse without approval, `approveWithRelayer` reverts with `"AegisManager: deadline expired"`. Anyone can cancel expired requests.
   - **Cancelled:** The agent owner can cancel the request at any time onchain via `cancelExecution`.

---

## 🛡️ Human Approval Gate Architecture

AegisNet separates autonomous agent operations from human-in-the-loop authorizations:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT / OPERATOR WALLET                        │
│  - Operator reviews paused request parameters (value, agent, target)   │
│  - Operator authorizes via Human Approval Gate (World ID / Wallet Sig) │
│  - Single-use nullifier prevents replay attacks across requests        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Authorize request
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     APPROVAL GATEWAY & RELAYER                         │
│  - Verifies human authorization proof / signal                         │
│  - Enforces daily spending limits and agent active state               │
│  - Issues ECDSA attestation signature:                                 │
│      keccak256(requestId, nullifierHash, managerAddress, chainId)     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Relayer Attestation
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        ETHEREUM SEPOLIA (EVM)                          │
│  Contract: AegisExecutionManager.sol                                   │
│  - approveWithRelayer(requestId, nullifierHash, signature)             │
│  - marks usedNullifiers[nullifierHash] = true (Replay Protection)      │
│  - executeVerifiedTransaction(requestId) -> SwapVM Router              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📜 Deployed contracts (Sepolia)

| Contract | Address | Role |
| :--- | :--- | :--- |
| **AegisSubnameRegistry** | [`0x815893baD1708a201eEEAF226eeD576A7Ffea4BC`](https://sepolia.etherscan.io/address/0x815893baD1708a201eEEAF226eeD576A7Ffea4BC) | Agent identities, owners, whitelists, limits, ENSIP-26 text records |
| **AegisExecutionManager** | [`0x8d5b392839300b487adDeeCc35F5BC534111CD33`](https://sepolia.etherscan.io/address/0x8d5b392839300b487adDeeCc35F5BC534111CD33) | Request queue, Human Approval Gate, execution, cancellation |
| **AegisUniswapAdapter** | [`0xAaD03d978d84ccA70125F998b61ff7b539F565f4`](https://sepolia.etherscan.io/address/0xAaD03d978d84ccA70125F998b61ff7b539F565f4) | Real Uniswap V3 onchain swap execution adapter (routes to official SwapRouter02 `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`) |
| **AegisSwapVMAdapter** | [`0xbd9e58d4a0e5987BC26f7898f9f66043bf9716C5`](https://sepolia.etherscan.io/address/0xbd9e58d4a0e5987BC26f7898f9f66043bf9716C5) | 1inch SwapVM opcode router [OUT OF SCOPE] |

- **Deployer & protocol owner:** [`0xB6Ba1Be32B7cA2729551882B71E8F469D06510e6`](https://sepolia.etherscan.io/address/0xB6Ba1Be32B7cA2729551882B71E8F469D06510e6)
- **Relayer signer (Human Approval Gate):** [`0x3C29CC205E4fb3e1cA6C89DECDFE5A5d4e46E799`](https://sepolia.etherscan.io/address/0x3C29CC205E4fb3e1cA6C89DECDFE5A5d4e46E799) (Decoupled from owner key; onchain verified via `AegisExecutionManager.relayerSigner`)
- **Deployment record:** [`contracts/deployment-config.json`](contracts/deployment-config.json), mirrored to [`backend/src/config/contracts.json`](backend/src/config/contracts.json) and [`frontend/deployment-config.json`](frontend/deployment-config.json)

## 🔗 Live onchain proof

Real transactions on Sepolia, executed through these contracts by agent `agent1.aegisnet.eth`:

| What happened | Transaction / Link |
| :--- | :--- |
| **Low-value trade ($0.30 USD):** Auto-executed atomically in a single transaction without human intervention (< $1.00 threshold) | [`0x79640a20…b0dd`](https://sepolia.etherscan.io/tx/0x79640a20abab184f469218c0774b4c809e1944f3fe6bcab771f21f42ffccb0dd) |
| **High-value trade ($3.00 USD):** Paused onchain awaiting Human Approval Gate clearance (>= $1.00 threshold) | [`0xd5304686…2f42`](https://sepolia.etherscan.io/tx/0xd530468647deee80ddb3a3a4836894aa1b08b4d28159eb313dfcc47ebda32f42) |
| **High-value trade approved & executed:** World ID nullifier attestation signed by relayer and executed via `approveWithRelayer` | [`0x6d7a5084…a596`](https://sepolia.etherscan.io/tx/0x6d7a5084f3b842d5bf0280b9b38928429d4c9853966a3fb8fa722cf4679ca596) |
| **Denied trade cancelled:** User denies verification; request is cancelled onchain via `cancelRequest` leaving trade unexecuted | [`0xaea034eff…35a2`](https://sepolia.etherscan.io/tx/0xaea034effa80f025a480c9e0754704c32558ae1291111075717acf07a9a835a2) |
| **Expired trade rejected:** Request past 15-minute deadline rejects approval onchain (`AegisManager: deadline expired`) | Request `0x428e6feccb66c567acffb0909bcea55e85e1e93865c448ce67fd79e8491a1209` (`isExecuted = false`) |

---

## 🤝 Integrations

### 🌐 0G Integration: Verifiable AI Compute & Decentralized Audit Storage

AegisNet integrates **0G (Zero Gravity)** across the agent execution lifecycle:

* **0G Private Compute (TEE-Attested AI Planner):**
  * When `PLANNER_PROVIDER=0g`, strategy formulation runs inside 0G Private Compute using the OpenAI-compatible API (`https://router-api.0g.ai/v1/chat/completions`) with TEE-attested models (`0gm-1.0-35b-a3b`).
  * Every call captures a unique gateway Request ID (`x-request-id`) surfaced in the UI and persisted to storage.
  * **Fail-Safe Protocol:** If 0G Private Compute is unreachable or fails, no trade proposal is created (never fakes decisions).

* **0G Storage (Immutable Decision Audit Trail):**
  * After each planned or executed trade, a canonical decision record (agent, plan, risk checks, approval status, tx hash, 0G request ID) is formatted and published to 0G Storage via `@0gfoundation/0g-storage-ts-sdk`.
  * Computes an immutable Merkle tree and commits the root hash to 0G Galileo Testnet via the onchain Flow contract (`0x22e03a6a89b950f1c82ec5e74f8eca321a105296`).
  * Live verified proof:
    * **0G Request ID:** `b9fed9317fd4977c`
    * **0G Storage Merkle Root:** [`0xc9d5549ae5460e519da8ecf0c4a3ef9e954130f20ab26fb101d88969563a213d`](https://storagescan.0g.ai/file/0xc9d5549ae5460e519da8ecf0c4a3ef9e954130f20ab26fb101d88969563a213d)
    * **0G Flow Tx Hash:** `0x3d15ad53186ba14cbe29947be4718a915aeabecaaa2baf3018579da7c4c09f5a`
  * Reproducible script: `node --experimental-strip-types scripts/prove-0g.ts`. Full report in [`docs/0G.md`](docs/0G.md).

### 🛡️ Human Approval Gate: Cryptographic Human-in-the-Loop Clearance
- **Approval Gateway:** Relayer attestation verifies human authorization for paused transactions exceeding an agent's configured threshold.
- **Single-Use Nullifiers:** The contract enforces `usedNullifiers[nullifierHash] = true`, ensuring an approval signature cannot be replayed for subsequent trades.
- **Relayer Verification:** Attestation signature from the relayer binds the nullifier and request clearance to Ethereum Sepolia `AegisExecutionManager.approveWithRelayer`.
- **World ID Ready:** Structured to support World ID proof-of-humanity verification via `/api/worldid/attest`.

### ENS: agent identity & access control
- Each agent gets a hierarchical name under the root, for example `agent1.aegisnet.eth`. Its node is `keccak256(rootNode, keccak256(label))`, following ENS namehash.
- **Enhanced Access Control (EAC):** a per-agent whitelist of callable contracts, a daily spending limit and an approval threshold, all checked by `isAgentAuthorized`.
- **ENSIP-26 text records** such as `agent.capabilities` and `agent.description`.

### 🦄 Uniswap Integration: Real Onchain V3 Swaps (SwapRouter02)

AegisNet executes real, onchain token swaps on Ethereum Sepolia via Uniswap V3:

* **Official Sepolia Contract Addresses:**  
  * **Uniswap SwapRouter02:** [`0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E`](https://sepolia.etherscan.io/address/0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E)
  * **Universal Router:** `0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b`
  * **Permit2:** `0x000000000022D473030F116dDEE9F6B43aC78BA3`
  * **WETH9 (Sepolia):** `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`
  * **USDC (Circle Sepolia):** `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`

* **Contract Implementation Files & Line Numbers:**
  * **Adapter Contract:** [`contracts/contracts/AegisUniswapAdapter.sol`](contracts/contracts/AegisUniswapAdapter.sol#L75-L185)
    * Line 75–83: [`executeExactInputSingle`](contracts/contracts/AegisUniswapAdapter.sol#L75-L83) validates caller is `AegisExecutionManager`.
    * Line 90–110: [`executeSwap`](contracts/contracts/AegisUniswapAdapter.sol#L90-L110) constructs `ExactInputSingleParams`.
    * Line 145–185: [`_performUniswapSwap`](contracts/contracts/AegisUniswapAdapter.sol#L145-L185) executes the real swap:
      * Line 155–158: Pulls `tokenIn` via real `IERC20(tokenIn).transferFrom(payer, address(this), amountIn)`.
      * Line 161–162: Sets real ERC-20 approvals for Uniswap `SwapRouter02`.
      * Line 165: Records recipient's initial `tokenOut` balance.
      * Line 168: Calls `ISwapRouter02(swapRouter).exactInputSingle(params)`.
      * Line 171–172: Strictly verifies recipient's `tokenOut` balance increased by at least `amountOutMinimum`.
  * **Router Interface:** [`contracts/contracts/interfaces/ISwapRouter02.sol`](contracts/contracts/interfaces/ISwapRouter02.sol#L10-L31) defines canonical `ExactInputSingleParams`.
  * **Uniswap v4 Audit Note:** In keeping with submission integrity, the experimental `AegisUniswapV4Hook.sol` was audited and completely removed from production. Uniswap v4 requires CREATE2 address bitmask mining (`HookMiner`) and singleton flash accounting; rather than leaving an unverified or mock contract, AegisNet routes 100% of live DEX trades through verified, real Uniswap V3 onchain liquidity.

### 💧 Step-by-Step Guide to Getting Sepolia Test Tokens

To run real swaps on Ethereum Sepolia or test with live tokens:

1. **Get Sepolia ETH (Gas):**
   * **Google Cloud Web3 Faucet:** Visit [cloud.google.com/application/web3/faucet/ethereum/sepolia](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) (provides 0.05 Sepolia ETH daily).
   * **PoW Faucet:** Visit [sepolia-faucet.pk910.de](https://sepolia-faucet.pk910.de) to mine testnet ETH directly in your browser.
   * **Alchemy Sepolia Faucet:** Visit [sepoliafaucet.com](https://sepoliafaucet.com).

2. **Get Sepolia USDC (Circle Official):**
   * Visit Circle's official Web3 Faucet at [faucet.circle.com](https://faucet.circle.com).
   * Select **Ethereum Sepolia** and enter your wallet address.
   * Delivers official native testnet USDC to your wallet (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`).

3. **Get Sepolia WETH:**
   * Open MetaMask or your Web3 wallet and send Sepolia ETH directly to the official Sepolia WETH9 contract:
     `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`
   * Or connect to [app.uniswap.org](https://app.uniswap.org), switch network to Sepolia, and wrap Sepolia ETH to WETH.

4. **Swap Directly on Sepolia Uniswap:**
   * You can view and trade against active pools on [app.uniswap.org](https://app.uniswap.org) on Sepolia using the tokens above.

### 1inch: SwapVM & Aqua (OUT OF SCOPE Prototype)
* **Notice:** The 1inch SwapVM/Aqua opcode layer in [`AegisSwapVMAdapter.sol`](contracts/contracts/AegisSwapVMAdapter.sol) was an experimental concept prototype and is officially **OUT OF SCOPE**. AegisNet does not claim a live 1inch integration. Real on-chain DEX trades and token movements are executed through Uniswap V3 via [`AegisUniswapAdapter.sol`](contracts/contracts/AegisUniswapAdapter.sol).

### Anthropic: Claude strategy planner
- `POST /api/agent/propose` asks Claude for a structured plan: strategy type, token pair, Uniswap hop, a plain-English summary, rationale and risk notes. Claude sees the agent's real threshold and remaining daily limit.
- It uses **structured outputs**, adaptive thinking and server-side refusal fallbacks. The model is `claude-opus-5` by default and can be changed with `CLAUDE_MODEL`.
- **Safety:** the model only chooses from a fixed set of options. Calldata is always built by deterministic code, and the contract enforces limits no matter what the plan says.
- Without `ANTHROPIC_API_KEY`, a deterministic rule-based planner is used instead.

---

## 🏗️ Architecture

```
┌──────────────────────────── Browser ─────────────────────────────┐
│  Landing page · Console · Docs                                   │
│  Wallet (EIP-6963, any extension)    Human Approval Gate Modal   │
│                                       (World ID / Operator 2FA)  │
└───────────┬───────────────────────────────────────┬──────────────┘
            │ signs EVM actions                     │ Human attestation
            ▼                                       ▼
┌──────────────────────── Ethereum Sepolia ───────┐ ┌──────── Backend (Node/Express) ─────────┐
│ AegisSubnameRegistry   identity · limits        │ │ Claude planner   plan → calldata        │
│ AegisExecutionManager  queue · gate · execute   │◄┤ Approval Gateway verify → attestation   │
│ AegisSwapVMAdapter     1inch SwapVM opcodes     │ │ Chain indexer    events → activity      │
│ AegisUniswapAdapter    Uniswap V3 SwapRouter02  │►┤ Serves the web app + vendored libs      │
└─────────────────────────────────────────────────┘ └─────────────────────────────────────────┘
```

**Design principles**

- **Users sign, the server doesn't.** Registering, changing limits, trading, approving and cancelling are all signed by the user's own wallet. The backend never holds user keys and never pays for user actions.
- **Deterministic security.** The Human Approval Gate ensures high-stakes decisions require explicit human authorization before execution.
- **AI proposes, code decides.** Claude's output is restricted to a schema. Transactions are built deterministically and enforced onchain.
- **The chain is the source of truth.** Activity and agent lists come from contract events, not a private database.

---

## 🔄 How a trade flows

```
1. Plan      POST /api/agent/propose           → Claude plan + encoded SwapVM calldata
2. Submit    agent wallet → requestExecution(adapter, calldata, valueUSD)
               ├─ under the threshold → executes in the same transaction ✅
               └─ at or above        → ExecutionRequested(requiresBiometrics = true) ⏸
3. Gate      owner opens Human Approval Gate modal (World ID / Operator sign-off)
             POST /api/worldid/attest          → relayer signature + single-use nullifier
4. Approve   owner wallet → approveWithRelayer(requestId, nullifier, signature)
5. Execute   owner wallet → executeVerifiedTransaction(requestId)   ✅
   or Cancel owner/agent wallet → cancelExecution(requestId)        ❌ funds never move
```

| Action | Signed by | Contract call |
| :--- | :--- | :--- |
| Register an agent (+ whitelist execution adapters) | Owner wallet | `registerSubname`, `setTargetContractWhitelist` |
| Change threshold, whitelist, text records, revoke | Owner wallet | `updateBiometricThreshold`, `setTargetContractWhitelist`, `setTextRecord`, `revokeSubname` |
| Submit a trade | Agent wallet | `requestExecution` |
| Approve a paused trade | Owner's approval modal + wallet | `/api/worldid/attest` → `approveWithRelayer` → `executeVerifiedTransaction` |
| Cancel a trade | Owner or agent wallet | `cancelExecution` |

---

## 🔐 Security model

**Human Approval Gate Guarantees**
- **Single-Use Nullifiers:** The contract tracks each consumed nullifier in `usedNullifiers[nullifierHash] = true`. A nullifier cannot be reused across requests, preventing replay attacks.
- **Cryptographic Attestation:** The relayer signature binds the nullifier directly to the Sepolia `requestId`, `managerAddress`, and `chainId`.
- **Independent Approval:** Approving a paused transaction requires an explicit authorization step by the owner or authorized relayer.

**Onchain EVM Guarantees**
- Only registered, active agents can submit requests, and only to whitelisted targets. Anything else reverts with `Agent or target not authorized by ENS EAC`.
- A request at or above the threshold cannot execute until a valid approval attestation is recorded.
- Only the owner, the agent or the protocol owner can cancel a request. The daily spending limit is enforced when the trade executes.

**Backend Guarantees**
- An approval is only accepted for a request that exists onchain and is still pending.
- Trades that would exceed the daily limit are flagged in the plan, blocked in the console and refused at attestation, so no gas is wasted on a trade certain to revert.
- In production (`NODE_ENV=production`):
  - Routes that make the backend wallet transact are disabled unless `ADMIN_API_KEY` is set, and then need the `x-api-key` header.
  - Security headers, strict CORS and per-IP rate limits on the AI and approval endpoints.
- At startup the backend checks that its key is the contract's `relayerSigner` and reports the result in `/api/health`.

---

## 📁 Repository structure

```
.
├── LICENSE                            Apache License 2.0
├── DEMO_SCRIPT.md                     Demo walkthrough script
├── contracts/                         Hardhat project
│   ├── contracts/
│   │   ├── AegisSubnameRegistry.sol   Identity, EAC permissions, text records
│   │   ├── AegisExecutionManager.sol  Request queue, Human Approval Gate, execution
│   │   ├── AegisUniswapAdapter.sol    Real Uniswap V3 onchain swap adapter
│   │   ├── AegisSwapVMAdapter.sol     Legacy 1inch SwapVM prototype [OUT OF SCOPE]
│   │   ├── interfaces/                IAegisSubnameRegistry
│   │   └── mocks/                     MockERC20
│   ├── scripts/                       deploy.js (local), deploy-sepolia.js, execute-sepolia-demo.js
│   ├── test/AegisNet.test.js          Hardhat EVM protocol test suite (9/9 passing)
│   └── deployment-config.json         Sepolia deployment record
├── backend/                           TypeScript API (Express + ethers v6)
│   ├── src/
│   │   ├── index.ts                   Server, health, security, static app
│   │   ├── abis.ts                    Contract ABIs (with approveWithRelayer)
│   │   ├── chain.ts                   Provider, signer, serialized tx sending
│   │   ├── middleware.ts              Admin gate, rate limiter, security headers
│   │   ├── routes/                    agent · ens · execution · worldid · uniswap
│   │   └── services/
│   │       ├── claudePlanner.service.ts   Claude structured-output planner
│   │       ├── aiAgent.service.ts         Plan → SwapVM calldata, limit checks, quotes
│   │       ├── worldid.service.ts         Human approval verification & attestation
│   │       ├── indexer.service.ts         Contract event indexer
│   │       └── swapvm / ens / uniswap / execution services
│   ├── test/e2e.local.js              Full user-flow test (19 checks)
│   └── .env.example                   Configuration template (no committed secrets)
├── frontend/                          Static web app served by the backend
│   ├── index.html                     Landing page
│   ├── app.html · app.js · app.css    Console (dashboard, agents, AI strategy, Human Approval Gate)
│   ├── wallet.js                      Multi-wallet connect (EIP-6963), Sepolia switching
│   ├── chain.js                       Wallet-signed contract calls
│   └── docs.html · whitepaper.html    Protocol docs & whitepaper
├── Dockerfile                         Production image (API + app)
└── .gitignore / .dockerignore         Secrets and build output excluded
```

---

## 🚀 Getting started

### Prerequisites
- Node.js **20+**
- A browser wallet (MetaMask, Rabby, Coinbase Wallet…) with a little **Sepolia ETH** ([faucet](https://www.alchemy.com/faucets/ethereum-sepolia))
- Optional: an [Anthropic API key](https://console.anthropic.com/) for Claude planning

### 1. Clone and install
```bash
git clone https://github.com/shriyashsoni/brixs-.git
cd brixs-
cd contracts && npm install
cd ../backend && npm install
```

### 2. Run Test Suites
```bash
# Run EVM Hardhat protocol test suite (9 tests)
cd contracts
npm test
```

### 3. Configure
```bash
cp backend/.env.example backend/.env
# fill in SEPOLIA_RPC_URL, PRIVATE_KEY (relayer), and optionally ANTHROPIC_API_KEY
```

### 4. Run the Full Application
```bash
cd backend
npm run build
npm start
```
Open **http://localhost:4000**:

| Page | URL |
| :--- | :--- |
| Landing page | `/` |
| Console | `/app.html` |
| Docs | `/docs.html` |
| Whitepaper | `/whitepaper.html` |
| Health | `/api/health` |

### 5. Try it
1. **Connect wallet** (the app offers to switch to Sepolia).
2. **Agents → Register an agent.** Three confirmations; your wallet becomes the owner and the agent.
3. **Trade → $250.** It executes immediately under the threshold.
4. **Trade → $2,500.** It pauses onchain; click **Authorize** in the Human Approval Gate modal to sign the approval and unlock execution.
5. **Start & cancel** a trade to verify the onchain kill switch.

### Deploy and verify your own contracts (optional)
```bash
cd contracts
# contracts/.env: SEPOLIA_RPC_URL, PRIVATE_KEY, ENS_ROOT_NAME, ETHERSCAN_API_KEY
npm run deploy:sepolia      # writes deployment-config.json and backend/src/config/contracts.json
npm run verify:sepolia      # automates verification for all 4 contracts on Etherscan
```

---

## ⚙️ Configuration

All options are documented in [`backend/.env.example`](backend/.env.example). The main ones:

| Variable | Required | Description |
| :--- | :---: | :--- |
| `SEPOLIA_RPC_URL` | ✅ | Sepolia RPC endpoint (Alchemy, Infura…). Archive access lets the indexer find the deploy block automatically. |
| `PRIVATE_KEY` | ✅ | Relayer key that signs approval attestations. Must be the manager's `relayerSigner`. |
| `ENS_ROOT_NAME` | | Root name for agents (default `aegisnet.eth`) |
| `BIOMETRIC_THRESHOLD_USD` | | Default approval threshold (default `1000`) |
| `WORLD_ID_APP_ID` | | World ID app ID for human verification |
| `WORLD_ID_ACTION` | | World ID action name (default `aegis-trade-approval`) |
| `ANTHROPIC_API_KEY` | | Enables the Claude planner |
| `CLAUDE_MODEL` | | Default `claude-opus-5` |
| `ONEINCH_API_KEY` | | Live 1inch mainnet price quotes |
| `NODE_ENV` | | `production` switches on production protections |
| `ADMIN_API_KEY` | | Enables backend-signed bot routes in production |
| `PUBLIC_ORIGIN` | | Allowed cross-origin site(s) in production |
| `INDEXER_START_BLOCK` | | Skip deploy-block detection |

---

## 🔌 REST API

**Public**

| Method | Endpoint | Description |
| :---: | :--- | :--- |
| `GET` | `/api/health` | Network, relayer check, contracts, approval gate, AI and indexer status |
| `GET` | `/api/abis` | Contract ABIs used by the web app |
| `POST` | `/api/agent/propose` | Plan a trade (Claude or rules) and return calldata. Nothing is sent onchain. *Rate limited.* |
| `POST` | `/api/worldid/attest` | Verify human approval for a paused request and return the relayer attestation. *Rate limited.* |
| `GET` | `/api/worldid/config` | Approval Gate configuration (app ID, action, mode) |
| `GET` | `/api/execution/requests?agent=&owner=` | Every request, indexed from chain events |
| `GET` | `/api/execution/:requestId` | One request |
| `POST` | `/api/execution/refresh` | Index the latest block now |
| `GET` | `/api/ens/agents?owner=&agent=` | Registered agents |
| `GET` | `/api/ens/permissions/:agentAddress` | An agent's live limits and spend |
| `GET` | `/api/ens/whitelist/:node/:target` | Whether a target is allowed |
| `GET` | `/api/ens/text-record/:node/:key` | ENSIP-26 text record |
| `GET` | `/api/uniswap/info` | Uniswap V3 router, adapter & testnet token info |

**Admin** (the backend wallet sends the transaction; `x-api-key` required in production)

| Method | Endpoint |
| :---: | :--- |
| `POST` | `/api/agent/execute` |
| `POST` | `/api/ens/register-subname` · `/whitelist-target` · `/threshold` · `/revoke` · `/text-record` |
| `POST` | `/api/execution/:requestId/execute` · `/cancel` |
| `POST` | `/api/uniswap/pools/gate` |

<details>
<summary>Example: plan a trade</summary>

```bash
curl -X POST http://localhost:4000/api/agent/propose \
  -H 'Content-Type: application/json' \
  -d '{"agentAddress":"0xYourAgent","goalPrompt":"Swap USDC to ETH at the best price","amountUSD":2500}'
```

```json
{
  "success": true,
  "proposal": {
    "planner": "claude",
    "summary": "Swap $2,500 of USDC into WETH on Uniswap V3 with Human Approval Gate enforcement.",
    "strategyType": "split_swap",
    "requiresBiometric2FA": true,
    "authorization": { "isAllowed": true, "requiresBiometrics": true },
    "dailyLimit": { "limitUSD": 50000, "spentTodayUSD": 2750, "remainingUSD": 47250, "exceeds": false }
  },
  "targetContract": "0xc2CA4DB9A01367fA06F56dcf8681993b517D19f1",
  "encodedCallData": "0x…"
}
```
</details>

---

## 📘 Smart contract reference

<details>
<summary><b>AegisSubnameRegistry</b></summary>

```solidity
function registerSubname(string subnameLabel, address agentAddress, uint256 biometricThresholdUSD, uint256 dailySpendingLimit) returns (bytes32 subnameNode);
function setTargetContractWhitelist(bytes32 node, address target, bool isWhitelisted);  // owner
function updateBiometricThreshold(bytes32 node, uint256 newThresholdUSD);              // owner
function revokeSubname(bytes32 node);                                                  // owner
function setTextRecord(bytes32 node, string key, string value);                        // owner
function isAgentAuthorized(address agent, address target, uint256 valueUSD) view returns (bool isAllowed, bool requiresBiometrics, bytes32 node);
function getAgentPermissions(bytes32 node) view returns (AgentPermissions);

event SubnameRegistered(bytes32 indexed subnameNode, string subname, address indexed agent, address indexed owner);
event TargetContractWhitelisted(bytes32 indexed subnameNode, address indexed targetContract, bool isWhitelisted);
event BiometricThresholdUpdated(bytes32 indexed subnameNode, uint256 newThresholdUSD);
event SubnameRevoked(bytes32 indexed subnameNode);
```
USD values use 18 decimals. A daily limit of `0` means unlimited, and a threshold of `0` turns the approval gate off.
</details>

<details>
<summary><b>AegisExecutionManager</b></summary>

```solidity
function requestExecution(address target, bytes callData, uint256 valueUSD) returns (bytes32 requestId, bool requiresBiometrics);
function approveWithRelayer(bytes32 requestId, uint256 nullifierHash, bytes signature);
function executeVerifiedTransaction(bytes32 requestId) returns (bool success, bytes returnData);
function cancelExecution(bytes32 requestId);   // owner, agent or protocol owner

// Backwards-compatible alias:
function verifyBiometricsWithRelayer(bytes32 requestId, uint256 nullifierHash, bytes signature);

event ExecutionRequested(bytes32 indexed requestId, address indexed agent, address indexed targetContract, uint256 valueUSD, bool requiresBiometrics);
event ExecutionApproved(bytes32 indexed requestId, uint256 nullifierHash);
event ExecutionExecuted(bytes32 indexed requestId, address indexed targetContract, bool success, bytes returnData);
event ExecutionCancelled(bytes32 indexed requestId);
```
The relayer message is `keccak256(abi.encodePacked(requestId, nullifierHash, address(this), block.chainid))`, signed as an Ethereum signed message.
</details>

<details>
<summary><b>AegisSwapVMAdapter</b></summary>

```solidity
struct SwapInstruction { uint8 opcode; address tokenIn; address tokenOut; uint256 amountIn; uint256 minAmountOut; bytes extraData; }
function executeSwapVMRoute(bytes encodedInstructions) returns (uint256 finalOutputAmount);  // manager only
```
</details>

<details>
<summary><b>AegisUniswapAdapter</b></summary>

```solidity
function executeExactInputSingle(ExactInputSingleParams params, address payer) returns (uint256 amountOut); // manager only
function executeSwap(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 amountOutMinimum, address recipient, address payer) returns (uint256 amountOut);
function swapRouter() view returns (address);
```
</details>

---

## 🧪 Testing

**1. Hardhat EVM Unit Tests (27 passing):**
```bash
cd contracts && npm test
```
Covers subname registration, whitelists, threshold flagging, ENSIP-26 text records, auto-execution under the threshold, Human Approval Gate relayer verification (`approveWithRelayer`), status query helpers (`isRequestPending`, `isRequestReadyForExecution`, `isNullifierUsed`), signature tampering defense, World ID Agent Pass attestation verification, real Uniswap V3 onchain ERC-20 transfers/swaps, slippage guards, and 1inch Aqua deposit/rebalance.

**2. Backend Unit Tests (5 suites passing):**
```bash
cd backend && npm test
```
Validates input sanitization, signal hashing to field elements (`keccak256(x) >> 8`), uint256 bounds, USD-to-Wei 18-decimal fixed-point conversions, and relayer attestation digests.

**3. Full user-flow test** ([`backend/test/e2e.local.js`](backend/test/e2e.local.js), 19 checks). A user wallet does exactly what the browser does, against a local chain:
- register → AI plan → $250 auto-execution → $2,500 pause → approval attestation → approve → execute
- the same human approves a second request; a different human/key is refused
- a stranger can't cancel; the owner can; a cancelled request can't be approved
- an over-limit trade is flagged and refused; an unregistered agent is blocked onchain
- the indexer reports the real history; revoking removes the identity

---

## 🚢 Deployment

The repo ships a production `Dockerfile` that serves the API, landing page and console from one container.

```bash
docker build -t aegisnet .
docker run -p 4000:4000 --env-file backend/.env -e NODE_ENV=production -v aegis-data:/app/data aegisnet
```

It works on any container host (Render, Railway, Fly.io, a VPS). **Production checklist:**

1. `NODE_ENV=production`: binds `0.0.0.0`, locks admin routes and applies strict CORS (`PUBLIC_ORIGIN`).
2. Gateway relayer key is active.
3. `/api/health` → `relayer.matchesContract` is `true`.
4. A volume is mounted at `/app/data`, so the chain index and owner bindings persist.
5. Secrets are set in the host's environment settings. `.env` files are never committed.

---

## 🗺️ Known limitations & roadmap

| Area | Current state | Next step |
| :--- | :--- | :--- |
| **Native Onchain World ID Verifier** | Server-side Agent Pass verification with ECDSA relayer attestation bridge to Sepolia. | Deploy native onchain World ID Groth16 ZK verifier contract on Sepolia |
| **Swap execution** | 100% Real onchain token swaps on Sepolia through Uniswap V3 `SwapRouter02` via `AegisUniswapAdapter`. | Add multi-pool dynamic routing via Uniswap QuoterV2 |
| **`recordSpend` access** | **Fixed**: Restricted strictly to `AegisExecutionManager` via `onlyManager` modifier. | Production audit |
| **Daily limit timing** | **Fixed**: Enforced on `requestExecution` with automatic daily timestamp reset. | Multi-asset aggregate daily budgeting |
| **Uniswap v4 Hook** | Audited and removed to preserve hackathon integrity; real execution standardizes on Uniswap V3. | Re-evaluate v4 once singleton tooling and liquidity mature on testnets |
| **ENS resolution** | Agent names live in AegisNet's registry with full ENSIP-26 text record support. | Issue subnames through the NameWrapper with an L2 CCIP resolver |
| **Scaling** | Rate limits and owner bindings are managed per instance. | Move session state to Redis for distributed horizontally-scaled deployments |

---

## 📄 License

This project is licensed under the **Apache License 2.0** — see the [LICENSE](LICENSE) file for details.
Smart contracts in `contracts/contracts` also carry the MIT SPDX identifier for EVM compatibility.
