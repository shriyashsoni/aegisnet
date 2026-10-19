import { Router } from 'express';
import { midnightService } from '../services/midnight.service';
import { indexer } from '../services/indexer.service';
import { rateLimit } from '../middleware';
import { requireAddress, requireString, route } from '../validate';

const router = Router();

/**
 * GET /api/midnight/config
 * Public settings and active Compact circuit information for the browser
 */
router.get('/config', (_req, res) => {
  res.json({ success: true, ...midnightService.networkConfig() });
});

/**
 * GET /api/midnight/binding/:owner
 * Whether an owner already has a verified Midnight identity bound to their agents
 */
router.get('/binding/:owner', (req, res) => {
  const owner = requireAddress(req.params.owner, 'owner');
  const binding = midnightService.bindingFor(owner);
  res.json({ success: true, owner, bound: !!binding, boundAt: binding?.boundAt || null });
});

/**
 * POST /api/midnight/attest
 * Generates/validates Midnight ZK proof & clearance commitment, returns cross-chain relayer attestation
 */
router.post(
  '/attest',
  rateLimit('Midnight ZK', 15, 60_000),
  route(async (req, res) => {
    const result = await midnightService.attest({
      requestId: requireString(req.body.requestId, 'requestId', { max: 80 }),
      nullifierHash: typeof req.body.nullifier_hash === 'string' ? req.body.nullifier_hash : typeof req.body.nullifierHash === 'string' ? req.body.nullifierHash : undefined,
      clearanceCommitment: typeof req.body.clearanceCommitment === 'string' ? req.body.clearanceCommitment : undefined,
      secretKey: typeof req.body.secretKey === 'string' ? req.body.secretKey : undefined,
      salt: typeof req.body.salt === 'string' ? req.body.salt : undefined,
    });
    indexer.refresh().catch(() => undefined);
    res.json({ success: true, ...result });
  })
);

export default router;
