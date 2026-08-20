import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { CLIO_REFRESH_BLOCKED_MESSAGE, ClioClient } from "./clio";
import { decryptText, encryptText } from "./crypto";

const LIB_DIR = fileURLToPath(new URL(".", import.meta.url));

// RFC 2606 reserves .invalid, so a request that escaped the fetch stub could not resolve to Clio.
const CLIO_HOST = "https://clio.invalid";

const ENV_KEYS = [
  "VERCEL_ENV", "CWCA_ALLOW_WRITES", "DATABASE_URL", "CLIO_CLIENT_ID", "CLIO_CLIENT_SECRET",
  "CLIO_REDIRECT_URI", "CLIO_BASE_URL", "TOKEN_ENCRYPTION_KEY",
] as const;
const savedEnv: Record<string, string | undefined> = {};
let savedFetch: typeof globalThis.fetch;

type FetchCall = { url: string; body: string };
type SqlCall = { text: string; values: unknown[] };

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function installFetch(reply: (url: string) => Response) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    const raw = init?.body;
    calls.push({ url, body: raw instanceof URLSearchParams ? raw.toString() : typeof raw === "string" ? raw : "" });
    if (!url.startsWith(`${CLIO_HOST}/`)) throw new Error(`the test tried to reach ${url}`);
    return reply(url);
  }) as unknown as typeof globalThis.fetch;
  return calls;
}

function installSql(rowFor: () => Record<string, unknown> | null) {
  const calls: SqlCall[] = [];
  const sql = (first: unknown, ...values: unknown[]) => {
    const text = Array.isArray(first) ? (first as unknown as TemplateStringsArray).raw.join(" ? ") : String(first);
    calls.push({ text, values });
    if (/select[\s\S]*from oauth_tokens/i.test(text)) {
      const row = rowFor();
      return Promise.resolve(row ? [row] : []);
    }
    return Promise.resolve([]);
  };
  (globalThis as { cwcaSql?: unknown }).cwcaSql = Object.assign(sql, { unsafe: () => Promise.resolve([]) });
  (globalThis as { cwcaDbReady?: Promise<void> }).cwcaDbReady = Promise.resolve();
  return calls;
}

function tokenRow(expiresAt: Date, refreshToken = "stored-refresh", accessToken = "stored-access") {
  return {
    encrypted_refresh_token: encryptText(refreshToken),
    encrypted_access_token: encryptText(accessToken),
    access_token_expires_at: expiresAt,
  };
}

function oauthCalls(calls: FetchCall[]) {
  return calls.filter((call) => call.url.includes("/oauth/token"));
}

function tokenReads(calls: SqlCall[]) {
  return calls.filter((call) => /select[\s\S]*from oauth_tokens/i.test(call.text));
}

function tokenWrites(calls: SqlCall[]) {
  return calls.filter((call) => /insert into oauth_tokens/i.test(call.text));
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function apiReply(url: string) {
  if (url.includes("/oauth/token")) {
    return jsonResponse({ token_type: "bearer", access_token: "fresh-access", expires_in: 2592000 });
  }
  return jsonResponse({ data: [{ id: 1 }] });
}

function libImports(file: string): string[] {
  const source = readFileSync(join(LIB_DIR, file), "utf8");
  return [...source.matchAll(/from\s+"(\.\/[^"]+|@\/lib\/[^"]+)"/g)].map((match) =>
    match[1].startsWith("./") ? match[1].slice(2) : match[1].slice("@/lib/".length),
  );
}

function libClosure(entry: string): Set<string> {
  const present = new Set(readdirSync(LIB_DIR).filter((name) => name.endsWith(".ts")).map((name) => name.slice(0, -3)));
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const name = stack.pop() as string;
    if (seen.has(name) || !present.has(name)) continue;
    seen.add(name);
    stack.push(...libImports(`${name}.ts`));
  }
  return seen;
}

const nearlyExpired = () => new Date(Date.now() + 60 * 1000);
const alive = () => new Date(Date.now() + 2 * 60 * 60 * 1000);

