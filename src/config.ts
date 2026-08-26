const REQUIRED = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'ADMIN_KEY', 'BASE_URL'] as const;

export interface Config {
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
  for (const key of REQUIRED) {
    if (!process.env[key]) throw new Error(`mnemosyne: missing env ${key}`);
  }
  cached = {
    dbHost: process.env.DB_HOST!,
    dbPort: Number(process.env.DB_PORT ?? 3306),
    dbName: process.env.DB_NAME!,
    dbUser: process.env.DB_USER!,
    dbPassword: process.env.DB_PASSWORD!,
    adminKey: process.env.ADMIN_KEY!,
    baseUrl: process.env.BASE_URL!.replace(/\/+$/, ''),
    host: process.env.HOST ?? '127.0.0.1',
    port: Number(process.env.PORT ?? 8095),
  };
  return cached;
}
