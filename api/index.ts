import { app, runChecks } from '../backend/src/app';

// Ensure onchain contracts & relayer status are inspected on cold-start
runChecks().catch((err: any) => {
  console.warn('[Vercel Serverless] Startup check warning:', err?.message || err);
});

export default app;

