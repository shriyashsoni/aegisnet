# 🛡️ AegisNet

[![Midnight Network](https://img.shields.io/badge/Midnight-Dual--Ledger%20ZK-7B2CBF?style=for-the-badge&logo=shield)](https://midnight.network)
[![Language: Compact 0.20](https://img.shields.io/badge/Language-Compact%200.20-5A189A?style=for-the-badge)](contracts/midnight/AegisPrivateGuardrail.compact)
[![Buildathon: Wave 3 Qualified](https://img.shields.io/badge/Buildathon-Wave%203%20Qualified-success?style=for-the-badge)](PITCH_DECK.md)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg?style=for-the-badge)](LICENSE)
[![GitHub Label](https://img.shields.io/badge/Topic-midnightntwrk-black?style=for-the-badge)](https://github.com/shriyashsoni/brixs-)

**Privacy-preserving guardrails for autonomous AI agents on Ethereum, powered by Midnight Network's Dual-Ledger Zero-Knowledge Smart Contracts.** Each agent receives an ENS-style identity with hard spending limits enforced onchain. Claude plans trades in plain English, and high-value trades pause until a verified human owner provides client-side zero-knowledge proof of authorization via **Midnight Compact** circuits without revealing private thresholds or biometric owner keys.

> Live on **Ethereum Sepolia** · Midnight Smart Contracts in **Compact 0.20** · Solidity 0.8.24 · Backend in TypeScript · Wallet-signed web app · [Pitch Deck](PITCH_DECK.md) · [Demo Video Script](DEMO_SCRIPT.md)

| | |
| :--- | :--- |
| **Network** | Ethereum Sepolia (chain ID `11155111`) + Midnight Testnet |
| **Midnight Contract** | [`AegisPrivateGuardrail.compact`](contracts/midnight/AegisPrivateGuardrail.compact) (Compact 0.20) |
| **Root name** | `aegisnet.eth` |
| **EVM Contracts** | 5 deployed ([addresses](#-deployed-contracts-sepolia)) |
| **Integrations** | Midnight Network (Dual-Ledger ZK) · ENS · 1inch SwapVM & Aqua · Uniswap v4 hooks · Anthropic Claude |
| **Hackathon / Wave** | Midnight Buildathon — Wave 3 ($5,000 Grant Pool & Build Club Entry) |

---

## Table of contents

1. [The problem](#-the-problem)
2. [How AegisNet solves it](#-how-aegisnet-solves-it)
3. [Midnight Dual-Ledger Architecture](#-midnight-dual-ledger-architecture)
4. [Deployed contracts (Sepolia)](#-deployed-contracts-sepolia)
5. [Live onchain proof](#-live-onchain-proof)
6. [Integrations](#-integrations)
7. [Architecture](#-architecture)
8. [How a trade flows](#-how-a-trade-flows)
9. [Security model](#-security-model)
10. [Repository structure](#-repository-structure)
11. [Getting started](#-getting-started)
12. [Configuration](#-configuration)
13. [REST API](#-rest-api)
14. [Smart contract reference](#-smart-contract-reference)
15. [Testing](#-testing)
16. [Deployment](#-deployment)
17. [Known limitations & roadmap](#-known-limitations--roadmap)
18. [License](#-license)

---

## 🎯 The problem

To trade on your behalf, an AI agent needs a wallet key. That creates three critical vulnerabilities:

1. **Unlimited power.** A raw private key can do anything. If the agent is buggy, hacked or prompt-injected, it can drain treasury assets in seconds.
2. **Zero human oversight or privacy leaks.** Either trades execute with no human confirmation, or high-value approvals leak the owner's personal identity, approval thresholds, and balance triggers on a public ledger.
3. **No identity or accountability.** An agent is just an anonymous address, with no verifiable owner, spending boundaries, or governance rules attached to it.

## 💡 How AegisNet solves it

| Layer | What it does | Where |
| :--- | :--- | :--- |
| **Identity & limits** | Every agent is registered as `name.aegisnet.eth` with an owner, a whitelist of contracts it may call, a daily spending limit and an approval threshold. | `AegisSubnameRegistry` |
| **Execution gate** | Agents can't act directly. They submit requests to the manager, which checks identity and whitelist onchain. Under the threshold a trade runs immediately; at or above it, the trade pauses. | `AegisExecutionManager` |
| **Midnight ZK Guardrail** | A paused trade executes only after the owner proves authorization using **Midnight Network's Compact ZK circuit**. Owner secret keys and approval thresholds remain in **private state/witness**, while the nullifier and clearance are committed to **Midnight's public ledger**, bridged via attestation to Ethereum. | `AegisPrivateGuardrail.compact` + Backend + `AegisExecutionManager` |
| **AI planning** | **Claude** turns a plain-English goal into a structured strategy and explains it. Deterministic code, not the model, builds the transaction. | Backend |
| **Routing** | Strategies compile to **1inch SwapVM** opcodes, including an **agent-gated Uniswap v4 hook** hop. | `AegisSwapVMAdapter`, `AegisUniswapV4Hook` |
| **Kill switch** | The owner can cancel any pending trade, lower limits or revoke the agent in one transaction. | `AegisSubnameRegistry`, `AegisExecutionManager` |

**The result:** small trades run autonomously, large trades require private zero-knowledge human authorization, and unauthorized or malicious actions are blocked before execution.

---

## 🌙 Midnight Dual-Ledger Architecture

AegisNet leverages Midnight's breakthrough **Dual-Ledger Model** to separate sensitive private owner credentials from public execution state:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT / OWNER PRIVATE STATE                    │
│  - Owner Secret Key (owner_sk)                                         │
│  - Shielded Approval Threshold (shielded_threshold)                    │
│  - Request Authorization Salt & Ephemeral Nonce                        │
│                                                                        │
│  Witness generation executes locally in browser / prover sandbox.     │
│  Never broadcast over RPC, never stored in mempool or public ledgers.  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Evaluates ZK Circuit
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     MIDNIGHT NETWORK (Compact 0.20)                    │
│  Contract: AegisPrivateGuardrail.compact                               │
│  - Circuit: verify_shielded_approval(...)                              │
│  - Public Ledger State:                                                │
│      • nullifiers: Set<Bytes<32>>        (Replay attack prevention)    │
│      • verifiedClearances: Set<Bytes<32>> (ZK clearance commitment)     │
│      • agentPolicies: Map<Bytes<32>, Bytes<32>> (Policy hash binding)  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Relayer Attestation Bridge
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        ETHEREUM SEPOLIA (EVM)                          │
│  Contract: AegisExecutionManager.sol                                   │
│  - verifyMidnightWithRelayer(requestId, nullifier, signature)          │
│  - executeVerifiedTransaction(requestId) -> SwapVM Router              │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📜 Deployed contracts (Sepolia)

| Contract | Address | Role |
| :--- | :--- | :--- |
| **AegisSubnameRegistry** | [`0x48EEFC9F26181Bd059daCc3EF9fD70F197145373`](https://sepolia.etherscan.io/address/0x48EEFC9F26181Bd059daCc3EF9fD70F197145373) | Agent identities, owners, whitelists, limits, ENSIP-26 text records |
| **AegisExecutionManager** | [`0xa7C668691382166eF71534a1996F60F6f218b887`](https://sepolia.etherscan.io/address/0xa7C668691382166eF71534a1996F60F6f218b887) | Request queue, Midnight ZK guardrail gate, execution, cancellation |
| **AegisSwapVMAdapter** | [`0x3fE49BC40C1f06d3D867ed6AaDA5b21a0cF4c611`](https://sepolia.etherscan.io/address/0x3fE49BC40C1f06d3D867ed6AaDA5b21a0cF4c611) | 1inch SwapVM opcode router (manager-only) |
| **AegisUniswapV4Hook** | [`0xe2fc1252390B6AcC180Cd43998130a478E2a66b6`](https://sepolia.etherscan.io/address/0xe2fc1252390B6AcC180Cd43998130a478E2a66b6) | Agent-gated `beforeSwap` hook |
| **MidnightVerifier** | [`0x15f25Fc3261B8d3cFb23679B9E65f4D030501623`](https://sepolia.etherscan.io/address/0x15f25Fc3261B8d3cFb23679B9E65f4D030501623) | Verifier for the onchain Midnight ZK proof path |

- **Deployer, protocol owner and relayer signer:** [`0x9eeAb92431FD385981735dbF5B949b6C4c2eBC39`](https://sepolia.etherscan.io/address/0x9eeAb92431FD385981735dbF5B949b6C4c2eBC39)
- **Deployment record:** [`contracts/deployment-config.json`](contracts/deployment-config.json), mirrored to [`backend/src/config/contracts.json`](backend/src/config/contracts.json)

## 🔗 Live onchain proof

Real transactions on Sepolia, made through these contracts by agent `agent1.aegisnet.eth`:

| What happened | Transaction |
| :--- | :--- |
| Agent `agent1.aegisnet.eth` registered | [`0x3156c01b…6d4d`](https://sepolia.etherscan.io/tx/0x3156c01b0e9aad93714adc60d271e34aa53269517897c21cc7b1d703deb66d4d) |
| $500 trade: under the threshold, executed in the same transaction | [`0x2e9c6287…1c1c`](https://sepolia.etherscan.io/tx/0x2e9c628703817b597085eea8f18ad83bb4af2911371ab4950326fbb1da9b6c1c) |
| $5,000 trade: paused onchain for Midnight ZK Guardrail approval | [`0x16dbde9f…0843`](https://sepolia.etherscan.io/tx/0x16dbde9f959b5888e73be12242c802d6edb449275f2b64c00094ede7d7890843) |
| $5,000 trade: Midnight ZK clearance approval recorded | [`0xe8727000…4a23`](https://sepolia.etherscan.io/tx/0xe8727000356eac97aaa3016fded601610d84c3d16f000599caf0be8503e84a23) |
| $5,000 trade: executed after approval | [`0x464cbae2…a442`](https://sepolia.etherscan.io/tx/0x464cbae20084ce7b818e7e91e0ed5b0afc7614951dd1fcada3cd36a94a0ca442) |
| $250 trade: under the threshold, executed in the same transaction | [`0xb97675a0…543f`](https://sepolia.etherscan.io/tx/0xb97675a0cebb90e74be8c23d13c44cb5f08087f511c40f6ea656d5ce3d50543f) |

---

## 🤝 Integrations

### 🌙 Midnight: Privacy-Preserving Dual-Ledger ZK Guardrail
- **Compact Smart Contract:** [`contracts/midnight/AegisPrivateGuardrail.compact`](contracts/midnight/AegisPrivateGuardrail.compact) written in Midnight's Compact domain-specific language (`pragma language_version >= 0.20;`).
- **Dual-Ledger Model:**
  - **Private State / Witness:** The owner's secret key (`owner_sk`), shielded authorization threshold (`shielded_threshold`), and request authorization salt remain client-side, never exposed to any public chain or indexer.
  - **Public Ledger State:** `nullifiers: Set<Bytes<32>>`, `verifiedClearances: Set<Bytes<32>>`, and `agentPolicies: Map<Bytes<32>, Bytes<32>>` prevent replay attacks and commit verified clearances transparently.
- **Zero-Knowledge Circuit Verification:** Compiles with `compactc` and tested with Mocha simulated execution (`npm run test:midnight`).
- **Cross-Ledger Bridge:** Attestation signature from the relayer binds the Midnight nullifier and request clearance to Ethereum Sepolia `AegisExecutionManager.verifyMidnightWithRelayer`.
- **Backward Compatibility:** Legacy `/api/worldid` endpoints alias directly to `/api/midnight` for seamless interoperability.

### ENS: agent identity & access control
- Each agent gets a hierarchical name under the root, for example `agent1.aegisnet.eth`. Its node is `keccak256(rootNode, keccak256(label))`, following ENS namehash.
- **Enhanced Access Control (EAC):** a per-agent whitelist of callable contracts, a daily spending limit and a shielded approval threshold, all checked by `isAgentAuthorized`.
- **ENSIP-26 text records** such as `agent.capabilities` and `agent.description`.

### 1inch: SwapVM & Aqua
- Strategies compile to custom SwapVM instruction lists executed by `AegisSwapVMAdapter`:

| Opcode | Name | Purpose |
| :---: | :--- | :--- |
| `0x01` | `OP_EXCHANGE_SWAP` | Direct aggregator swap |
| `0x02` | `OP_SPLIT_ROUTE` | Split order across liquidity sources |
| `0x03` | `OP_VERIFY_MIN_OUTPUT` | Slippage guard, reverts below the minimum |
| `0x04` | `OP_UNISWAP_V4_HOP` | Hop through the agent-gated Uniswap v4 hook |
| `0x05` | `OP_AQUA_DEPOSIT` | Open a 1inch Aqua liquidity position |
| `0x06` | `OP_AQUA_WITHDRAW` | Rebalance and harvest the Aqua position |

- Optional live mainnet price quotes come from the **1inch Swap API** (`ONEINCH_API_KEY`).

### Uniswap Foundation: v4 hooks
- `AegisUniswapV4Hook.beforeSwap` checks the trading agent's permissions in the registry. It refuses any trade that would need human approval, so the Midnight ZK gate cannot be bypassed.
- Pools can be switched to agents-only with `setPoolGated` (hook owner only).

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
│  Wallet (EIP-6963, any extension)    Midnight ZK Shield Modal    │
│                                       (Private Witness Sandbox)   │
└───────────┬───────────────────────────────────────┬──────────────┘
            │ signs EVM actions                     │ ZK proof & witness
            ▼                                       ▼
┌──────────────────────── Ethereum Sepolia ───────┐ ┌──────── Backend (Node/Express) ─────────┐
│ AegisSubnameRegistry   identity · limits        │ │ Claude planner   plan → calldata        │
│ AegisExecutionManager  queue · gate · execute   │◄┤ Midnight Bridge  verify → attestation   │
│ AegisSwapVMAdapter     1inch SwapVM opcodes     │ │ Chain indexer    events → activity      │
│ AegisUniswapV4Hook     agent-gated beforeSwap   │►┤ Serves the web app + vendored libs      │
└─────────────────────────────────────────────────┘ └─────────────────────────────────────────┘
```

**Design principles**

- **Users sign, the server doesn't.** Registering, changing limits, trading, approving and cancelling are all signed by the user's own wallet. The backend never holds user keys and never pays for user actions.
- **Privacy by default.** Midnight ensures the owner's threshold and secret keys never leak to public blockchain explorers.
- **AI proposes, code decides.** Claude's output is restricted to a schema. Transactions are built deterministically and enforced onchain.
- **The chain is the source of truth.** Activity and agent lists come from contract events, not a private database.


---

## 🔄 How a trade flows

```
1. Plan      POST /api/agent/propose           → Claude plan + encoded SwapVM calldata
2. Submit    agent wallet → requestExecution(adapter, calldata, valueUSD)
               ├─ under the threshold → executes in the same transaction ✅
               └─ at or above        → ExecutionRequested(requiresBiometrics = true) ⏸
3. Verify    owner opens Midnight ZK Shield modal (local witness generation in browser sandbox)
             Evaluates AegisPrivateGuardrail.compact circuit (owner_sk, shielded_threshold, salt)
             POST /api/midnight/attest         → relayer signature + dual-ledger nullifier
4. Approve   owner wallet → verifyMidnightWithRelayer(requestId, nullifier, signature)
5. Execute   owner wallet → executeVerifiedTransaction(requestId)   ✅
   or Cancel owner/agent wallet → cancelExecution(requestId)        ❌ funds never move
```

| Action | Signed by | Contract call |
| :--- | :--- | :--- |
| Register an agent (+ allow the SwapVM adapter and Uniswap hook) | Owner wallet | `registerSubname`, `setTargetContractWhitelist` ×2 |
| Change threshold, whitelist, text records, revoke | Owner wallet | `updateBiometricThreshold`, `setTargetContractWhitelist`, `setTextRecord`, `revokeSubname` |
| Submit a trade | Agent wallet | `requestExecution` |
| Approve a paused trade | Owner's Midnight ZK Shield + wallet | `/api/midnight/attest` → `verifyMidnightWithRelayer` → `executeVerifiedTransaction` |
| Cancel a trade | Owner or agent wallet | `cancelExecution` |
| Gate a Uniswap v4 pool | Hook owner wallet | `setPoolGated` |

---

## 🔐 Security model

**Midnight Zero-Knowledge & Dual-Ledger Guarantees**
- **Client-Side Witness:** The owner's secret key (`owner_sk`) and shielded approval threshold never touch the RPC or backend; they exist strictly in client-side witness memory.
- **Circuit Integrity:** `AegisPrivateGuardrail.compact` enforces that `shielded_threshold <= requested_amount` and verifies that the owner's commitment matches the registered agent policy hash.
- **Nullifier Protection:** Midnight's public ledger records each trade nullifier in `nullifiers: Set<Bytes<32>>`. A nullifier cannot be consumed more than once, preventing replay attacks across trades.
- **Attestation Bridge:** The relayer signature links the Midnight nullifier directly to the Sepolia `requestId`, `managerAddress`, and `chainId`.

**Onchain EVM Guarantees**
- Only registered, active agents can submit requests, and only to whitelisted targets. Anything else reverts with `Agent or target not authorized by ENS EAC`.
- A request at or above the threshold cannot execute until a valid Midnight ZK clearance attestation is recorded.
- Only the owner, the agent or the protocol owner can cancel a request. The daily spending limit is enforced when the trade executes.

**Backend Guarantees**
- A Midnight ZK proof is only accepted for a request that exists onchain and is still pending, tied to that request by the signal.
- Each owner is bound to one verified human/key: after the first approval, an unauthorized key is refused.
- Trades that would exceed the daily limit are flagged in the plan, blocked in the console and refused at attestation, so no gas is wasted on a trade certain to revert.
- In production (`NODE_ENV=production`):
  - Routes that make the backend wallet transact are disabled unless `ADMIN_API_KEY` is set, and then need the `x-api-key` header.
  - Security headers, strict CORS and per-IP rate limits on the AI and Midnight endpoints.
- At startup the backend checks that its key is the contract's `relayerSigner` and reports the result in `/api/health`.

---

## 📁 Repository structure

```
.
├── LICENSE                            Apache License 2.0 (Midnight Buildathon requirement)
├── PITCH_DECK.md                      10-slide comprehensive deck for Wave 3 submission
├── DEMO_SCRIPT.md                     4-5 minute demo walkthrough and recording script
├── contracts/                         Hardhat & Midnight Compact project
│   ├── midnight/                      Midnight Network Smart Contract suite
│   │   ├── AegisPrivateGuardrail.compact  Compact 0.20 Dual-Ledger ZK contract
│   │   ├── test/                      Midnight circuit simulation test suite
│   │   │   └── AegisPrivateGuardrail.test.js  6/6 passing Mocha unit tests
│   │   └── README.md                  Compact compilation and circuit documentation
│   ├── contracts/
│   │   ├── AegisSubnameRegistry.sol   Identity, EAC permissions, text records
│   │   ├── AegisExecutionManager.sol  Request queue, Midnight ZK gate, execution
│   │   ├── AegisSwapVMAdapter.sol     1inch SwapVM / Aqua opcode router
│   │   ├── AegisUniswapV4Hook.sol     Agent-gated beforeSwap hook
│   │   ├── interfaces/                IAegisSubnameRegistry, IMidnightVerifier
│   │   └── mocks/                     MockERC20, MockMidnightVerifier
│   ├── scripts/                       deploy.js (local), deploy-sepolia.js, execute-sepolia-demo.js
│   ├── test/AegisNet.test.js          Hardhat EVM protocol test suite (9/9 passing)
│   └── deployment-config.json         Sepolia deployment record
├── backend/                           TypeScript API (Express + ethers v6)
│   ├── src/
│   │   ├── index.ts                   Server, health, security, static app
│   │   ├── abis.ts                    Contract ABIs (with Midnight verification methods)
│   │   ├── chain.ts                   Provider, signer, serialized tx sending
│   │   ├── middleware.ts              Admin gate, rate limiter, security headers
│   │   ├── routes/                    agent · ens · execution · midnight · uniswap
│   │   └── services/
│   │       ├── claudePlanner.service.ts   Claude structured-output planner
│   │       ├── aiAgent.service.ts         Plan → SwapVM calldata, limit checks, quotes
│   │       ├── midnight.service.ts        Midnight ZK proof check, binding, attestation
│   │       ├── indexer.service.ts         Contract event indexer
│   │       └── swapvm / ens / uniswap / execution services
│   ├── test/e2e.local.js              Full user-flow test (19 checks)
│   └── .env.example                   Every configuration option, documented
├── frontend/                          Static web app served by the backend
│   ├── index.html                     Landing page (Midnight Dual-Ledger hero & architecture)
│   ├── app.html · app.js · app.css    Console (dashboard, agents, AI strategy, Midnight ZK Shield)
│   ├── wallet.js                      Multi-wallet connect (EIP-6963), Sepolia switching
│   ├── chain.js                       Wallet-signed contract calls
│   └── docs.html · whitepaper.html    Midnight Dual-Ledger protocol docs & whitepaper
├── Dockerfile                         Production image (API + app)
└── .gitignore / .dockerignore         Secrets and build output excluded
```

---

## 🚀 Getting started

### Prerequisites
- Node.js **20+**
- A browser wallet (MetaMask, Rabby, Coinbase Wallet…) with a little **Sepolia ETH** ([faucet](https://www.alchemy.com/faucets/ethereum-sepolia))
- Optional: an [Anthropic API key](https://console.anthropic.com/) for Claude planning
- Optional: Midnight Compact compiler (`compactc`) for compiling `.compact` contracts directly

### 1. Clone and install
```bash
git clone https://github.com/shriyashsoni/brixs-.git
cd brixs-
cd contracts && npm install
cd ../backend && npm install
```

### 2. Run Test Suites
```bash
# 1. Run Midnight Compact circuit simulation suite (6 tests)
cd contracts
npm run test:midnight

# 2. Run EVM Hardhat protocol test suite (9 tests)
npm test
```

### 3. Configure
```bash
cp backend/.env.example backend/.env
# fill in SEPOLIA_RPC_URL, PRIVATE_KEY (relayer), MIDNIGHT_NETWORK, and optionally ANTHROPIC_API_KEY
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
4. **Trade → $2,500.** It pauses onchain; click **Authorize with Midnight ZK Shield** to generate a client-side witness and submit the zero-knowledge attestation.
5. **Start & cancel** a trade to verify the onchain kill switch.

### Deploy your own contracts (optional)
```bash
cd contracts
# contracts/.env: SEPOLIA_RPC_URL, PRIVATE_KEY, ENS_ROOT_NAME
npm run deploy:sepolia      # writes deployment-config.json and backend/src/config/contracts.json
```

---

## ⚙️ Configuration

All options are documented in [`backend/.env.example`](backend/.env.example). The main ones:

| Variable | Required | Description |
| :--- | :---: | :--- |
| `SEPOLIA_RPC_URL` | ✅ | Sepolia RPC endpoint (Alchemy, Infura…). Archive access lets the indexer find the deploy block automatically. |
| `PRIVATE_KEY` | ✅ | Relayer key that signs Midnight ZK attestations. Must be the manager's `relayerSigner`. |
| `MIDNIGHT_NETWORK` | | `testnet` (default), `devnet`, or `local` |
| `MIDNIGHT_PROOF_MODE` | | `circuit` (default, simulated compact circuit) or `mock` |
| `ENS_ROOT_NAME` | | Root name for agents (default `aegisnet.eth`) |
| `BIOMETRIC_THRESHOLD_USD` | | Default approval threshold (default `1000`) |
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
| `GET` | `/api/health` | Network, relayer check, contracts, Midnight, AI and indexer status |
| `GET` | `/api/abis` | Contract ABIs used by the web app |
| `POST` | `/api/agent/propose` | Plan a trade (Claude or rules) and return calldata. Nothing is sent onchain. *Rate limited.* |
| `POST` | `/api/midnight/attest` | Verify a Midnight ZK proof for a paused request and return the relayer attestation. *Rate limited.* |
| `GET` | `/api/midnight/config` | Midnight ZK Shield configuration and contract bindings |
| `GET` | `/api/midnight/binding/:owner` | Whether an owner has a registered shielded key |
| `GET` | `/api/execution/requests?agent=&owner=` | Every request, indexed from chain events |
| `GET` | `/api/execution/:requestId` | One request |
| `POST` | `/api/execution/refresh` | Index the latest block now |
| `GET` | `/api/ens/agents?owner=&agent=` | Registered agents |
| `GET` | `/api/ens/permissions/:agentAddress` | An agent's live limits and spend |
| `GET` | `/api/ens/whitelist/:node/:target` | Whether a target is allowed |
| `GET` | `/api/ens/text-record/:node/:key` | ENSIP-26 text record |
| `GET` | `/api/uniswap/pools/:poolId` | Uniswap v4 pool gating |

*(Note: Legacy `/api/worldid/*` routes are preserved as backwards-compatible aliases to `/api/midnight/*`)*

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
    "summary": "Swap $2,500 of USDC into ETH through 1inch with an agent-gated Uniswap v4 hop.",
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
<summary><b>AegisPrivateGuardrail (Compact 0.20)</b></summary>

```rust
// contracts/midnight/AegisPrivateGuardrail.compact
export circuit verify_shielded_approval(
    request_id: Bytes<32>,
    owner_pk: Bytes<32>,
    requested_amount: Uint<64>,
    target_contract: Bytes<32>
): [Bytes<32>, Bytes<32>]

export circuit register_agent_policy(
    agent_id: Bytes<32>,
    policy_hash: Bytes<32>
): []

export circuit revoke_clearance(
    request_id: Bytes<32>
): []
```
*Private witness functions:* `get_owner_secret_key()`, `get_shielded_threshold()`, `get_authorization_salt()`.
</details>

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
function verifyMidnightWithRelayer(bytes32 requestId, uint256 nullifierHash, bytes signature);
function submitMidnightProof(bytes32 requestId, uint256 root, uint256 nullifierHash, uint256[8] proof);  // onchain ZK path
function executeVerifiedTransaction(bytes32 requestId) returns (bool success, bytes returnData);
function cancelExecution(bytes32 requestId);   // owner, agent or protocol owner

// Backwards-compatible aliases:
function verifyBiometricsWithRelayer(bytes32 requestId, uint256 nullifierHash, bytes signature);
function submitBiometricProof(bytes32 requestId, uint256 root, uint256 nullifierHash, uint256[8] proof);

event ExecutionRequested(bytes32 indexed requestId, address indexed agent, address indexed targetContract, uint256 valueUSD, bool requiresBiometrics);
event ExecutionMidnightVerified(bytes32 indexed requestId, uint256 nullifierHash);
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
<summary><b>AegisUniswapV4Hook</b></summary>

```solidity
function setPoolGated(bytes32 poolId, bool isGated);                                  // hook owner
function beforeSwap(address sender, bytes32 poolId, uint256 amountUSD) returns (bytes4);
```
</details>

---

## 🧪 Testing

**1. Midnight Compact Simulation Tests (6 passing):**
```bash
cd contracts && npm run test:midnight
```
Covers:
- Successful shielded clearance generation with valid witnesses
- Nullifier derivation and double-spend replay prevention in `nullifiers: Set<Bytes<32>>`
- Authorization rejection when requested amount is below shielded threshold
- Authorization rejection on mismatched owner secret keys
- Dual-ledger clearance commitment in `verifiedClearances: Set<Bytes<32>>`
- Agent policy registration in `agentPolicies: Map<Bytes<32>, Bytes<32>>`

**2. Hardhat EVM Unit Tests (9 passing):**
```bash
cd contracts && npm test
```
Covers subname registration, whitelists, threshold flagging, ENSIP-26 text records, auto-execution under the threshold, Midnight ZK relayer verification (`verifyMidnightWithRelayer`), backward-compatible `verifyBiometricsWithRelayer`, gated Uniswap v4 swaps, and 1inch Aqua deposit/rebalance.

**3. Full user-flow test** ([`backend/test/e2e.local.js`](backend/test/e2e.local.js), 19 checks). A user wallet does exactly what the browser does, against a local chain:
- register → AI plan → $250 auto-execution → $2,500 pause → Midnight ZK attestation → approve → execute
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
2. `MIDNIGHT_PROOF_MODE=circuit` (default). Midnight relayer key is active.
3. `/api/health` → `relayer.matchesContract` is `true`.
4. A volume is mounted at `/app/data`, so the chain index and Midnight owner bindings persist.
5. Secrets are set in the host's environment settings. `.env` files are never committed.

---

## 🗺️ Known limitations & roadmap

| Area | Current state | Next step |
| :--- | :--- | :--- |
| **Direct Midnight Onchain Settlement** | Relayer bridge relays verified Midnight proofs to Sepolia via ECDSA attestation. | Deploy native cross-chain ZK SNARK verifier contract on Sepolia directly verifying Midnight state transitions |
| **Swap execution** | `AegisSwapVMAdapter` computes output amounts but doesn't move tokens yet. Identity, limits, the Midnight ZK gate and execution are fully onchain. | Route opcodes into real DEX liquidity on Sepolia |
| **`recordSpend` access** | `AegisSubnameRegistry.recordSpend` has no access control, so anyone can inflate an agent's daily spend and block it for the day. | Restrict it to the execution manager |
| **Daily limit timing** | Checked only when a trade executes, so an over-limit trade can still be queued. The app blocks it before signing and refuses to attest it. | Also check in `requestExecution` |
| **Uniswap v4 hook** | `beforeSwap` trusts a `sender` argument the caller supplies, and the hook isn't attached to a real v4 PoolManager. | Implement `IHooks` and register with the PoolManager |
| **ENS resolution** | Agent names live in AegisNet's registry, not ENS's NameWrapper, so ENS apps don't resolve them. | Issue subnames through the NameWrapper with a custom resolver |
| **Scaling** | Rate limits and Midnight owner bindings are per instance. | Move them to Redis or a database for multi-instance deployments |

---

## 📄 License

This project is licensed under the **Apache License 2.0** — see the [LICENSE](LICENSE) file for details.
Smart contracts in `contracts/contracts` also carry the MIT SPDX identifier for EVM compatibility.

