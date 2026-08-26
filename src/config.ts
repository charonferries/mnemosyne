import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  version: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  adminKey: string;
  baseUrl: string;
  host: string;
  port: number;
}

let cached: Config | null = null;

export function config(): Config {
  if (cached) return cached;
  // Degraded-boot defaults: with no env at all the server still starts and
  // answers /healthz + MCP introspection (directory sandboxes docker-run us
  // without a database). DB-touching calls fail per-request instead. Real
  // deployments set everything explicitly via env_file.
  const missing = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'ADMIN_KEY', 'BASE_URL']
    .filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.warn(`mnemosyne: missing env ${missing.join(', ')} — degraded defaults in use (DB features will fail per-request)`);
  }
  // Version stamps asset URLs so browser caches roll with each release.
  const version = (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')) as { version?: string }).version ?? '0';
  cached = {
    version,
    dbHost: process.env.DB_HOST ?? '127.0.0.1',
    dbPort: Number(process.env.DB_PORT ?? 3306),
    dbName: process.env.DB_NAME ?? 'mnemosyne',
    dbUser: process.env.DB_USER ?? 'mnemosyne_app',
    dbPassword: process.env.DB_PASSWORD ?? '',
    // Random when unset: admin endpoints stay locked rather than open.
    adminKey: process.env.ADMIN_KEY ?? randomBytes(32).toString('hex'),
    baseUrl: (process.env.BASE_URL ?? 'https://mnemosyne.tripnet.be').replace(/\/+$/, ''),
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 8095),
  };
  return cached;
}
