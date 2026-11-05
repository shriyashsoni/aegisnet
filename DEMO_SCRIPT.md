# 🎥 AegisNet — Video Pitch & Demo Walkthrough Script

> **Target Duration:** 3 to 4 minutes  
> **Topic:** Autonomous AI Agent Guardrails with ENS Identity, Human Approval Gate, 1inch SwapVM & Uniswap v4

---

### [0:00 - 0:45] Introduction & The Problem
**Visual:** Live web app (`http://localhost:4000`) and console (`app.html`).

> *"Hello judges! I'm presenting **AegisNet**, an onchain guardrail and execution infrastructure designed specifically for autonomous AI trading agents.*
>
> *Today, autonomous AI agents are trading across Web3. But giving an AI agent an unconstrained private key creates major risks:*
> 1. *If the agent encounters a bug, hallucinates, or gets prompt-injected, it can drain your entire wallet.*
> 2. *Existing smart contract wallets lack dynamic human-in-the-loop gates for high-value operations.*
> 3. *Agents need verifiable cryptographic identities and granular boundaries without crippling autonomous operation.*
>
> *AegisNet solves this with a multi-layered security matrix on Ethereum Sepolia."*

---

### [0:45 - 1:40] The Solution: Four-Pillar Guardrail Architecture
**Visual:** Architecture diagram from `README.md`.

> *"AegisNet implements four interlocking layers:*
> * **ENS Hierarchical EAC:** Every agent is bound to an ENS subname (e.g. `agent1.aegisnet.eth`) with strict onchain permissions: whitelisted contracts, daily spending caps, and human biometric approval thresholds.*
> * **Claude AI Strategic Planner:** Plans optimal execution strategies compiled to deterministic calldata.*
> * **1inch SwapVM & Uniswap v4:** Strategy calldata is routed via SwapVM opcodes, verified against an agent-gated Uniswap v4 hook that checks caller permissions.*
> * **Human Approval Gate:** If an agent's proposed action meets or exceeds its approval threshold, `AegisExecutionManager.sol` pauses the trade onchain until the human owner authorizes it via a cryptographic relayer attestation (ready for World ID proof-of-humanity)."*

---

### [1:40 - 2:30] Code Architecture & Smart Contracts
**Visual:** Split screen showing `contracts/contracts/AegisSubnameRegistry.sol` and `contracts/contracts/AegisExecutionManager.sol`.

> *"Let's look at the smart contracts:*
> * In `AegisSubnameRegistry.sol`, agent identities, daily spending allowances, contract whitelists, and threshold parameters are registered and enforced.*
> * In `AegisExecutionManager.sol`, execution requests are evaluated. Sub-threshold trades execute immediately; trades meeting or exceeding the threshold require `approveWithRelayer(requestId, nullifierHash, signature)`.*
> * Replay protection is enforced onchain with single-use nullifiers (`usedNullifiers[nullifierHash] = true`)."*

---

### [2:30 - 3:50] Live Product Demonstration
**Visual:** Full-screen browser interaction on the live AegisNet Console (`http://localhost:4000/app.html`).

> *"Now let's see AegisNet live in action:*
>
> 1. **Connecting Wallet & Viewing Identities:** We connect our wallet on Sepolia. In the 'Agents' tab, our wallet is registered as an active AI agent under the ENS namespace `agent1.aegisnet.eth`.*
>
> 2. **Under the Hood KPIs:** Opening the under-the-hood dashboard, all microservices are online: Claude AI planner, indexer, contract relayer, and the Human Approval Gate.*
>
> 3. **Low-Value Autonomous Trade ($250):** We run a $250 USDC-to-ETH swap. Because $250 is below our $1,000 threshold, it executes automatically on Sepolia in a single transaction.*
>
> 4. **High-Value Guardrailed Trade ($2,500):** Now let's try a whale-size trade: $2,500. `AegisExecutionManager` intercepts the request and places it in pending status onchain.*
>
> 5. **Human Approval Gate Modal:** The Human Approval Gate modal appears. The human operator reviews the trade parameters and approves the action.*
>
> 6. **Relayer Attestation & Execution:** The cryptographic relayer attestation is signed with a single-use nullifier, verified onchain via `approveWithRelayer`, and executed atomically!"*

---

### [3:50 - 4:20] Live Testing & Reliability
**Visual:** Terminal showing Hardhat tests passing.

> *"Judges can verify all of this locally. Running:*
> ```bash
> cd contracts && npm test
> ```
> *Executes all EVM protocol tests on Hardhat with 100% passing results."*
