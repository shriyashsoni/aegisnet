# 🛡️ AegisNet — Pitch Deck (Midnight Buildathon)

> **Confidential Guardrails for Autonomous AI Agents powered by Midnight Zero-Knowledge Privacy**
>
> *Track: Midnight 3-Wave Builder Program for Privacy-First Apps*  
> *License: Apache-2.0 · GitHub Topic: `midnightntwrk`*

---

## Slide 1: Title & Core Vision

### 🛡️ AegisNet: The Confidential AI Agent Matrix
**Programmable Data Protection & Human-in-the-Loop Safeguards for Autonomous Onchain Intelligence**

* **Mission:** Enable autonomous AI agents to execute complex financial strategies without giving up user privacy, leaking proprietary risk thresholds, or exposing wallets to catastrophic model failure.
* **Core Technology:** Midnight Network (Compact ZK Smart Contracts) + Ethereum Sepolia Settlement + Anthropic Claude AI + 1inch SwapVM.

---

## Slide 2: The Problem

### The AI Agent Trust & Privacy Crisis in Web3
1. **Unbounded Private Keys:** To trade autonomously, an AI agent holds raw wallet keys. Prompt injections, logic bugs, or poisoned price oracles can liquidate entire treasuries in a single transaction block.
2. **The Zero-Privacy Trilemma on Public Chains:**
   * Risk parameters, stop-loss trigger levels, and daily spending caps are completely visible in public EVM state.
   * MEV bots, sandwichers, and adversarial arbitrageurs exploit this transparency to front-run agent orders.
3. **The Human-in-the-Loop Dilemma:**
   * Traditional identity/human checks (like World ID or OAuth) only prove "is human", but leak *who* approved *what* and *when* on the public ledger.

---

## Slide 3: The Breakthrough Solution

### Confidential Dual-Ledger AI Guardrails
AegisNet solves this crisis by pairing **Ethereum's liquidity & DeFi protocols** with **Midnight's Dual-Ledger Zero-Knowledge privacy**:

* **Shielded Risk Envelope (Midnight Private State):** The human owner's authorization keys, spending thresholds, and risk bounds remain strictly confidential client-side.
* **Tamper-Proof Verification (Midnight Public State):** The Compact smart contract verifies zero-knowledge proofs and enforces single-use nullifiers to eliminate replay attacks.
* **Deterministic Cross-Chain Execution (EVM Settlement):** Verified clearances unlock atomic execution across 1inch SwapVM routing and agent-gated Uniswap v4 hooks.

---

## Slide 4: Midnight Dual-Ledger Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PRIVATE STATE (Witnesses)                       │
│  • Owner Secret Key: witness get_owner_secret_key()                    │
│  • Shielded Spending Threshold: witness get_shielded_threshold()       │
│  • Authorization Nonce & Salt: witness get_authorization_salt()        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │  Client-Side Zero-Knowledge Proving
                                    ▼  (verify_shielded_approval)
┌────────────────────────────────────────────────────────────────────────┐
│                      MIDNIGHT PUBLIC LEDGER STATE                      │
│  • nullifiers: Set<Bytes<32>>          (Cryptographic Replay Shield)   │
│  • verifiedClearances: Set<Bytes<32>>  (Cross-Chain Commitments)       │
│  • agentPolicies: Map<Bytes<32>, Bytes<32>>                            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │  Verifiable Cross-Chain Bridge
                                    ▼  (Relayer Attestation / On-chain ZK)
┌────────────────────────────────────────────────────────────────────────┐
│                   ETHEREUM SETTLEMENT (Sepolia Layer)                  │
│  • AegisExecutionManager.sol       (Gatekeeper & Execution Queue)      │
│  • AegisSubnameRegistry.sol        (Hierarchical ENS Agent Identities) │
│  • AegisSwapVMAdapter.sol          (1inch SwapVM Opcode Router)        │
│  • AegisUniswapV4Hook.sol          (Agent-Gated Liquidity Pools)       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Slide 5: The Compact Smart Contract

### `AegisPrivateGuardrail.compact`
* Built with Midnight's domain-specific language **Compact** (`pragma language_version >= 0.20`).
* **Explicit Privacy Boundaries:** Implements strict separation using `witness`, `disclose()`, and `persistentHash`.
* **Zero Knowledge Invariants:** Proves that an autonomous trade request is authorized within safety constraints without exposing the operator's actual budget or private identity.
* **Test Suite:** Comprehensive unit & simulation test suite validating state transitions, replay rejection, and safety ceilings.

---

## Slide 6: Product Walkthrough & End-to-End Flow

1. **AI Strategy Formulation:** Anthropic Claude analyzes market opportunities and outputs a structured execution route.
2. **Threshold Interception:** Transactions below the confidential threshold ($1,000) execute autonomously; high-value moves pause onchain.
3. **Midnight ZK Clearance:** The operator's wallet derives the private witness and proves clearance inside the Compact circuit.
4. **Onchain Settlement:** Relayer verifies the Midnight commitment and dispatches the multi-hop SwapVM transaction.
5. **Emergency Kill-Switch:** Instant owner revocation or cancellation at any phase before settlement.

---

## Slide 7: Live Implementation Status

| Component | Status | Implementation Details |
| :--- | :---: | :--- |
| **Midnight Compact Contract** | ✅ Complete | `AegisPrivateGuardrail.compact` (Dual-Ledger ADTs: Sets, Maps) |
| **Compact Simulation Tests** | ✅ Passing | 6 simulation tests covering replay, thresholds, and revocation |
| **EVM Gatekeeper Contracts** | ✅ Passing | 9 Hardhat tests on Sepolia & local node (`IMidnightVerifier`) |
| **Full-Stack Console UI** | ✅ Live | Web3 interactive dashboard with real-time Midnight ZK Shield modal |
| **Indexer & Backend API** | ✅ Live | TypeScript microservice indexing events and bridging Midnight ZK proofs |
| **Open Source Compliance** | ✅ Ready | Apache License 2.0 & tagged with `midnightntwrk` |

---

## Slide 8: Market Opportunity & Impact

* **Agentic DeFi Explosion:** By 2027, automated AI trading agents are projected to manage over $50B in onchain liquidity.
* **Institutional Demand:** Institutions require automated trading with confidential policy limits to avoid front-running and regulatory leaks.
* **Ecosystem Synergy:** Positions Midnight as the **indispensable privacy layer** for all EVM-based AI infrastructure and cross-chain agent coordination.

---

## Slide 9: Wave Roadmap

* **Wave 1 & 2 Foundations:** Core protocol contracts, ENSv2 hierarchical identities, 1inch SwapVM custom opcodes, and Uniswap v4 hook.
* **Wave 3 (Current):** Complete migration to **Midnight Compact Smart Contracts**, dual-ledger private witness architecture, and Midnight ZK Shield modal.
* **Post-Buildathon (Midnight Accelerator):**
  - Native Midnight testnet deployment via `compactc` toolchain.
  - Native Midnight Lace wallet integration via `@midnight-ntwrk/dapp-connector-api`.
  - Multi-agent swarm coordination with private shared state.

---

## Slide 10: Conclusion & Call to Action

> **AegisNet + Midnight Network:** Giving AI agents the freedom to trade and DeFi the privacy it desperately needs.

* 🌐 **Console Demo:** `http://localhost:4000/app.html`
* 💻 **GitHub Repository:** Publicly available under Apache 2.0 with `midnightntwrk` label
* 📄 **Documentation & Specs:** `/docs.html` & `/whitepaper.html`
