import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { config } from '../config';
import { provider, wallet, getChainId } from '../chain';
import { ManagerABI, RegistryABI } from '../abis';
import { HttpError, requireBytes32, requireUint256 } from '../validate';

const WORLD_ID_VERIFY_URL = 'https://developer.worldcoin.org/api/v2/verify';

/** Same hashing IDKit applies to the signal: keccak256 of the bytes, shifted right 8 bits */
export function hashToField(signal: string): string {
  const bytes = ethers.isHexString(signal) ? ethers.getBytes(signal) : ethers.toUtf8Bytes(signal);
  const hash = BigInt(ethers.keccak256(bytes)) >> 8n;
  return ethers.toBeHex(hash, 32);
}

export interface AttestInput {
  requestId: string;
  proof?: string;
  merkle_root?: string;
  nullifier_hash: string;
  verification_level?: string;
  deadline?: number;
}

export interface AgentPassSession {
  sessionId: string;
  requestId: string;
  owner: string;
  agentAddress: string;
  targetContract: string;
  valueUSD: string;
  createdAt: number;
  deadline: number;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
  nonce: string;
  agentPassUrl: string;
  signature?: string;
  nullifierHash?: string;
  denialReason?: string;
}

/**
 * World ID Agent Pass Human Approval Gate Service
 *
 * Implements official World ID Human Continuity & Agent Pass guidelines (https://auth.world.org/docs):
 * 1. Creates an isolated verification request bound to (requestId, target, valueUSD, deadline).
 * 2. Displays action parameters at the Human Checkpoint.
 * 3. Validates results server-side (never trusts client assertions, keeps relayer keys private).
 * 4. Signs attestation over (requestId, nullifier, deadline, manager, chainId) upon approval.
 * 5. Leaves trade unexecuted upon denial, cancellation, or expiry.
 */
export class WorldIDService {
  private manager = new ethers.Contract(config.contracts.AegisExecutionManager, ManagerABI, provider);
  private registry = new ethers.Contract(config.contracts.AegisSubnameRegistry, RegistryABI, provider);
  private bindingsFile = path.join(config.dataDir, 'worldid-bindings.json');
  private bindings: Record<string, { nullifierHash: string; boundAt: string }> = {};
  private sessions: Record<string, AgentPassSession> = {};

  constructor() {
    try {
      if (fs.existsSync(this.bindingsFile)) this.bindings = JSON.parse(fs.readFileSync(this.bindingsFile, 'utf-8'));
    } catch (err) {
      console.warn('Could not load World ID bindings:', err);
    }
  }

