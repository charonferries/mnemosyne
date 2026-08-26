/**
 * Migration runner. Uses the DDL-scoped MIGRATE_DB_USER (never the app
 * user). Strips whole-line -- comments BEFORE splitting statements (a
 * statement may begin with a comment — lesson learned in the charon build).
 * Run: npm run migrate (or on boot via CMD in the container).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mysql from 'mysql2/promise';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

async function main(): Promise<void> {
  const user = process.env.MIGRATE_DB_USER;
  const password = process.env.MIGRATE_DB_PASSWORD;
  if (!user || !password) {
    console.warn('migrate: MIGRATE_DB_USER / MIGRATE_DB_PASSWORD not set — skipping migrations (degraded boot)');
    process.exit(0);
  }
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    database: process.env.DB_NAME ?? 'mnemosyne',
    user,
    password,
    multipleStatements: false,
  });

  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) NOT NULL PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  const [rows] = await conn.query('SELECT version FROM schema_migrations');
  const applied = new Set((rows as { version: string }[]).map((r) => r.version));

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  let ran = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    process.stdout.write(`applying ${version} ... `);
    const sql = readFileSync(join(migrationsDir, file), 'utf8').replace(/^\s*--.*$/gm, '');
    for (const stmt of sql.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
      await conn.query(stmt);
    }
    await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
    console.log('ok');
    ran++;
  }
  console.log(ran === 0 ? 'nothing to do' : `done (${ran} applied)`);
  await conn.end();
}

main().catch((e) => {
  console.error('migrate failed:', e.message);
  process.exit(1);
});
