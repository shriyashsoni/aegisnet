# 🎥 AegisNet — Video Pitch & Demo Walkthrough Script

> **Target Duration:** 4 to 5 minutes  
> **Audience:** Midnight Buildathon Judges & Technical Reviewers  
> **Topic:** Confidential AI Agent Guardrails with Midnight Compact Dual-Ledger Governance

---

### [0:00 - 0:45] Introduction & The Problem
**Visual:** Slide 1 of Pitch Deck, transition into the live web app (`http://localhost:4000`).

> *"Hello judges and the Midnight community! I'm presenting **AegisNet**, the first confidential guardrail system designed specifically for autonomous AI agents, powered by the **Midnight Network**.*
>
> *Today, autonomous AI agents are trading billions of dollars across Web3. But giving an AI agent a raw private key creates an impossible dilemma:*
> 1. *If the agent is buggy, hallucinating, or prompt-injected, it can drain your entire wallet in seconds.*
> 2. *If you put guardrails and spending limits directly on Ethereum, all your trading strategies, stop-loss triggers, and portfolio limits are completely exposed on the public mempool—leaving you vulnerable to toxic MEV bots and sandwich attacks.*
> 3. *Legacy identity solutions like World ID only tell you if a user is human, but they do nothing to protect confidential financial limits or private operator governance.*
>
> *AegisNet solves this with Midnight."*

---

### [0:45 - 1:40] The Solution: Midnight Dual-Ledger Architecture
**Visual:** Architecture diagram from `README.md` / `PITCH_DECK.md`.

> *"Instead of public execution limits, AegisNet introduces a **Dual-Ledger Zero-Knowledge architecture** using Midnight's smart contract language, **Compact**.*
>
> *Here is how it works:*
> * *In **Private State**—stored strictly client-side—the operator holds their private authorization secret, their shielded spending limits, and their private nonces.*
> * *When an AI agent proposes a high-value trade, the operator proves they authorized the trade inside the **`verify_shielded_approval`** Compact circuit.*
> * *On Midnight's **Public Ledger**, the contract tracks cryptographic single-use **nullifiers** for replay protection and stores verified **execution commitments**.*
> * *Neither the AI agent, nor MEV bots, nor other users ever learn the operator's actual budget or private threshold.*
> * *A verified cross-chain attestation then unlocks execution on Ethereum Sepolia, routing through 1inch SwapVM and agent-gated Uniswap v4 hooks."*

---

### [1:40 - 2:30] Code Architecture & The Compact Contract
**Visual:** Split screen showing `contracts/midnight/AegisPrivateGuardrail.compact` and `contracts/contracts/AegisExecutionManager.sol`.

> *"Let's examine the code. In `AegisPrivateGuardrail.compact`:*
> * *We declare our public state variables: `nullifiers: Set<Bytes<32>>` and `verifiedClearances: Set<Bytes<32>>`.*
> * *We define our private witness inputs: `witness get_owner_secret_key()` and `witness get_shielded_threshold()`.*
> * *Inside the `verify_shielded_approval` circuit, Compact computes the persistent hash of the secret inputs, verifies that the trade complies with the shielded policy, checks that the nullifier hasn't been spent, and discloses the clearance commitment to public state.*
>
> *On the EVM side, `AegisExecutionManager.sol` checks this clearance via `verifyMidnightWithRelayer` or direct on-chain verification before executing the trade."*

---

### [2:30 - 3:50] Live Product Demonstration
**Visual:** Full-screen browser interaction on the live AegisNet Console (`http://localhost:4000/app.html`).

> *"Now let's see AegisNet live in action.*
>
> *1. **Connecting Wallet & Viewing Identities:** We connect our wallet on Sepolia. In the 'Agents' tab, our wallet is registered as an active AI agent under the ENS namespace `agent1.aegisnet.eth`.*
>
> *2. **Under the Hood KPIs:** Opening the under-the-hood dashboard, you can see all microservices online: our Claude AI planner, our contract relayer, and the **Midnight ZK Dual-Ledger active** running `AegisPrivateGuardrail.compact`.*
>
> *3. **Low-Value Autonomous Trade ($250):** Let's test a $250 USDC-to-ETH swap. Claude plans the optimal route, deterministic code builds the calldata, and because $250 is below our shielded $1,000 threshold, it executes automatically on Sepolia in a single transaction.*
>
> *4. **High-Value Confidential Trade ($2,500):** Now let's try a whale-size trade: $2,500. Claude formulates the SwapVM strategy, but the moment it hits Sepolia, AegisExecutionManager detects that it exceeds the threshold and pauses the trade onchain.*
>
> *5. **The Midnight ZK Shield Modal:** Instantly, our Midnight ZK modal appears! You can see the Compact circuit `verify_shielded_approval`, our shielded private state, and the public nullifier generation. We click **'Generate Midnight ZK Proof & Approve'**.*
>
> *6. **Verification & Execution:** The zero-knowledge proof is generated locally, verified on the dual-ledger, committed to the public nullifier set, and dispatched to Sepolia. Boom—the trade executes with 100% mathematical integrity without leaking our private limits!"*

---

### [3:50 - 4:20] Live Testing & Reliability
**Visual:** Terminal showing test runs passing.

> *"Judges can verify all of this locally. Running:*
> ```bash
> cd contracts && npm test
> ```
> *Executes all 9 EVM protocol tests on Hardhat.*
>
> *And running:*
> ```bash
> npm run test:midnight
> ```
> *Runs our Compact simulation test suite, proving state initialization, nullifier replay defense, and circuit bounds across 6 comprehensive tests."*

---

### [4:20 - 4:45] Conclusion & Wave 3 Roadmap
**Visual:** Slide 10 of Pitch Deck & GitHub repository showing Apache 2.0 license and `midnightntwrk` tag.

> *"AegisNet transforms Midnight into the critical security and privacy layer for the future of autonomous agentic finance. All code is open-source under Apache License 2.0 and tagged with `midnightntwrk`.*
>
> *Thank you, and we look forward to building in the Midnight ecosystem throughout Wave 3 and beyond!"*
