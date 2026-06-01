function envValue(name: string): string | undefined {
  const value = process.env[name];
  return value === '' ? undefined : value;
}

export interface DatabaseConfig {
  /** Cloud SQL / PostgreSQL connection string (production). */
  databaseUrl?: string;
  /** SQLite file path when no DATABASE_URL (local dev). */
  sqlitePath: string;
  /** When true, refuse SQLite fallback (set via COINWATCH_ENV=production). */
  requireDatabaseUrl: boolean;
}

export function loadDatabaseConfig(): DatabaseConfig {
  const env = envValue('COINWATCH_ENV');
  return {
    databaseUrl: envValue('DATABASE_URL'),
    sqlitePath: envValue('COINWATCH_DB_PATH') ?? 'coinwatch.db',
    requireDatabaseUrl: env === 'production',
  };
}