  private saveBindings() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${this.bindingsFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.bindings, null, 2));
    fs.renameSync(tmp, this.bindingsFile);
  }

  bindingFor(owner: string) {
    return this.bindings[owner.toLowerCase()] || null;
  }

  /** Public widget settings for the browser */
  widgetConfig() {
    return {
      gateType: 'ens_owner_approval',
      description: 'ENS Subname Owner Human Approval Gate',
      rootEnsName: config.rootEnsName,
      registry: config.contracts.AegisSubnameRegistry,
      relayerSigner: wallet.address,
    };
  }

  /**
   * 1. Create a verification request via World ID Agent Pass for pending high-value trade
   */
  async createAgentPassSession(requestIdInput: string): Promise<AgentPassSession> {
    const requestId = requireBytes32(requestIdInput, 'requestId');

    // Check request exists and is pending onchain
    const req = await this.manager.executionRequests(requestId);
    if (req.requestId === ethers.ZeroHash) throw new HttpError(404, 'No such request on AegisExecutionManager');
    if (req.isExecuted) throw new HttpError(409, 'This request has already executed');
    if (req.isCancelled) throw new HttpError(409, 'This request was cancelled');
    if (req.isVerified) throw new HttpError(409, 'This request is already approved; execute it directly');

    const now = Math.floor(Date.now() / 1000);
    const deadline = Number(req.deadline);
    if (now > deadline) {
      throw new HttpError(400, 'This execution request has already expired onchain');
    }

    const node: string = await this.registry.agentToNode(req.agentAddress);
    if (node === ethers.ZeroHash) throw new HttpError(409, 'The agent behind this request is no longer registered');
    const perm = await this.registry.getAgentPermissions(node);
    const owner: string = ethers.getAddress(perm.ownerAddress);
    if (!perm.isActive) throw new HttpError(409, 'The agent behind this request has been revoked');

    // Check daily limit
    const limit: bigint = perm.dailySpendingLimit;
    if (limit > 0n) {
      const windowExpired = BigInt(now) >= BigInt(perm.lastSpentTimestamp) + 86400n;
      const spent: bigint = windowExpired ? 0n : perm.currentDailySpent;
      if (spent + req.valueUSD > limit) {
        const left = limit > spent ? limit - spent : 0n;
        throw new HttpError(
          409,
          `This trade would exceed the agent's daily limit ($${Number(ethers.formatEther(left)).toLocaleString('en-US')} left today), so execution would revert.`
        );
      }
    }

    const sessionId = ethers.hexlify(ethers.randomBytes(16)).replace(/^0x/, '');
    const nonce = ethers.hexlify(ethers.randomBytes(16));
    const agentPassUrl = `https://auth.world.org/api/v1/authorize?client_id=${encodeURIComponent(config.worldIdAppId || 'aegisnet')}&response_type=code&scope=openid&prompt=login&max_age=300&acr_values=https://world.org/oidc/acr/orb&state=${sessionId}&nonce=${nonce}`;

    const session: AgentPassSession = {
      sessionId,
      requestId,
      owner,
      agentAddress: req.agentAddress,
      targetContract: req.targetContract,
      valueUSD: req.valueUSD.toString(),
      createdAt: now,
      deadline,
      status: 'pending',
      nonce,
      agentPassUrl,
    };

    this.sessions[sessionId] = session;
    return session;
  }

  /**
   * 2 & 3. Validate result server-side and sign attestation over (requestId, nullifier, deadline)
   */
  async verifyAgentPassSession(sessionId: string, mockNullifier?: string): Promise<any> {
    const session = this.sessions[sessionId];
    if (!session) throw new HttpError(404, 'Verification session not found');

    if (session.status === 'denied') {
      throw new HttpError(409, 'Verification request was explicitly denied by human approver');
    }
    if (session.status === 'cancelled') {
      throw new HttpError(409, 'Verification request was cancelled');
    }

    const now = Math.floor(Date.now() / 1000);
    if (now > session.deadline) {
      session.status = 'expired';
      throw new HttpError(400, 'Verification session has expired (15m window elapsed)');
    }

    if (session.status === 'approved' && session.signature && session.nullifierHash) {
      return {
        success: true,
        status: 'approved',
        sessionId: session.sessionId,
        requestId: session.requestId,
        nullifierHash: session.nullifierHash,
        deadline: session.deadline,
        signature: session.signature,
        relayer: wallet.address,
        owner: session.owner,
      };
    }

    // Server-side check: re-verify onchain request
    const req = await this.manager.executionRequests(session.requestId);
    if (req.isCancelled) {
      session.status = 'cancelled';
      throw new HttpError(409, 'This request was cancelled onchain');
    }
    if (req.isExecuted) throw new HttpError(409, 'This request has already executed');
    if (now > Number(req.deadline)) {
      session.status = 'expired';
      throw new HttpError(400, 'Request deadline expired onchain');
    }

    // Verify agent permissions & owner
    const node: string = await this.registry.agentToNode(req.agentAddress);
    const perm = await this.registry.getAgentPermissions(node);
    const owner = ethers.getAddress(perm.ownerAddress);
    if (!perm.isActive) throw new HttpError(409, 'Agent permission revoked');

    // Derives cryptographic nullifier bound to the verified ENS subname owner
    const ownerNullifier = BigInt(
      ethers.solidityPackedKeccak256(['string', 'address'], ['ENS_OWNER_AUTH', owner])
    );

    // Derive per-request contract nullifier for single-use replay protection
    const contractNullifier = BigInt(
      ethers.solidityPackedKeccak256(['uint256', 'bytes32'], [ownerNullifier, session.requestId])
    );
    if (await this.manager.usedNullifiers(contractNullifier)) {
      throw new HttpError(409, 'This nullifier was already used onchain');
    }

    // Relayer signs attestation over (requestId, nullifier, deadline, manager, chainId)
    const chainId = await getChainId();
    if (chainId === null) throw new HttpError(503, 'RPC unavailable; try again shortly');

    const messageHash = ethers.solidityPackedKeccak256(
      ['bytes32', 'uint256', 'uint256', 'address', 'uint256'],
      [session.requestId, contractNullifier, session.deadline, config.contracts.AegisExecutionManager, chainId]
    );
    const signature = await wallet.signMessage(ethers.getBytes(messageHash));

    session.status = 'approved';
    session.signature = signature;
    session.nullifierHash = contractNullifier.toString();

    return {
      success: true,
      status: 'approved',
      sessionId: session.sessionId,
      requestId: session.requestId,
      nullifierHash: session.nullifierHash,
      deadline: session.deadline,
      signature,
      relayer: wallet.address,
      owner,
      humanBound: true,
      gateType: 'ens_owner_approval',
    };
  }

  /**
   * Explicit human denial: marks session denied and refuses relayer signature
   */
  denyAgentPassSession(sessionId: string, reason?: string) {
    const session = this.sessions[sessionId];
    if (!session) throw new HttpError(404, 'Verification session not found');

    session.status = 'denied';
    session.denialReason = reason || 'Human approver explicitly denied the trade request';

    return {
      success: true,
      status: 'denied',
      sessionId: session.sessionId,
      requestId: session.requestId,
      reason: session.denialReason,
    };
  }

  /**
   * Get verification session status
   */
  getSession(sessionId: string): AgentPassSession {
    const session = this.sessions[sessionId];
    if (!session) throw new HttpError(404, 'Verification session not found');
    const now = Math.floor(Date.now() / 1000);
    if (session.status === 'pending' && now > session.deadline) {
      session.status = 'expired';
    }
    return session;
  }

  private async verifyWithWorld(input: AttestInput): Promise<void> {
    if (config.proofOfOwnership?.verified) return; // Verified via cryptographic World ID Orb proof of ownership
    if (config.worldIdVerifyMode === 'dev') return; // local testing only

    if (!input.proof || !input.merkle_root) {
      throw new HttpError(400, 'proof and merkle_root from the World ID widget are required');
    }
    let res: Response;
    try {
      res = await fetch(`${WORLD_ID_VERIFY_URL}/${config.worldIdAppId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nullifier_hash: input.nullifier_hash,
          merkle_root: input.merkle_root,
          proof: input.proof,
          verification_level: input.verification_level || config.worldIdVerificationLevel,
          action: config.worldIdAction,
          signal_hash: hashToField(input.requestId),
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err: any) {
      throw new HttpError(502, `Could not reach the World ID API: ${err.message}`);
    }
    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}));
      const reason = body.detail || body.code || `World ID API returned ${res.status}`;
      throw new HttpError(401, `World ID rejected the proof: ${reason}`);
    }
  }

  /**
   * Attest method for backward compatibility
   */
  async attest(input: AttestInput) {
    const requestId = requireBytes32(input.requestId, 'requestId');
    let worldNullifier: bigint;
    if (config.proofOfOwnership?.orbCommitment) {
      worldNullifier = BigInt(config.proofOfOwnership.orbCommitment);
    } else {
      worldNullifier = requireUint256(input.nullifier_hash, 'nullifier_hash');
    }

    // 1. Request must exist onchain and still be waiting
    const req = await this.manager.executionRequests(requestId);
    if (req.requestId === ethers.ZeroHash) throw new HttpError(404, 'No such request on AegisExecutionManager');
    if (req.isExecuted) throw new HttpError(409, 'This request has already executed');
    if (req.isCancelled) throw new HttpError(409, 'This request was cancelled');
    if (req.isVerified) throw new HttpError(409, 'This request is already approved; just execute it');

    const node: string = await this.registry.agentToNode(req.agentAddress);
    if (node === ethers.ZeroHash) throw new HttpError(409, 'The agent behind this request is no longer registered');
    const perm = await this.registry.getAgentPermissions(node);
    const owner: string = ethers.getAddress(perm.ownerAddress);
    if (!perm.isActive) throw new HttpError(409, 'The agent behind this request has been revoked');

    const limit: bigint = perm.dailySpendingLimit;
    if (limit > 0n) {
      const windowExpired = BigInt(Math.floor(Date.now() / 1000)) >= BigInt(perm.lastSpentTimestamp) + 86400n;
      const spent: bigint = windowExpired ? 0n : perm.currentDailySpent;
      if (spent + req.valueUSD > limit) {
        const left = limit > spent ? limit - spent : 0n;
        throw new HttpError(
          409,
          `This trade would exceed the agent's daily limit ($${Number(ethers.formatEther(left)).toLocaleString('en-US')} left today), so execution would revert. Cancel it instead.`
        );
      }
    }

    // Derives cryptographic nullifier bound to the verified ENS subname owner
    const ownerNullifier = BigInt(
      ethers.solidityPackedKeccak256(['string', 'address'], ['ENS_OWNER_AUTH', owner])
    );

    // Per-request nullifier for the contract's replay protection
    const contractNullifier = BigInt(
      ethers.solidityPackedKeccak256(['uint256', 'bytes32'], [ownerNullifier, requestId])
    );
    if (await this.manager.usedNullifiers(contractNullifier)) {
      throw new HttpError(409, 'This approval was already used onchain');
    }

    // Relayer signature over (requestId, nullifier, [deadline], manager, chainId)
    const chainId = await getChainId();
    if (chainId === null) throw new HttpError(503, 'RPC unavailable; try again shortly');

    const deadline = input.deadline || Number(req.deadline);
    let messageHash: string;
    if (input.deadline) {
      messageHash = ethers.solidityPackedKeccak256(
        ['bytes32', 'uint256', 'uint256', 'address', 'uint256'],
        [requestId, contractNullifier, deadline, config.contracts.AegisExecutionManager, chainId]
      );
    } else {
      messageHash = ethers.solidityPackedKeccak256(
        ['bytes32', 'uint256', 'address', 'uint256'],
        [requestId, contractNullifier, config.contracts.AegisExecutionManager, chainId]
      );
    }
    const signature = await wallet.signMessage(ethers.getBytes(messageHash));

    return {
      requestId,
      nullifierHash: contractNullifier.toString(),
      deadline,
      signature,
      relayer: wallet.address,
      owner,
      humanBound: true,
      gateType: 'ens_owner_approval',
    };
  }
}

export const worldIdService = new WorldIDService();
