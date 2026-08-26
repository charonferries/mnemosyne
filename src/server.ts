import formbody from '@fastify/formbody';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { registerApiRoutes } from './apiRoutes.js';
import { registerMcpRoute } from './mcp.js';
import { registerWebRoutes } from './webRoutes.js';

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const c = config();
  const app = Fastify({
    logger: { level: 'info' },
    trustProxy: true, // behind Apache on pluto
    bodyLimit: 128 * 1024,
  });

  await app.register(formbody);

  // Static assets, cached in memory (no static-plugin dependency).
  const css = readFileSync(join(here, '..', 'public', 'style.css'), 'utf8');
  app.get('/assets/style.css', async (_req, reply) => {
    reply.header('content-type', 'text/css; charset=utf-8')
      .header('cache-control', 'public, max-age=3600')
      .send(css);
  });
  const ogImage = readFileSync(join(here, '..', 'public', 'og.png'));
  app.get('/og.png', async (_req, reply) => {
    reply.header('content-type', 'image/png')
      .header('cache-control', 'public, max-age=86400')
      .send(ogImage);
  });

  app.get('/healthz', async () => ({ ok: true }));

  // MCP Registry HTTP domain verification (namespace be.tripnet.mnemosyne/*).
  // Public key only — the private half lives in Secrets Manager
  // (coloweb-mnemosyne/registry-key).
  app.get('/.well-known/mcp-registry-auth', async (_req, reply) => {
    reply.header('content-type', 'text/plain')
      .send('v=MCPv1; k=ed25519; p=I5ApK9Za9cCK6nFywF5gKn2AuahO5nUx5a9iZkQpnlA=');
  });

  registerApiRoutes(app);
  registerMcpRoute(app);
  registerWebRoutes(app);

  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    if (!reply.sent) {
      reply.code(500).send({ error: 'internal', message: 'Something went wrong at the pool.' });
    }
  });

  await app.listen({ host: c.host, port: c.port });
  app.log.info(`mnemosyne listening on ${c.host}:${c.port}`);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
