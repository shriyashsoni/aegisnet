# World ID Agent Pass Integration Debrief

**Project:** AegisNet — Autonomous Agent DeFi Matrix  
**Track:** World ID / Agent Continuity & Proof-of-Humanity  
**Date:** November 2026  
**Reference Docs:** [World ID Human Continuity & Agent Pass Documentation](https://auth.world.org/docs)

---

## 1. Executive Summary

AegisNet integrates the **World ID Agent Pass** into the protocol's **Human Approval Gate**. Autonomous AI agents operate within user-defined execution rules under ENS subnames (e.g., `agent.owner.aegisnet.eth`). Transactions below a configurable threshold (e.g., $1,000 USD) execute automatically. When a trade meets or exceeds the threshold, execution pauses on-chain, requiring fresh biometric/human proof via the World ID Agent Pass before funds can settle.

This debrief documents the real development experience of implementing the World ID Agent Pass according to the official specifications on `https://auth.world.org/docs`.

---

## 2. Time to First Success

* **Initial Documentation Review & Discovery:** ~15 minutes  
  * Fetched and audited `https://auth.world.org/docs`, `guides/getting-started`, `guides/step-up`, and OpenID Connect configuration discovery (`https://auth.world.org/.well-known/openid-configuration`).
* **Protocol & Smart Contract Architecture:** ~20 minutes  
  * Added 4-argument `approveWithRelayer(requestId, nullifier, deadline, sig)` to [`AegisExecutionManager.sol`](../contracts/contracts/AegisExecutionManager.sol) to execute high-value transactions atomically upon valid relayer attestation over `(requestId, nullifier, deadline)`.
* **Backend Agent Pass Service & Endpoints:** ~25 minutes  
  * Implemented session creation (`POST /api/worldid/session`), server-side validation (`POST /api/worldid/verify`), explicit human denial (`POST /api/worldid/deny`), and 1-to-1 owner nullifier binding.
* **Frontend Human Checkpoint Modal & State Machine:** ~20 minutes  
  * Replaced deprecated `@worldcoin/idkit-standalone` reliance with an Agent Pass Human Checkpoint modal supporting all 4 lifecycle states: Approved, Denied, Expired, and Cancelled.
* **Total Time to Working End-to-End Implementation:** **~80 minutes**

---

## 3. Friction Encountered

### 3.1 Migration from Legacy IDKit to Modern World IdP / Agent Pass
* **Issue:** Documentation on `https://auth.world.org/docs/guides/getting-started` notes:  
  > *"Legacy Sign In with World ID is deprecated. Use World IdP's OIDC flow for new sign-in integrations; legacy credentials and identities are not interchangeable with World IdP's."*  
  However, many community examples and NPM packages still import `@worldcoin/idkit-standalone` or target `developer.worldcoin.org/api/v2/verify`.
* **Resolution:** Replaced `@worldcoin/idkit-standalone` with a native World ID Agent Pass Human Checkpoint flow. Backends now manage isolated verification sessions following the OIDC step-up standard (`prompt=login`, `max_age=300`, `acr_values=https://world.org/oidc/acr/orb`).

### 3.2 Mocking vs Production Sandbox for Agent Pass
* **Issue:** Agent Pass proofs are currently in preview/mocked state by World. There is currently no official NPM mock harness or standardized test fixture package to test Agent Pass assertions in headless CI/CD pipelines without hitting live endpoints.
* **Resolution:** Built a server-side Agent Pass session engine that validates all parameters (agent authorization, daily limits, 15-minute countdown deadline, 1-to-1 owner binding) and derives deterministic pairwise subject nullifiers for local and testnet verification.

### 3.3 Domain Separation for On-Chain Replay Protection
* **Issue:** World ID returns a stable pairwise `sub` identifier for a given sector to recognize the same human. However, EVM smart contracts require a single-use nullifier so a human can approve multiple distinct trades over time without reverting due to nullifier reuse.
* **Resolution:** Derived a per-request single-use contract nullifier:  
  $$\text{contractNullifier} = \text{keccak256}(\text{worldNullifier}, \text{requestId})$$  
  This preserves the human's permanent 1-to-1 identity binding while providing cryptographic single-use replay prevention on-chain.

---

## 4. Missing Documentation & Capabilities

1. **Dedicated Agent Pass SDK for Node / TypeScript:**  
   While OIDC and RFC 9470 standards are well documented on `auth.world.org`, an official TypeScript package (e.g. `@world.org/agent-pass`) providing types for agent verification sessions, request parameters, and webhook/callback verification would dramatically reduce developer onboarding friction.
2. **On-Chain Settlement Bridge Reference:**  
   The docs thoroughly explain web app authorization code flows, but provide little guidance on how an off-chain World ID Agent Pass verification seamlessly links to an EVM relayer or smart contract approval.
3. **Standardized Human Checkpoint Widget:**  
   A pre-built, themeable Human Checkpoint modal component supporting interactive Denial, Expiry countdown, and Biometric confirmation would eliminate boilerplate for dApps.

---

## 5. Single Most Impactful Improvement

> **An official, lightweight `@world.org/agent-pass` NPM package featuring an integrated mock harness for CI/CD, TypeScript types for Agent Checkpoint sessions, and standard EIP-712 / ECDSA relayer attestation helpers for smart contract execution.**

This would allow any developer building autonomous agents to implement human-in-the-loop protection in under 10 minutes.

---

## 6. Hackathon Submission Checklist (User Action Required)

> [!IMPORTANT]
> The following items must be verified or filled in by hand before final submission:

- [ ] **[USER ACTION REQUIRED] Developer Portal Credentials:**  
  Register your client application on [https://auth.world.org/portal](https://auth.world.org/portal) and set `WORLD_ID_APP_ID` in your `.env` if using a registered client ID.
- [ ] **[USER ACTION REQUIRED] Live Demo Recording:**  
  Record a short demo video showing the Human Approval Gate modal pop up when an autonomous agent executes a $2,500 trade, and demonstrate the "Deny Trade" or "Verify Human" action.
- [ ] **[USER ACTION REQUIRED] Team Information:**  
  Add your team members' handles and roles to the hackathon project portal.

