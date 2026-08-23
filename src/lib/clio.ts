import { appConfig } from "./config";
import { saveClioTokens, getClioTokens } from "./token-store";
import { writesAllowed } from "./write-guard";

type QueryValue = string | number | boolean | Date | null | undefined;
type Query = Record<string, QueryValue>;

type ListResponse<T> = {
  data: T[];
  meta?: {
    paging?: {
      next?: string | null;
    };
  };
};

export class ClioApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`Clio API error ${status}: ${body.slice(0, 200)}`);
    this.status = status;
    this.body = body;
  }
}

export class ClioRateLimitError extends Error {
  retryAfterMs: number;
  attempts: number;

  constructor(retryAfterMs: number, attempts: number) {
    super(`Clio rate limit hit after ${attempts} retries; Clio asked us to wait ${retryAfterMs}ms`);
    this.name = "ClioRateLimitError";
    this.retryAfterMs = retryAfterMs;
    this.attempts = attempts;
  }
}

function oauthBase(): string {
  return appConfig().clioBaseUrl;
}

export function clioApiBase(): string {
  return `${appConfig().clioBaseUrl}/api/v4`;
}

export function clioManageUrl(path: string): string {
  return `${appConfig().clioBaseUrl}${path}`;
}

export function buildClioAuthorizeUrl(state: string, redirectUri?: string): string {
  const config = appConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clioClientId,
    redirect_uri: redirectUri ?? config.clioRedirectUri,
    state,
    redirect_on_decline: "true",
  });
  return `${oauthBase()}/oauth/authorize?${params}`;
}

async function postOAuth(params: URLSearchParams): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}> {
  const response = await fetch(`${oauthBase()}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new ClioApiError(response.status, text);
  return JSON.parse(text);
}

export async function exchangeClioCode(code: string, redirectUri?: string) {
  const config = appConfig();
  const result = await postOAuth(
    new URLSearchParams({
      client_id: config.clioClientId,
      client_secret: config.clioClientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri ?? config.clioRedirectUri,
    }),
  );
  await saveClioTokens({
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresIn: result.expires_in,
  });
}

export const CLIO_REFRESH_BLOCKED_MESSAGE =
  "Clio refresh blocked: only production refreshes Clio. This deployment reads a database branch that carries a copy of production's Clio refresh token, so refreshing here would ask Clio to reissue production's credential and would save the replacement where production cannot read it. Reconnect Clio from production, or give this deployment its own Clio application.";

async function refreshAccessToken(): Promise<string> {
  if (!writesAllowed()) throw new Error(CLIO_REFRESH_BLOCKED_MESSAGE);
  const config = appConfig();
  const tokens = await getClioTokens();
  if (!tokens?.refreshToken) throw new Error("Clio is not connected");
  const result = await postOAuth(
    new URLSearchParams({
      client_id: config.clioClientId,
      client_secret: config.clioClientSecret,
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
    }),
  );
  await saveClioTokens({
    accessToken: result.access_token,
    refreshToken: result.refresh_token ?? tokens.refreshToken,
    expiresIn: result.expires_in,
  });
  return result.access_token;
}

async function accessToken(): Promise<string> {
  const tokens = await getClioTokens();
  if (!tokens?.refreshToken) throw new Error("Clio is not connected");
  const expires = tokens.accessTokenExpiresAt?.getTime() ?? 0;
  if (tokens.accessToken && expires > Date.now() + 10 * 60 * 1000) {
    return tokens.accessToken;
  }
  return refreshAccessToken();
}

function buildUrl(path: string, query: Query = {}, apiBase = clioApiBase()): string {
  const url = new URL(`${apiBase}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, value instanceof Date ? value.toISOString() : String(value));
  }
  return url.toString();
}

