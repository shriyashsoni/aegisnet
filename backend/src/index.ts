import { app, runChecks } from './app';
import { config } from './config';
import { signerAddress } from './chain';
import { claudePlanner } from './services/claudePlanner.service';
import { indexer } from './services/indexer.service';

const server = app.listen(config.port, config.host, () => {
  console.log(`=======================================================`);
  console.log(`🛡️  AegisNet listening on ${config.host}:${config.port} (${config.env})`);
  console.log(`🖥️  App:     http://localhost:${config.port}`);
  console.log(`🌐 Health:  http://localhost:${config.port}/api/health`);
  console.log(`🔏 Relayer:  ${signerAddress}`);
  console.log(`🛡️  Gate:     Human Approval Gate active`);
  console.log(`🤖 Claude:   ${claudePlanner.enabled ? claudePlanner.model : 'off (set ANTHROPIC_API_KEY)'}`);
  console.log(`=======================================================`);
  runChecks();
  indexer.start();
});

// Graceful container shutdown (SIGTERM / SIGINT)
const handleShutdown = (signal: string) => {
  console.log(`\n[Server] Received ${signal}, closing HTTP server gracefully...`);
  server.close(() => {
    console.log('[Server] HTTP connections drained. Process terminating safely.');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('[Server] Forced shutdown timeout reached. Exiting immediately.');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

export { app, server };
