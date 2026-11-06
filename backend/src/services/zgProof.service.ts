import fs from 'fs';
import path from 'path';
import { config } from '../config';

export interface ZGProofRecord {
  requestId: string | null;
  rootHash: string | null;
  storageTxHash?: string | null;
  storageTxSeq?: number | null;
  timestamp: string;
  agentAddress?: string;
  agentSubname?: string | null;
  summary?: string;
  strategyType?: string;
  valueUSD?: number;
  approvalStatus?: string;
  explorerUrl?: string;
}

class ZGProofService {
  private latestRequestId: string | null = null;
  private latestRootHash: string | null = null;
  private latestTxHash: string | null = null;
  private latestRecord: ZGProofRecord | null = null;
  private proofFilePath: string;

  constructor() {
    this.proofFilePath = path.join(config.dataDir, 'zg-proof.json');
    this.loadPersisted();
  }

  private loadPersisted() {
    try {
      if (fs.existsSync(this.proofFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.proofFilePath, 'utf-8'));
        this.latestRequestId = data.latestRequestId || null;
        this.latestRootHash = data.latestRootHash || null;
        this.latestTxHash = data.latestTxHash || null;
        this.latestRecord = data.latestRecord || null;
      }
    } catch {
      // ignore
    }
  }

  private persist() {
    try {
      const dir = path.dirname(this.proofFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.proofFilePath,
        JSON.stringify(
          {
            latestRequestId: this.latestRequestId,
            latestRootHash: this.latestRootHash,
            latestTxHash: this.latestTxHash,
            latestRecord: this.latestRecord,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );
    } catch (err: any) {
      console.warn('[0G Proof] Failed to persist proof cache:', err.message);
    }
  }

  public recordCompute(requestId: string) {
    if (requestId) {
      this.latestRequestId = requestId;
      if (this.latestRecord) {
        this.latestRecord.requestId = requestId;
      }
      this.persist();
    }
  }

  public recordStorage(rootHash: string, txHash?: string | null, txSeq?: number | null) {
    if (rootHash) {
      this.latestRootHash = rootHash;
      if (txHash) this.latestTxHash = txHash;
      if (this.latestRecord) {
        this.latestRecord.rootHash = rootHash;
        if (txHash) this.latestRecord.storageTxHash = txHash;
        if (txSeq) this.latestRecord.storageTxSeq = txSeq;
      }
      this.persist();
    }
  }

  public recordFullProof(record: ZGProofRecord) {
    if (record.requestId) this.latestRequestId = record.requestId;
    if (record.rootHash) this.latestRootHash = record.rootHash;
    if (record.storageTxHash) this.latestTxHash = record.storageTxHash;
    this.latestRecord = record;
    this.persist();
  }

  public getLatestRequestId(): string | null {
    return this.latestRequestId;
  }

  public getLatestRootHash(): string | null {
    return this.latestRootHash;
  }

  public getLatestTxHash(): string | null {
    return this.latestTxHash;
  }

  public getLatestRecord(): ZGProofRecord | null {
    return this.latestRecord;
  }

  public getStatus() {
    return {
      compute: {
        provider: config.plannerProvider,
        endpoint: config.zgComputeEndpoint,
        model: config.zgComputeModel,
        hasApiKey: Boolean(config.zgComputeApiKey),
        latestRequestId: this.latestRequestId,
      },
      storage: {
        indexer: config.zgStorageIndexer,
        rpc: config.zgStorageRpc,
        latestRootHash: this.latestRootHash,
        latestTxHash: this.latestTxHash,
        explorerUrl: this.latestRootHash ? `https://storagescan.0g.ai/file/${this.latestRootHash}` : null,
      },
      latestRecord: this.latestRecord,
    };
  }
}

export const zgProofService = new ZGProofService();

