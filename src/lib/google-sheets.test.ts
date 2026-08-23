import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { GET as googleGet, POST as googlePost } from "../app/api/standards/google-sync/route";
import { syncStandardsToGoogleSheets } from "./google-sheets";
import { WRITE_BLOCKED_MESSAGE } from "./write-guard";

const PRODUCTION_SHEET_ID = "the-firms-real-standards-sheet";

const ENV_KEYS = [
  "VERCEL_ENV",
  "CWCA_ALLOW_WRITES",
  "CWCA_ALLOW_PREVIEW_EXCEL_SYNC",
  "GOOGLE_SHEETS_SPREADSHEET_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "DATABASE_URL",
  "CLIO_CLIENT_ID",
  "CLIO_CLIENT_SECRET",
  "CLIO_REDIRECT_URI",
  "TOKEN_ENCRYPTION_KEY",
  "DASHBOARD_PASSWORD",
  "CRON_SECRET",
] as const;

const savedEnv: Record<string, string | undefined> = {};
let savedFetch: typeof globalThis.fetch;

before(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  savedFetch = globalThis.fetch;
  Object.assign(process.env, {
    DATABASE_URL: "postgres://localhost/cwca-google-sheets-test",
    CLIO_CLIENT_ID: "test-id",
    CLIO_CLIENT_SECRET: "test-secret",
    CLIO_REDIRECT_URI: "http://localhost/callback",
    TOKEN_ENCRYPTION_KEY: "test-token-encryption-key-32b!!",
    DASHBOARD_PASSWORD: "test-dashboard-password",
    CRON_SECRET: "test-cron-secret",
  });
});

after(() => {
  globalThis.fetch = savedFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  delete process.env.VERCEL_ENV;
  delete process.env.CWCA_ALLOW_WRITES;
  delete process.env.CWCA_ALLOW_PREVIEW_EXCEL_SYNC;
  delete (globalThis as { cwcaSql?: unknown }).cwcaSql;
  delete (globalThis as { cwcaDbReady?: Promise<void> }).cwcaDbReady;
});

function source(rel: string) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function req(path: string, method: string) {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (method === "POST") {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = "";
  }
  return new NextRequest(new URL(path, "http://localhost"), { method, headers, body });
}

const HANDLERS: Array<{ method: string; handle: (request: NextRequest) => Promise<Response> }> = [
  { method: "GET", handle: googleGet },
  { method: "POST", handle: googlePost },
];

describe("Google Sheet destination", () => {
  it("refuses the sync route outside production, whatever the environment or the Excel opt-in says", async () => {
    for (const vercelEnv of [undefined, "", "preview", "development", "staging", "PRODUCTION", "prod"]) {
      for (const excelFlag of [undefined, "1", "true"]) {
        setEnv({ VERCEL_ENV: vercelEnv, CWCA_ALLOW_WRITES: undefined, CWCA_ALLOW_PREVIEW_EXCEL_SYNC: excelFlag });
        for (const { method, handle } of HANDLERS) {
          const label = `${method} VERCEL_ENV=${vercelEnv} CWCA_ALLOW_PREVIEW_EXCEL_SYNC=${excelFlag}`;
          const response = await handle(req("/api/standards/google-sync", method));
          assert.equal(response.status, 403, label);
          assert.equal((await response.json()).error, WRITE_BLOCKED_MESSAGE, label);
        }
      }
    }

    const route = source("../app/api/standards/google-sync/route.ts");
    assert.equal([...route.matchAll(/export async function (GET|POST)/g)].length, 2);
    assert.equal(
      [...route.matchAll(/rejectNonProductionWrite\(/g)].length,
      2,
      "both handlers must keep the broad guard: the Google Sheet has no preview of its own to fall back to",
    );
    assert.doesNotMatch(route, /ExcelSync|CWCA_ALLOW_PREVIEW/, "no opt-in may open this route while the destination is unscoped");
  });

  it("resolves the same spreadsheet on preview as on production, which is why that guard has to stay", async () => {
    const key = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey;
    setEnv({
      VERCEL_ENV: "preview",
      GOOGLE_SHEETS_SPREADSHEET_ID: PRODUCTION_SHEET_ID,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: "cwca@example.iam.gserviceaccount.com",
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: key,
    });

    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "test-access-token" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "refused by the test stub" }), { status: 500, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    await assert.rejects(() => syncStandardsToGoogleSheets(), /Google Sheets request failed: 500/);
    const api = urls.filter((url) => url.startsWith("https://sheets.googleapis.com/"));
    assert.equal(api.length, 1);
    assert.ok(
      api[0].includes(PRODUCTION_SHEET_ID),
      "a preview deployment still resolves the production Sheet, so the writer is not safe to reach from preview",
    );

    const writer = source("./google-sheets.ts");
    assert.doesNotMatch(
      writer,
      /VERCEL_ENV/,
      "the destination is now environment-aware: finish the #42 pattern, then relax the route guard and update this test",
    );
    assert.match(writer, /Vercel preview deployment inherits/);
  });
});
