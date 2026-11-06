import { ethers } from 'ethers';
import { Indexer, MemData } from '@0gfoundation/0g-storage-ts-sdk';
import { config } from '../config';
import { HttpError } from '../validate';
import { zgProofService, ZGProofRecord } from './zgProof.service';

export interface ZGDecisionRecord {
  version: '1.0';
  protocol: 'AegisNet';
  timestamp: string;
  agent: string;
  agentSubname?: string | null;
  zgRequestId?: string | null;
  plan: {
    strategyType: string;
    summary: string;
    tokenIn: string;
    tokenOut: string;
    amountUSD: number;
    usesUniswapV4Hop?: boolean;
  };
  riskChecks: string[];
  approvalStatus: 'AUTO_APPROVED' | 'PENDING_HUMAN_APPROVAL' | 'APPROVED' | 'DENIED' | 'EXPIRED' | 'CANCELLED';
  txHash?: string | null;
}

export class ZGStorageService {
  get indexerRpc() {
    return config.zgStorageIndexer;
  }

  get evmRpc() {
    return config.zgStorageRpc;
  }

  get privateKey() {
    return config.zgStoragePrivateKey;
  }

  /**
   * Encodes a JSON decision record into a 0G Merkle Tree and publishes it to the 0G Storage network.
   * If 0G Storage is unreachable or fails, FAILS SAFE: throws HttpError so no unverified trade proceeds.
   */
  async publishDecisionRecord(
    record: ZGDecisionRecord
  ): Promise<{ rootHash: string; txHash?: string; txSeq?: number; explorerUrl: string }> {
    const jsonBytes = Buffer.from(JSON.stringify(record, null, 2), 'utf-8');
    const file = new MemData(jsonBytes);

    // Compute canonical 0G Merkle root hash using the official 0G Storage SDK
    let rootHash: string;
    try {
      const [tree, treeErr] = await file.merkleTree();
      if (treeErr != null || !tree) {
        throw new Error(`0G Merkle tree generation failed: ${treeErr?.message || 'unknown error'}`);
      }
      const hash = tree.rootHash();
      if (!hash) {
        throw new Error('0G Merkle root hash is null');
      }
      rootHash = hash;
    } catch (err: any) {
      throw new HttpError(503, `0G Storage data preparation error: ${err.message}. Failed safe: no trade proposed.`);
    }

    let storageTxHash: string | undefined = undefined;
    let storageTxSeq: number | undefined = undefined;

    // Check if network publishing credentials exist
    if (!this.privateKey) {
      console.warn('[0G Storage] ZG_STORAGE_PRIVATE_KEY not set; using local Merkle root hash');
    } else {
      try {
        const provider = new ethers.JsonRpcProvider(this.evmRpc);
        const signer = new ethers.Wallet(this.privateKey, provider);
        const indexer = new Indexer(this.indexerRpc);

        console.log(`[0G Storage] Uploading decision record to 0G Indexer (${this.indexerRpc})...`);
        const [uploadRes, uploadErr] = await indexer.upload(file, this.evmRpc, signer);

        if (uploadErr != null) {
          console.error('[0G Storage] Indexer upload error:', uploadErr.message);
          throw new HttpError(
            503,
            `0G Storage network upload failed: ${uploadErr.message}. Failed safe: no trade proposed without verifiable decentralized audit storage.`
          );
        }

        if (uploadRes && (uploadRes as any).txHash) {
          storageTxHash = (uploadRes as any).txHash;
          storageTxSeq = (uploadRes as any).txSeq;
          console.log(`[0G Storage] Published successfully! Root: ${rootHash} | Tx: ${storageTxHash}`);
        }
      } catch (err: any) {
        if (err instanceof HttpError) throw err;
        console.error('[0G Storage] Connection error:', err.message);
        throw new HttpError(
          503,
          `0G Storage is unreachable (${err.message}). Failed safe: no trade proposed.`
        );
      }
    }

    const proof: ZGProofRecord = {
      requestId: record.zgRequestId || null,
      rootHash,
      storageTxHash,
      storageTxSeq,
      timestamp: record.timestamp,
      agentAddress: record.agent,
      agentSubname: record.agentSubname,
      summary: record.plan.summary,
      strategyType: record.plan.strategyType,
      valueUSD: record.plan.amountUSD,
      approvalStatus: record.approvalStatus,
      explorerUrl: `https://storagescan.0g.ai/file/${rootHash}`,
    };

    zgProofService.recordFullProof(proof);

    return {
      rootHash,
      txHash: storageTxHash,
      txSeq: storageTxSeq,
      explorerUrl: proof.explorerUrl!,
    };
  }
}

export const zgStorageService = new ZGStorageService();
