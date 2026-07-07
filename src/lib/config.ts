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

function numberEnv(name: string, fallback: string): number {
  const parsed = Number(optionalEnv(name, fallback));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid numeric environment variable: ${name}`);
  }
  return parsed;
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
    caseManagerUsers: optionalEnv("CASE_MANAGER_USERS"),
    cronSecret: optionalEnv("CRON_SECRET"),
    tokenEncryptionKey: env("TOKEN_ENCRYPTION_KEY"),
    auditBatchSize: numberEnv("AUDIT_BATCH_SIZE", "5"),
    auditCooldownSeconds: numberEnv("AUDIT_COOLDOWN_SECONDS", "30"),
    initialLookbackDays: numberEnv("CLIO_INITIAL_LOOKBACK_DAYS", "90"),
    rateLimitPerMinute: numberEnv("CLIO_RATE_LIMIT_PER_MINUTE", "40"),
    auditRunRetentionDays: numberEnv("AUDIT_RUN_RETENTION_DAYS", "90"),
    auditMetricRetentionDays: numberEnv("AUDIT_METRIC_RETENTION_DAYS", "365"),
    closedMatterRetentionDays: numberEnv("CLOSED_MATTER_RETENTION_DAYS", "30"),
  };
}
