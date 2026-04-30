export const APP_TZ = "America/Chicago";

export function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export function appConfig() {
  return {
    databaseUrl: env("DATABASE_URL"),
    clioClientId: env("CLIO_CLIENT_ID"),
    clioClientSecret: env("CLIO_CLIENT_SECRET"),
    clioRedirectUri: env("CLIO_REDIRECT_URI"),
    clioBaseUrl: optionalEnv("CLIO_BASE_URL", "https://app.clio.com").replace(/\/$/, ""),
    dashboardPassword: optionalEnv("DASHBOARD_PASSWORD"),
    sessionSecret: optionalEnv("SESSION_SECRET", optionalEnv("TOKEN_ENCRYPTION_KEY", "dev-session-secret")),
    cronSecret: optionalEnv("CRON_SECRET"),
    tokenEncryptionKey: env("TOKEN_ENCRYPTION_KEY"),
    auditBatchSize: Number(optionalEnv("AUDIT_BATCH_SIZE", "10")),
    initialLookbackDays: Number(optionalEnv("CLIO_INITIAL_LOOKBACK_DAYS", "90")),
    rateLimitPerMinute: Number(optionalEnv("CLIO_RATE_LIMIT_PER_MINUTE", "40")),
  };
}
