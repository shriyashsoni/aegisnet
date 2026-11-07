import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { ethers } from 'ethers';
import { config } from './config';
import { provider, signerAddress, getChainId } from './chain';
import { HttpError } from './validate';
import { securityHeaders } from './middleware';
import { AdapterABI, HookABI, ManagerABI, RegistryABI, UniswapAdapterABI } from './abis';
import { indexer } from './services/indexer.service';
import { claudePlanner } from './services/claudePlanner.service';
import agentRoutes from './routes/agent.routes';
import ensRoutes from './routes/ens.routes';
import worldidRoutes from './routes/worldid.routes';
import executionRoutes from './routes/execution.routes';
import uniswapRoutes from './routes/uniswap.routes';
import zgRoutes from './routes/zg.routes';
import { zgProofService } from './services/zgProof.service';

const app = express();
app.disable('x-powered-by');
if (config.isProduction || process.env.VERCEL) app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(
  cors(
    config.isProduction && !process.env.VERCEL
      ? { origin: config.publicOrigin ? config.publicOrigin.split(',').map((s) => s.trim()) : false }
      : undefined
  )
);
app.use(express.json({ limit: '100kb' }));

// ---------------------------------------------------------------------------
// Startup checks, surfaced in /api/health
// ---------------------------------------------------------------------------
export const checks = {
  chainIdOk: null as boolean | null,
  relayerOk: null as boolean | null,
  relayerOnchain: null as string | null,
  uniswapRouter: null as string | null,
};

let checksRan = false;
export async function runChecks() {
  if (checksRan) return;
  checksRan = true;
  try {
    const chainId = await getChainId();
    checks.chainIdOk = chainId === config.expectedChainId;
    const manager = new ethers.Contract(config.contracts.AegisExecutionManager, ManagerABI, provider);
    checks.relayerOnchain = await manager.relayerSigner();
    checks.relayerOk = checks.relayerOnchain!.toLowerCase() === signerAddress.toLowerCase();
    if (config.contracts.AegisUniswapAdapter) {
      const adapter = new ethers.Contract(config.contracts.AegisUniswapAdapter, UniswapAdapterABI, provider);
      checks.uniswapRouter = await adapter.swapRouter();
    }
    if (!checks.chainIdOk) console.warn(`⚠ RPC chain ${chainId} ≠ expected ${config.expectedChainId}`);
    if (!checks.relayerOk) {
      console.warn(`⚠ PRIVATE_KEY (${signerAddress}) is not the manager's relayerSigner (${checks.relayerOnchain}). World ID approvals will be rejected onchain.`);
    }
  } catch (err: any) {
    console.warn('⚠ Startup checks failed:', err.shortMessage || err.message);
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  if (!checksRan) {
    await runChecks().catch(() => {});
  }
  const chainId = await getChainId();
  res.json({
    status: 'online',
    protocol: 'AegisNet: Guardrailed AI Agent Execution',
    network: chainId === 11155111 ? 'Sepolia' : chainId === 31337 ? 'Local Hardhat' : chainId ? `Chain ${chainId}` : 'RPC unreachable',
    chainId,
    expectedChainId: config.expectedChainId,
    rpcReachable: chainId !== null,
    environment: config.env,
    rootEnsName: config.rootEnsName,
    ens: {
      architecture: 'ENSv2 Hierarchical Identity & EAC Registry',
      rootName: config.rootEnsName,
      registry: config.contracts.AegisSubnameRegistry,
      standards: ['ENSv2 Subregistry', 'ENSIP-26 Agent Text Records', 'EIP-137', 'EIP-634', 'ERC-165'],
    },
    approvalThresholdUSD: config.biometricDefaultThresholdUSD,
    biometricThresholdUSD: config.biometricDefaultThresholdUSD,
    relayer: { address: signerAddress, matchesContract: checks.relayerOk, onchain: checks.relayerOnchain },
    uniswapRouter: checks.uniswapRouter,
    approvalGate: 'ENS Owner Human Approval Gate',
    ai: {
      provider: config.plannerProvider,
      enabled: config.plannerProvider === '0g' ? Boolean(config.zgComputeApiKey) : claudePlanner.enabled,
      model: config.plannerProvider === '0g' ? config.zgComputeModel : (claudePlanner.enabled ? claudePlanner.model : null),
    },
    zg: zgProofService.getStatus(),
    adminRoutes: config.adminApiKey ? 'api-key' : config.isProduction ? 'disabled' : 'open (development)',
    indexer: indexer.status(),
    contracts: config.contracts,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/abis', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ registry: RegistryABI, manager: ManagerABI, uniswapAdapter: UniswapAdapterABI, adapter: AdapterABI });
});

app.get('/api/proof', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  const candidatePaths = [
    path.join(config.dataDir, 'proof.json'),
    path.resolve(__dirname, '../../frontend/proof.json'),
    path.resolve(__dirname, '../data/proof.json'),
  ];

  let proofData: any = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        proofData = JSON.parse(fs.readFileSync(p, 'utf-8'));
        break;
      } catch {}
    }
  }

  if (!proofData) {
    return res.status(200).json({
      success: false,
      message: 'No run recorded yet',
      trades: null,
      zg: null,
    });
  }

  // Overlay dynamic 0G status if recorded during active runtime
  const zgReq = zgProofService.getLatestRequestId();
  const zgRoot = zgProofService.getLatestRootHash();
  const zgTx = zgProofService.getLatestTxHash();
  if (zgReq) proofData.zg.requestId = zgReq;
  if (zgRoot) proofData.zg.rootHash = zgRoot;
  if (zgTx) proofData.zg.txHash = zgTx;

  res.json({ success: true, ...proofData });
});

// ---------------------------------------------------------------------------
// Route modules
// ---------------------------------------------------------------------------
app.use('/api/agent', agentRoutes);
app.use('/api/ens', ensRoutes);
app.use('/api/worldid', worldidRoutes);
app.use('/api/approval', worldidRoutes);
app.use('/api/execution', executionRoutes);
app.use('/api/uniswap', uniswapRoutes);
app.use('/api/zg', zgRoutes);

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API route not found')));

// ---------------------------------------------------------------------------
// Frontend + vendored browser libraries (no third-party CDN at runtime)
// ---------------------------------------------------------------------------
const backendRoot = path.resolve(__dirname, '..');
const vendor: Record<string, string> = {
  'ethers.umd.min.js': path.join(backendRoot, 'node_modules/ethers/dist/ethers.umd.min.js'),
};
app.get('/vendor/:file', (req, res, next) => {
  const file = vendor[req.params.file];
  if (file && fs.existsSync(file)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(file);
  }
  const frontendVendor = path.resolve(__dirname, '../../frontend/vendor', req.params.file);
  if (fs.existsSync(frontendVendor)) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(frontendVendor);
  }
  return next(new HttpError(404, 'Not found'));
});

app.use(express.static(path.resolve(__dirname, '../../frontend'), { extensions: ['html'] }));

// JSON errors for everything, including malformed request bodies
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : err.type === 'entity.parse.failed' ? 400 : err.status || 500;
  const message = err.type === 'entity.parse.failed' ? 'Request body is not valid JSON' : err.message || 'Internal server error';
  if (status >= 500) console.error(err);
  res.status(status).json({ success: false, error: status >= 500 && config.isProduction && !(err instanceof HttpError) ? 'Internal server error' : message });
});

export { app };
export default app;

