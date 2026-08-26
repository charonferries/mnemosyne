import formbody from '@fastify/formbody';
import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
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
  const favicon = readFileSync(join(here, '..', 'public', 'favicon.svg'), 'utf8');
  app.get('/favicon.svg', async (_req, reply) => {
    reply.header('content-type', 'image/svg+xml')
      .header('cache-control', 'public, max-age=86400')
      .send(favicon);
  });
  // Legacy path some browsers probe unprompted.
  app.get('/favicon.ico', async (_req, reply) => {
    reply.redirect('/favicon.svg', 302);
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

  // A client mistake is not a server fault. Fastify already classifies a
  // malformed body (400) and an unsupported media type (415); the old handler
  // flattened everything to 500, which told callers to retry instead of fix,
  // and made the 500 rate meaningless. Pass 4xx through with its own message,
  // keep the generic 500 for genuinely unclassified faults, and answer /mcp in
  // the JSON-RPC envelope its clients parse.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
    const clientFault = status < 500;
    if (clientFault) app.log.info({ err: err.message, url: req.url }, 'client error');
    else app.log.error(err);
    if (reply.sent) return;
    const message = clientFault ? err.message : 'Something went wrong at the pool.';
    if (req.url.startsWith('/mcp')) {
      // -32700 is the JSON-RPC parse error; anything else is a transport-level refusal.
      reply.code(status).send({ jsonrpc: '2.0', error: { code: status === 400 ? -32700 : -32000, message }, id: null });
      return;
    }
    reply.code(status).send({ error: clientFault ? 'bad_request' : 'internal', message });
  });

  await app.listen({ host: c.host, port: c.port });
  app.log.info(`mnemosyne listening on ${c.host}:${c.port}`);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
