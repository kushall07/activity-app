/**
 * Resolves the Postgres connection string. Locally we use DATABASE_URL; on ECS
 * the pieces come separately so the password can be injected from the
 * RDS-managed Secrets Manager secret (and rotated) without rebuilding a URL.
 */
export function resolveDatabaseUrl(env: Record<string, unknown>): string | undefined {
  const url = env.DATABASE_URL;
  if (typeof url === 'string' && url.length > 0) return url;

  const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = env;
  if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) return undefined;
  const user = encodeURIComponent(String(DB_USER));
  const password = encodeURIComponent(String(DB_PASSWORD));
  return `postgres://${user}:${password}@${String(DB_HOST)}:${String(DB_PORT ?? 5432)}/${String(DB_NAME)}`;
}
