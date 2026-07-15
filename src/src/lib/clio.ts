import { appConfig } from "./config";
import { saveClioTokens, getClioTokens } from "./token-store";

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

async function refreshAccessToken(): Promise<string> {
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

function buildUrl(path: string, query: Query = {}): string {
  const url = new URL(`${clioApiBase()}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, value instanceof Date ? value.toISOString() : String(value));
  }
  return url.toString();
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
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

export class ClioClient {
  private lastRequestAt = 0;
  private minIntervalMs: number;

  constructor(rateLimitPerMinute = appConfig().rateLimitPerMinute) {
    this.minIntervalMs = Math.ceil(60000 / Math.max(1, rateLimitPerMinute));
  }

  private async throttle() {
    const now = Date.now();
    const wait = this.lastRequestAt + this.minIntervalMs - now;
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  async request<T>(path: string, query: Query = {}, replayed = false): Promise<T> {
    await this.throttle();
    const token = await accessToken();
    const response = await fetch(buildUrl(path, query), {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "X-API-VERSION": "4.0.13",
      },
      cache: "no-store",
    });

    if (response.status === 401 && !replayed) {
      await refreshAccessToken();
      return this.request<T>(path, query, true);
    }

    if (response.status === 429) {
      const wait = retryAfterMs(response) ?? 2000;
      await sleep(wait);
      return this.request<T>(path, query, replayed);
    }

    if (response.status >= 500 && !replayed) {
      await sleep(2000);
      return this.request<T>(path, query, true);
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
}
