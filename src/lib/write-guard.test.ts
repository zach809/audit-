import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { GET as auditRunGet, POST as auditRunPost } from "../app/api/audit/run/route";
import { POST as recheckPost } from "../app/api/audit/recheck-items/route";
import { POST as completePost } from "../app/api/case-manager/complete/route";
import { POST as exclusionPost } from "../app/api/metrics/exclusion/route";
import { GET as googleGet, POST as googlePost } from "../app/api/standards/google-sync/route";
import { GET as excelGet, POST as excelPost } from "../app/api/standards/excel-sync/route";
import { GET as exportGet } from "../app/api/export.csv/route";
import { getDashboardData } from "./dashboard-data";
import { appConfig } from "./config";
import { rejectNonProductionWrite, WRITE_BLOCKED_MESSAGE, writesAllowed } from "./write-guard";
const ENV_KEYS = [
  "VERCEL_ENV", "CWCA_ALLOW_WRITES", "DATABASE_URL", "CLIO_CLIENT_ID", "CLIO_CLIENT_SECRET",
  "CLIO_REDIRECT_URI", "TOKEN_ENCRYPTION_KEY", "DASHBOARD_PASSWORD", "CRON_SECRET",
] as const;
const savedEnv: Record<string, string | undefined> = {};
const HANDLERS: Array<{ route: string; method: string; handle: (req: NextRequest) => Promise<Response> }> = [
  { route: "/api/audit/run", method: "GET", handle: auditRunGet },
  { route: "/api/audit/run", method: "POST", handle: auditRunPost },
  { route: "/api/audit/recheck-items", method: "POST", handle: recheckPost },
  { route: "/api/case-manager/complete", method: "POST", handle: completePost },
  { route: "/api/metrics/exclusion", method: "POST", handle: exclusionPost },
  { route: "/api/standards/google-sync", method: "GET", handle: googleGet },
  { route: "/api/standards/google-sync", method: "POST", handle: googlePost },
  { route: "/api/standards/excel-sync", method: "GET", handle: excelGet },
  { route: "/api/standards/excel-sync", method: "POST", handle: excelPost },
];
function source(rel: string) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}
function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
function req(path: string, method = "GET", extras?: { headers?: Record<string, string>; body?: string }) {
  const headers = { ...extras?.headers };
  let body = extras?.body;
  if (method === "POST" && body === undefined) {
    headers["content-type"] ??= "application/x-www-form-urlencoded";
    body = "";
  }
  return new NextRequest(new URL(path, "http://localhost"), { method, headers, body });
}
async function assertBlocked(res: Response) {
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, WRITE_BLOCKED_MESSAGE);
  assert.match(JSON.stringify(body), /preview deployment pointed at the production database/);
}
async function assertNotBlocked(res: Response) {
  assert.notEqual(res.status, 403);
  assert.doesNotMatch(await res.text(), /Write blocked/);
}
before(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  Object.assign(process.env, {
    DATABASE_URL: "postgres://localhost/cwca-write-guard-test",
    CLIO_CLIENT_ID: "test-id",
    CLIO_CLIENT_SECRET: "test-secret",
    CLIO_REDIRECT_URI: "http://localhost/callback",
    TOKEN_ENCRYPTION_KEY: "test-token-encryption-key-32b!!",
    DASHBOARD_PASSWORD: "test-dashboard-password",
    CRON_SECRET: "test-cron-secret",
  });
});
after(() => {
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
describe("preview write guard", () => {
  it("allows only production, or unset VERCEL_ENV with CWCA_ALLOW_WRITES", () => {
    setEnv({ VERCEL_ENV: "production", CWCA_ALLOW_WRITES: undefined });
    assert.equal(writesAllowed(), true);
    assert.equal(rejectNonProductionWrite(), null);
    assert.equal(appConfig().vercelEnv, "production");
    setEnv({ VERCEL_ENV: undefined, CWCA_ALLOW_WRITES: "1" });
    assert.equal(writesAllowed(), true);
    setEnv({ VERCEL_ENV: undefined, CWCA_ALLOW_WRITES: "true" });
    assert.equal(writesAllowed(), true);
    for (const vercelEnv of ["preview", "development", "staging", "PRODUCTION", ""]) {
      setEnv({ VERCEL_ENV: vercelEnv || undefined, CWCA_ALLOW_WRITES: undefined });
      assert.equal(writesAllowed(), false);
    }
    setEnv({ VERCEL_ENV: "preview", CWCA_ALLOW_WRITES: "1" });
    assert.equal(writesAllowed(), false);
    setEnv({ VERCEL_ENV: undefined, CWCA_ALLOW_WRITES: "yes" });
    assert.equal(writesAllowed(), false);
    const guard = source("./write-guard.ts");
    assert.match(guard, /export function rejectNonProductionWrite\(\)/);
    assert.doesNotMatch(guard, /headers|searchParams|request|body/);
    assert.match(source("./config.ts"), /vercelEnv:\s*optionalEnv\("VERCEL_ENV"\)/);
  });

  it("refuses preview writes and allows production writes on each of the six routes", async () => {
    for (const { route, method, handle } of HANDLERS) {
      setEnv({ VERCEL_ENV: "preview" });
      await assertBlocked(await handle(req(route, method)));
      setEnv({ VERCEL_ENV: "production" });
      await assertNotBlocked(await handle(req(route, method)));
    }
    for (const file of ["audit/run", "audit/recheck-items", "case-manager/complete", "metrics/exclusion", "standards/google-sync", "standards/excel-sync"]) {
      const src = source(`../app/api/${file}/route.ts`);
      assert.equal([...src.matchAll(/export async function (GET|POST)/g)].length, [...src.matchAll(/rejectNonProductionWrite\(/g)].length, file);
    }
  });

  it("fails closed on unset or garbage VERCEL_ENV, and ignores forged request identity", async () => {
    for (const vercelEnv of [undefined, "", "staging", "prod", "PRODUCTION"]) {
      setEnv({ VERCEL_ENV: vercelEnv, CWCA_ALLOW_WRITES: undefined });
      for (const { route, method, handle } of HANDLERS) {
        await assertBlocked(await handle(req(route, method)));
      }
    }
    setEnv({ VERCEL_ENV: undefined, CWCA_ALLOW_WRITES: "1" });
    for (const { route, method, handle } of HANDLERS) {
      await assertNotBlocked(await handle(req(route, method)));
    }
    setEnv({ VERCEL_ENV: "preview", CWCA_ALLOW_WRITES: undefined });
    await assertBlocked(await auditRunPost(req("/api/audit/run", "POST", {
      headers: { "x-vercel-env": "production", "x-cwca-allow-writes": "1" },
      body: JSON.stringify({ vercelEnv: "production", role: "admin" }),
    })));
  });

  it("keeps preview reads and production cron working", async () => {
    setEnv({ VERCEL_ENV: "preview" });
    const exportRes = await exportGet(req("/api/export.csv"));
    assert.equal(exportRes.status, 303);
    assert.doesNotMatch(exportRes.headers.get("location") ?? "", /Write blocked/);
    (globalThis as { cwcaSql?: unknown; cwcaDbReady?: Promise<void> }).cwcaSql = () => [{ matter_id: "m-1" }];
    (globalThis as { cwcaDbReady?: Promise<void> }).cwcaDbReady = Promise.resolve();
    assert.ok(await getDashboardData({ attorney: "Pat Attorney", overall: "Flag" }));
    assert.doesNotMatch(source("../app/page.tsx") + source("../app/api/export.csv/route.ts") + source("../app/api/health/route.ts"), /write-guard|rejectNonProductionWrite/);
    setEnv({ VERCEL_ENV: "production" });
    const crons = JSON.parse(source("../../vercel.json")).crons as Array<{ path: string }>;
    assert.deepEqual(crons.map((row) => row.path), ["/api/audit/run", "/api/standards/google-sync", "/api/standards/excel-sync"]);
    await assertNotBlocked(await auditRunGet(req("/api/audit/run")));
    await assertNotBlocked(await googleGet(req("/api/standards/google-sync")));
    await assertNotBlocked(await excelGet(req("/api/standards/excel-sync")));
  });

  it("refuses each bulk write the same way as a single write, including a forged admin role", async () => {
    setEnv({ VERCEL_ENV: "preview", CWCA_ALLOW_WRITES: undefined });
    const ids = ["m-151", "m-152", "m-153"];
    for (const matterId of ids) {
      await assertBlocked(await auditRunPost(req("/api/audit/run", "POST", {
        headers: { "content-type": "application/x-www-form-urlencoded", "x-app-role": "admin" },
        body: new URLSearchParams({ matter_id: matterId, role: "admin" }).toString(),
      })));
      await assertBlocked(await exclusionPost(req("/api/metrics/exclusion", "POST", {
        headers: { "content-type": "application/x-www-form-urlencoded", "x-app-role": "admin" },
        body: new URLSearchParams({ action: "exclude", matter_id: matterId, role: "admin" }).toString(),
      })));
    }
  });
});