const MAX_RATE_LIMIT_RETRIES = 5;
const DEFAULT_RETRY_AFTER_MS = 2000;

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function headerNumber(response: Response, name: string): number | null {
  const raw = response.headers.get(name);
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function pageTokenFromNext(next?: string | null): string | undefined {
  if (!next) return undefined;
  try {
    const url = new URL(next);
    return url.searchParams.get("page_token") ?? undefined;
  } catch {
    return next;
  }
}

type ClioClientHooks = {
  apiBase?: string;
  accessToken?: () => Promise<string>;
};

export class ClioClient {
  private nextAllowedAt = 0;
  private throttleQueue: Promise<void> = Promise.resolve();
  private minIntervalMs: number;
  private readonly floorIntervalMs: number;
  private readonly apiBase?: string;
  private readonly readAccessToken?: () => Promise<string>;

  constructor(rateLimitPerMinute = appConfig().rateLimitPerMinute, hooks: ClioClientHooks = {}) {
    this.floorIntervalMs = Math.ceil(60000 / Math.max(1, rateLimitPerMinute));
    this.minIntervalMs = this.floorIntervalMs;
    this.apiBase = hooks.apiBase;
    this.readAccessToken = hooks.accessToken;
  }

  private async throttle() {
    let release = () => {};
    const previous = this.throttleQueue;
    this.throttleQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      while (Date.now() < this.nextAllowedAt) {
        await sleep(this.nextAllowedAt - Date.now());
      }
      this.nextAllowedAt = Date.now() + this.minIntervalMs;
    } finally {
      release();
    }
  }

  private noteRateLimit(response: Response) {
    const limit = headerNumber(response, "x-ratelimit-limit");
    const remaining = headerNumber(response, "x-ratelimit-remaining");
    const resetSec = headerNumber(response, "x-ratelimit-reset");

    let interval = this.floorIntervalMs;
    if (limit !== null && limit > 0) {
      interval = Math.max(interval, Math.ceil(60000 / limit));
    }

    if (remaining !== null && remaining >= 0 && resetSec !== null && resetSec > 0) {
      const resetAt = resetSec * 1000;
      const windowMs = resetAt - Date.now();
      if (windowMs > 0) {
        if (remaining === 0) {
          this.nextAllowedAt = Math.max(this.nextAllowedAt, resetAt);
        } else {
          interval = Math.max(interval, Math.ceil(windowMs / remaining));
        }
      }
    }

    this.minIntervalMs = interval;
    this.nextAllowedAt = Math.max(this.nextAllowedAt, Date.now() + interval);
  }

  async request<T>(path: string, query: Query = {}, replayed = false): Promise<T> {
    return this.send<T>(path, query, replayed, 0);
  }

  private async send<T>(path: string, query: Query, replayed: boolean, rateLimitRetries: number): Promise<T> {
    await this.throttle();
    const token = this.readAccessToken ? await this.readAccessToken() : await accessToken();
    const response = await fetch(buildUrl(path, query, this.apiBase), {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "X-API-VERSION": "4.0.13",
      },
      cache: "no-store",
    });

    this.noteRateLimit(response);

    if (response.status === 401 && !replayed) {
      await refreshAccessToken();
      return this.send<T>(path, query, true, rateLimitRetries);
    }

    if (response.status === 429) {
      const wait = retryAfterMs(response) ?? DEFAULT_RETRY_AFTER_MS;
      if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES) {
        throw new ClioRateLimitError(wait, rateLimitRetries);
      }
      await sleep(wait);
      return this.send<T>(path, query, replayed, rateLimitRetries + 1);
    }

    if (response.status >= 500 && !replayed) {
      await sleep(2000);
      return this.send<T>(path, query, true, rateLimitRetries);
    }

    const text = await response.text();
    if (!response.ok) throw new ClioApiError(response.status, text);
    return JSON.parse(text) as T;
  }

  async list<T>(path: string, query: Query): Promise<T[]> {
    const results: T[] = [];
    let pageToken: string | undefined;
    do {
      const response = await this.request<ListResponse<T>>(path, {
        ...query,
        limit: 200,
        page_token: pageToken,
      });
      results.push(...(response.data ?? []));
      pageToken = pageTokenFromNext(response.meta?.paging?.next);
    } while (pageToken);
    return results;
  }

  async listFirstPage<T>(path: string, query: Query, limit = 200): Promise<T[]> {
    const response = await this.request<ListResponse<T>>(path, {
      ...query,
      limit: Math.min(200, Math.max(1, limit)),
    });
    return response.data ?? [];
  }
}
