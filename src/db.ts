import mysql from 'mysql2/promise';
import { config } from './config.js';

let pool: mysql.Pool | null = null;

export function db(): mysql.Pool {
  if (pool) return pool;
  const c = config();
  pool = mysql.createPool({
    host: c.dbHost,
    port: c.dbPort,
    database: c.dbName,
    user: c.dbUser,
    password: c.dbPassword,
    charset: 'utf8mb4',
    connectionLimit: 10,
    namedPlaceholders: false,
    timezone: 'Z',
    dateStrings: true,
  });
  return pool;
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await db().execute(sql, params as (string | number | null)[]);
  return rows as T[];
}

export async function exec(sql: string, params: unknown[] = []): Promise<mysql.ResultSetHeader> {
  const [result] = await db().execute(sql, params as (string | number | null)[]);
  return result as mysql.ResultSetHeader;
}
