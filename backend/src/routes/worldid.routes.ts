import { Router } from 'express';
import { worldIdService } from '../services/worldid.service';
import { indexer } from '../services/indexer.service';
import { rateLimit } from '../middleware';
import { requireAddress, requireString, route } from '../validate';

const router = Router();

/**
 * GET /api/worldid/config
 * Settings for the World ID Agent Pass and OpenID Connect Discovery
 */
router.get('/config', (_req, res) => {
  res.json({ success: true, ...worldIdService.widgetConfig() });
});

/**
 * GET /api/worldid/binding/:owner
 * Whether an owner already has a verified human bound to their agents
 */
router.get('/binding/:owner', (req, res) => {
  const owner = requireAddress(req.params.owner, 'owner');
  const binding = worldIdService.bindingFor(owner);
  res.json({ success: true, owner, bound: !!binding, boundAt: binding?.boundAt || null });
});

/**
 * POST /api/worldid/session
 * Step 1: Create an Agent Pass verification session for a high-value trade
 */
router.post(
  '/session',
  rateLimit('Agent Pass Session', 20, 60_000),
  route(async (req, res) => {
    const requestId = requireString(req.body.requestId, 'requestId', { max: 80 });
    const session = await worldIdService.createAgentPassSession(requestId);
    res.json({ success: true, ...session });
  })
);

/**
 * GET /api/worldid/session/:id
 * Query status of an Agent Pass verification session (pending, approved, denied, expired, cancelled)
 */
router.get('/session/:id', (req, res) => {
  const sessionId = requireString(req.params.id, 'sessionId', { max: 80 });
  const session = worldIdService.getSession(sessionId);
  res.json({ success: true, ...session });
});

/**
 * POST /api/worldid/verify
 * Step 3 & 4: Server-side validation of Agent Pass proof and relayer attestation generation
 */
router.post(
  '/verify',
  rateLimit('Agent Pass Verify', 20, 60_000),
  route(async (req, res) => {
    const sessionId = requireString(req.body.sessionId, 'sessionId', { max: 80 });
    const mockNullifier = typeof req.body.mockNullifier === 'string' ? req.body.mockNullifier : undefined;
    const result = await worldIdService.verifyAgentPassSession(sessionId, mockNullifier);
    indexer.refresh().catch(() => undefined);
    res.json({ success: true, ...result });
  })
);

/**
 * POST /api/worldid/deny
 * Explicit human denial: marks session denied and leaves the trade unexecuted
 */
router.post(
  '/deny',
  rateLimit('Agent Pass Deny', 20, 60_000),
  route(async (req, res) => {
    const sessionId = requireString(req.body.sessionId, 'sessionId', { max: 80 });
    const reason = typeof req.body.reason === 'string' ? req.body.reason : undefined;
    const result = worldIdService.denyAgentPassSession(sessionId, reason);
    res.json(result);
  })
);

/**
 * POST /api/worldid/attest
 * Body: IDKit success result + requestId. Verifies the proof with World ID and returns the
 * relayer attestation the owner's wallet submits to verifyBiometricsWithRelayer.
 */
router.post(
  '/attest',
  rateLimit('World ID', 10, 60_000),
  route(async (req, res) => {
    const result = await worldIdService.attest({
      requestId: requireString(req.body.requestId, 'requestId', { max: 80 }),
      nullifier_hash: requireString(req.body.nullifier_hash, 'nullifier_hash', { max: 80 }),
      merkle_root: typeof req.body.merkle_root === 'string' ? req.body.merkle_root : undefined,
      proof: typeof req.body.proof === 'string' ? req.body.proof : undefined,
      verification_level: typeof req.body.verification_level === 'string' ? req.body.verification_level : undefined,
      deadline: typeof req.body.deadline === 'number' ? req.body.deadline : undefined,
    });
    indexer.refresh().catch(() => undefined);
    res.json({ success: true, ...result });
  })
);

export default router;
