import { Router } from 'express';
import { zgProofService } from '../services/zgProof.service';
import { zgComputeService } from '../services/zgCompute.service';
import { zgStorageService } from '../services/zgStorage.service';
import { route } from '../validate';

const router = Router();

/**
 * GET /api/zg/status
 * Provides the current 0G Private Compute and 0G Storage status, model, latest request ID, and root hash.
 */
router.get('/status', (_req, res) => {
  res.json({
    success: true,
    ...zgProofService.getStatus(),
  });
});

/**
 * GET /api/zg/proof
 * Returns the latest verified 0G execution proof (Request ID + Storage Root Hash).
 */
router.get('/proof', (_req, res) => {
  const record = zgProofService.getLatestRecord();
  res.json({
    success: true,
    latestRequestId: zgProofService.getLatestRequestId(),
    latestRootHash: zgProofService.getLatestRootHash(),
    latestTxHash: zgProofService.getLatestTxHash(),
    record,
  });
});

/**
 * POST /api/zg/prove
 * Executes one live 0G Private Compute call + one 0G Storage write, returning verifiable hashes.
 */
router.post(
  '/prove',
  route(async (_req, res) => {
    // 1. Planner call via 0G Private Compute
    const computeRes = await zgComputeService.plan({
      goalPrompt: 'Swap 500 USDC to WETH via AegisNet guardrails',
      amountUSD: 500,
      approvalThresholdUSD: 1000,
    });

    // 2. Storage write via 0G Storage
    const storageRes = await zgStorageService.publishDecisionRecord({
      version: '1.0',
      protocol: 'AegisNet',
      timestamp: new Date().toISOString(),
      agent: '0xB6Ba1Be32B7cA2729551882B71E8F469D06510e6',
      agentSubname: 'agent1.aegisnet.eth',
      zgRequestId: computeRes.requestId,
      plan: {
        strategyType: computeRes.plan.strategyType,
        summary: computeRes.plan.summary,
        tokenIn: computeRes.plan.tokenIn,
        tokenOut: computeRes.plan.tokenOut,
        amountUSD: 500,
        usesUniswapV4Hop: computeRes.plan.useUniswapV4Hop,
      },
      riskChecks: computeRes.plan.rationale,
      approvalStatus: 'AUTO_APPROVED',
    });

    res.json({
      success: true,
      requestId: computeRes.requestId,
      rootHash: storageRes.rootHash,
      storageTxHash: storageRes.txHash,
      explorerUrl: storageRes.explorerUrl,
      plan: computeRes.plan,
    });
  })
);

export default router;

