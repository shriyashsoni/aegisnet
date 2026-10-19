# 🌑 AegisNet — Midnight Compact Smart Contract

This directory contains the **Compact smart contract** and test suite for the **Midnight Network** integration of AegisNet, targeting the **Midnight Buildathon**.

## Contract Overview: `AegisPrivateGuardrail.compact`

`AegisPrivateGuardrail.compact` provides **Confidential Human-in-the-Loop Guardrails** for autonomous AI trading agents. 

On public blockchains, an AI agent's spending limits, stop-loss trigger points, and human approvals are completely exposed to MEV bots and front-runners. AegisNet leverages Midnight's **dual-ledger model** to shield risk policies and operator approvals using zero-knowledge proofs.

### Dual-Ledger Architecture

```
                 ┌────────────────────────────────────────────────────────┐
                 │                   LOCAL CLIENT STATE                   │
                 │ ────────────────────────────────────────────────────── │
                 │ • Owner Authorization Secret (witness)                 │
                 │ • Shielded Spending Threshold & Risk Envelope (witness)│
                 │ • Authorization Salt & Nonce (witness)                 │
                 └───────────────────────────┬────────────────────────────┘
                                             │
                                     ZK Proof Generation
                                   (verify_shielded_approval)
                                             │
                                             ▼
                 ┌────────────────────────────────────────────────────────┐
                 │                MIDNIGHT PUBLIC LEDGER                  │
                 │ ────────────────────────────────────────────────────── │
                 │ • nullifiers: Set<Bytes<32>>   (Replay Prevention)     │
                 │ • verifiedClearances: Set<Bytes<32>> (ZK Commitments)  │
                 │ • agentPolicies: Map<Bytes<32>, Bytes<32>>             │
                 └───────────────────────────┬────────────────────────────┘
                                             │
                                     Cross-Chain Bridge
                                  (Relayer / Verifier Contract)
                                             │
                                             ▼
                 ┌────────────────────────────────────────────────────────┐
                 │               EVM SETTLEMENT (Sepolia)                 │
                 │ ────────────────────────────────────────────────────── │
                 │ • AegisExecutionManager.sol (verifyMidnightWithRelayer)│
                 │ • 1inch SwapVM Adapter / Uniswap v4 Hook               │
                 └────────────────────────────────────────────────────────┘
```

### Circuits & Entry Points

1. **`initialize(initialAuthority: Bytes<32>)`**: Sets protocol authority public key on Midnight ledger.
2. **`register_agent_policy(agentAddress: Bytes<32>, policyCommitment: Bytes<32>)`**: Commits confidential agent risk bounds.
3. **`verify_shielded_approval(...)`**: 
   - Proves the trade complies with the owner's private threshold without revealing the threshold value to the public.
   - Computes single-use nullifier: `persistentHash([secretKey, requestId, salt])`.
   - Records nullifier on Midnight ledger to prevent replay attacks.
   - Discloses execution clearance commitment to unlock settlement on EVM.
4. **`revoke_clearance(clearanceCommitment: Bytes<32>)`**: Emergency revocation circuit.

## Compilation Instructions

To compile the Compact contract using the Midnight compiler toolchain:

```bash
# Using the Compact compiler (version >= 0.20 / 0.30)
compact compile AegisPrivateGuardrail.compact
```

## Running the Simulation Tests

```bash
cd contracts/midnight
npx mocha test/AegisPrivateGuardrail.test.js
```