before(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  Object.assign(process.env, {
    DATABASE_URL: "postgres://localhost/cwca-clio-refresh-guard-test",
    CLIO_CLIENT_ID: "test-id",
    CLIO_CLIENT_SECRET: "test-secret",
    CLIO_REDIRECT_URI: "http://localhost/callback",
    CLIO_BASE_URL: CLIO_HOST,
    TOKEN_ENCRYPTION_KEY: "test-token-encryption-key-32b!!",
  });
  savedFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = savedFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

afterEach(() => {
  delete process.env.VERCEL_ENV;
  delete process.env.CWCA_ALLOW_WRITES;
  delete (globalThis as { cwcaSql?: unknown }).cwcaSql;
  delete (globalThis as { cwcaDbReady?: Promise<void> }).cwcaDbReady;
});

describe("Clio refresh outside production", () => {
  it("refreshes on production and stores what Clio returned", async () => {
    setEnv({ VERCEL_ENV: "production" });
    const sqlCalls = installSql(() => tokenRow(nearlyExpired()));
    const fetchCalls = installFetch(apiReply);

    await new ClioClient(600).request("/matters.json");

    const refreshes = oauthCalls(fetchCalls);
    assert.equal(refreshes.length, 1, "production refreshes once");
    assert.equal(refreshes[0].url, `${CLIO_HOST}/oauth/token`);
    assert.match(refreshes[0].body, /grant_type=refresh_token/);
    assert.match(refreshes[0].body, /refresh_token=stored-refresh/);

    const writes = tokenWrites(sqlCalls);
    assert.equal(writes.length, 1, "production saves the refreshed token");
    const saved = writes[0].values.filter((value): value is string => typeof value === "string").map(decryptText);
    assert.deepEqual(saved, ["stored-refresh", "fresh-access"]);

    assert.ok(
      fetchCalls.some((call) => call.url.includes("/api/v4/matters.json")),
      "production still reaches the Clio API after refreshing",
    );
  });

  it("refuses to refresh on preview, makes no OAuth call at all, and says why", async () => {
    setEnv({ VERCEL_ENV: "preview" });
    const sqlCalls = installSql(() => tokenRow(nearlyExpired()));
    const fetchCalls = installFetch(apiReply);

    await assert.rejects(
      () => new ClioClient(600).request("/matters.json"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, CLIO_REFRESH_BLOCKED_MESSAGE);
        assert.match(error.message, /only production refreshes Clio/);
        assert.match(error.message, /copy of production's Clio refresh token/);
        return true;
      },
    );

    assert.deepEqual(oauthCalls(fetchCalls), [], "preview never posts to Clio's token endpoint");
    assert.deepEqual(fetchCalls, [], "preview reaches no Clio endpoint once its access token is stale");
    assert.deepEqual(tokenWrites(sqlCalls), [], "preview writes no token row");
  });

  it("stops between reading the stored token and the network call, so nothing is rotated and then lost", async () => {
    setEnv({ VERCEL_ENV: "preview" });
    const sqlCalls = installSql(() => tokenRow(nearlyExpired()));
    const fetchCalls = installFetch(apiReply);

    await assert.rejects(() => new ClioClient(600).request("/matters.json"));

    assert.ok(tokenReads(sqlCalls).length >= 1, "the stored token was read, so the refresh path was entered");
    assert.equal(oauthCalls(fetchCalls).length, 0, "the grant is never exercised, so Clio has nothing to rotate");
    assert.equal(tokenWrites(sqlCalls).length, 0, "and there is no replacement to lose");
  });

  it("keeps preview reading while its access token is still alive", async () => {
    setEnv({ VERCEL_ENV: "preview" });
    const sqlCalls = installSql(() => tokenRow(alive()));
    const fetchCalls = installFetch(apiReply);

    const result = await new ClioClient(600).request<{ data: unknown[] }>("/matters.json");

    assert.deepEqual(result.data, [{ id: 1 }]);
    assert.deepEqual(oauthCalls(fetchCalls), [], "a live access token needs no refresh");
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /\/api\/v4\/matters\.json/);
    assert.deepEqual(tokenWrites(sqlCalls), []);
  });

  it("refuses to refresh when Clio answers 401 on preview, instead of replaying the request", async () => {
    setEnv({ VERCEL_ENV: "preview" });
    installSql(() => tokenRow(alive()));
    const fetchCalls = installFetch((url) =>
      url.includes("/oauth/token") ? jsonResponse({ access_token: "fresh-access" }) : jsonResponse({ error: "expired" }, 401),
    );

    await assert.rejects(
      () => new ClioClient(600).request("/matters.json"),
      (error: unknown) => {
        assert.equal((error as Error).message, CLIO_REFRESH_BLOCKED_MESSAGE);
        return true;
      },
    );
    assert.deepEqual(oauthCalls(fetchCalls), [], "the 401 replay path does not become a second way to refresh");
  });

  it("fails closed on every non-production VERCEL_ENV and opens only for the local escape hatch", async () => {
    for (const vercelEnv of [undefined, "", "preview", "development", "staging", "PRODUCTION", "prod"]) {
      setEnv({ VERCEL_ENV: vercelEnv, CWCA_ALLOW_WRITES: undefined });
      const fetchCalls = installFetch(apiReply);
      installSql(() => tokenRow(nearlyExpired()));
      await assert.rejects(
        () => new ClioClient(600).request("/matters.json"),
        (error: unknown) => {
          assert.equal((error as Error).message, CLIO_REFRESH_BLOCKED_MESSAGE, String(vercelEnv));
          return true;
        },
      );
      assert.deepEqual(oauthCalls(fetchCalls), [], String(vercelEnv));
    }

    setEnv({ VERCEL_ENV: "preview", CWCA_ALLOW_WRITES: "1" });
    const stillBlocked = installFetch(apiReply);
    installSql(() => tokenRow(nearlyExpired()));
    await assert.rejects(() => new ClioClient(600).request("/matters.json"));
    assert.deepEqual(oauthCalls(stillBlocked), [], "CWCA_ALLOW_WRITES does not open preview");

    setEnv({ VERCEL_ENV: undefined, CWCA_ALLOW_WRITES: "1" });
    const local = installFetch(apiReply);
    installSql(() => tokenRow(nearlyExpired()));
    await new ClioClient(600).request("/matters.json");
    assert.equal(oauthCalls(local).length, 1, "a local run that opted into writes still refreshes");
  });

  it("leaves the Excel sync clear of Clio, so preview can still test it", () => {
    const closure = libClosure("microsoft-excel");
    assert.ok(closure.has("dashboard-data"), "the Excel sync still reads the database through dashboard-data");
    assert.equal(closure.has("clio"), false, `the Excel sync now reaches Clio: ${[...closure].sort().join(", ")}`);
    assert.equal(closure.has("token-store"), false, "the Excel sync must not read Clio's tokens");

    const route = readFileSync(join(LIB_DIR, "../app/api/standards/excel-sync/route.ts"), "utf8");
    assert.doesNotMatch(route, /lib\/clio/, "the Excel sync route must not import the Clio client");
    assert.match(route, /rejectNonProductionExcelSync\(\)/, "the Excel sync keeps its own preview opt-in");
  });
});
