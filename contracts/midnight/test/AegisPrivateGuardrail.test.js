// SPDX-License-Identifier: Apache-2.0
// AegisPrivateGuardrail Simulation & Unit Tests
// Tests the Compact circuit semantics, private witnesses, dual-ledger transitions, and replay protection.

const { expect } = require("chai");
const crypto = require("crypto");

/**
 * Emulates Compact's persistentHash primitive using SHA-256 for test simulation
 */
function persistentHash(inputs) {
  const hash = crypto.createHash("sha256");
  for (const item of inputs) {
    if (Buffer.isBuffer(item)) {
      hash.update(item);
    } else if (typeof item === "string" && item.startsWith("0x")) {
      hash.update(Buffer.from(item.slice(2), "hex"));
    } else {
      hash.update(Buffer.from(String(item)));
    }
  }
  return "0x" + hash.digest("hex");
}

class AegisPrivateGuardrailSimulator {
  constructor() {
    // Public Ledger State
    this.nullifiers = new Set();
    this.verifiedClearances = new Set();
    this.agentPolicies = new Map();
    this.authorityPublicKey = null;

    // Client-side Private Witness State (Off-chain)
    this.privateWitnesses = {
      ownerSecretKey: null,
      shieldedThreshold: 1000n, // $1,000 USD
      authorizationSalt: null,
    };
  }

  setPrivateWitnesses(secretKey, threshold, salt) {
    this.privateWitnesses.ownerSecretKey = secretKey;
    this.privateWitnesses.shieldedThreshold = BigInt(threshold);
    this.privateWitnesses.authorizationSalt = salt;
  }

  initialize(authority) {
    this.authorityPublicKey = authority;
  }

  registerAgentPolicy(agentAddress, policyCommitment) {
    this.agentPolicies.set(agentAddress.toLowerCase(), policyCommitment);
  }

  verifyShieldedApproval(requestId, agentAddress, tradeValueUSD, expectedNullifier, clearanceCommitment) {
    // 1. Fetch private witness inputs
    const { ownerSecretKey, shieldedThreshold, authorizationSalt } = this.privateWitnesses;

    if (!ownerSecretKey || ownerSecretKey === "0x" + "00".repeat(32)) {
      throw new Error("Owner authorization secret cannot be empty");
    }

    if (BigInt(tradeValueUSD) > 100000000n) {
      throw new Error("Trade value exceeds absolute safety threshold ceiling");
    }

    // 2. Compute deterministic nullifier
    const computedNullifier = persistentHash([ownerSecretKey, requestId, authorizationSalt]);
    if (computedNullifier.toLowerCase() !== expectedNullifier.toLowerCase()) {
      throw new Error("Nullifier derivation mismatch");
    }

    // 3. Enforce Replay Protection on Ledger
    if (this.nullifiers.has(computedNullifier.toLowerCase())) {
      throw new Error("Midnight Nullifier already spent: Replay detected");
    }
    this.nullifiers.add(computedNullifier.toLowerCase());

    // 4. Derive verified execution clearance commitment
    const computedCommitment = persistentHash([agentAddress, requestId, computedNullifier]);
    if (computedCommitment.toLowerCase() !== clearanceCommitment.toLowerCase()) {
      throw new Error("Clearance commitment mismatch");
    }

    this.verifiedClearances.add(computedCommitment.toLowerCase());
    return {
      nullifier: computedNullifier,
      commitment: computedCommitment,
      status: "VERIFIED_ON_MIDNIGHT",
    };
  }

  revokeClearance(clearanceCommitment) {
    const { ownerSecretKey } = this.privateWitnesses;
    if (!ownerSecretKey || ownerSecretKey === "0x" + "00".repeat(32)) {
      throw new Error("Only authorized secret holder can revoke");
    }
    this.verifiedClearances.delete(clearanceCommitment.toLowerCase());
  }
}

describe("Midnight Compact Contract: AegisPrivateGuardrail", function () {
  let guardrail;
  const authorityKey = "0x" + "aa".repeat(32);
  const ownerSecret = "0x" + "42".repeat(32);
  const salt = "0x" + "77".repeat(32);
  const agentAddress = "0x" + "11".repeat(32);
  const requestId = "0x" + "99".repeat(32);

  beforeEach(function () {
    guardrail = new AegisPrivateGuardrailSimulator();
    guardrail.initialize(authorityKey);
    guardrail.setPrivateWitnesses(ownerSecret, 1000n, salt);
  });

  it("Should initialize ledger state with authority key", function () {
    expect(guardrail.authorityPublicKey).to.equal(authorityKey);
    expect(guardrail.nullifiers.size).to.equal(0);
    expect(guardrail.verifiedClearances.size).to.equal(0);
  });

  it("Should register shielded agent policy commitment", function () {
    const policyHash = persistentHash([agentAddress, 50000n]); // $50,000 daily limit commitment
    guardrail.registerAgentPolicy(agentAddress, policyHash);
    expect(guardrail.agentPolicies.get(agentAddress.toLowerCase())).to.equal(policyHash);
  });

  it("Should verify confidential approval and commit nullifier + clearance to public ledger", function () {
    const expectedNullifier = persistentHash([ownerSecret, requestId, salt]);
    const expectedCommitment = persistentHash([agentAddress, requestId, expectedNullifier]);

    const result = guardrail.verifyShieldedApproval(
      requestId,
      agentAddress,
      5000n, // $5,000 trade
      expectedNullifier,
      expectedCommitment
    );

    expect(result.status).to.equal("VERIFIED_ON_MIDNIGHT");
    expect(guardrail.nullifiers.has(expectedNullifier.toLowerCase())).to.be.true;
    expect(guardrail.verifiedClearances.has(expectedCommitment.toLowerCase())).to.be.true;
  });

  it("Should block replay attack when same nullifier is submitted again", function () {
    const expectedNullifier = persistentHash([ownerSecret, requestId, salt]);
    const expectedCommitment = persistentHash([agentAddress, requestId, expectedNullifier]);

    // First execution succeeds
    guardrail.verifyShieldedApproval(requestId, agentAddress, 5000n, expectedNullifier, expectedCommitment);

    // Second execution with same nullifier must revert with replay error
    expect(() => {
      guardrail.verifyShieldedApproval(requestId, agentAddress, 5000n, expectedNullifier, expectedCommitment);
    }).to.throw("Midnight Nullifier already spent: Replay detected");
  });

  it("Should reject transactions exceeding absolute safety ceiling", function () {
    const expectedNullifier = persistentHash([ownerSecret, requestId, salt]);
    const expectedCommitment = persistentHash([agentAddress, requestId, expectedNullifier]);

    expect(() => {
      guardrail.verifyShieldedApproval(
        requestId,
        agentAddress,
        200000000n, // Exceeds ceiling
        expectedNullifier,
        expectedCommitment
      );
    }).to.throw("Trade value exceeds absolute safety threshold ceiling");
  });

  it("Should allow emergency revocation of clearance by authorized secret holder", function () {
    const expectedNullifier = persistentHash([ownerSecret, requestId, salt]);
    const expectedCommitment = persistentHash([agentAddress, requestId, expectedNullifier]);

    guardrail.verifyShieldedApproval(requestId, agentAddress, 5000n, expectedNullifier, expectedCommitment);
    expect(guardrail.verifiedClearances.has(expectedCommitment.toLowerCase())).to.be.true;

    guardrail.revokeClearance(expectedCommitment);
    expect(guardrail.verifiedClearances.has(expectedCommitment.toLowerCase())).to.be.false;
  });
});
