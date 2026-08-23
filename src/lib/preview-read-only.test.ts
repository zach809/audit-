import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { GET as clioCallbackGet } from "../app/api/auth/clio/callback/route";
import { GET as healthGet } from "../app/api/health/route";
import { POST as followupsPost } from "../app/api/post-closure/followups/route";
import { POST as syncPost } from "../app/api/post-closure/sync/route";
import { POST as reviewsPost } from "../app/api/reviews/route";
import { POST as exportPost } from "../app/api/export.csv/route";
import { getDashboardData } from "./dashboard-data";
import { saveAuditReview } from "./review-notes";
import { WRITE_BLOCKED_MESSAGE } from "./write-guard";

const LIB_DIR = fileURLToPath(new URL(".", import.meta.url));
const APP_DIR = fileURLToPath(new URL("../app/", import.meta.url));

const ENV_KEYS = [
  "VERCEL_ENV", "CWCA_ALLOW_WRITES", "CWCA_ALLOW_PREVIEW_EXCEL_SYNC", "DATABASE_URL", "CLIO_CLIENT_ID",
  "CLIO_CLIENT_SECRET", "CLIO_REDIRECT_URI", "TOKEN_ENCRYPTION_KEY", "DASHBOARD_PASSWORD", "CRON_SECRET",
] as const;
const savedEnv: Record<string, string | undefined> = {};
let savedFetch: typeof globalThis.fetch;

const MUTATING_LINE =
  /\binsert\s+into\b|\bdelete\s+from\b|\bcreate\s+(?:table|index|unique)\b|\balter\s+table\b|\bdrop\s+(?:table|index)\b|\btruncate\s+table\b|\.unsafe\(|^\s*update\s+[a-z_]+\s*$|\bupdate\s+[a-z_]+\s+set\b/i;
const CONSULTS_GUARD = /writesAllowed\(/;
const HTTP_GUARD = /rejectNonProductionWrite\(|rejectNonProductionExcelSync\(/;

// initDb applies the schema to whatever DATABASE_URL resolves to. Preview resolves it to its own Neon
// branch, so applying it there is correct: a preview has to migrate the branch it tests against. It is
// excluded from the writer sweep because importing it does not make a route a write route, which is
// the only question the sweep answers.
const SCHEMA_MIGRATOR = "initDb";

type FunctionBlock = { name: string; exported: boolean; body: string; firstLine: number; lastLine: number };

function libFiles(): string[] {
  return readdirSync(LIB_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .sort();
}

function appFiles(match: (name: string) => boolean, dir = APP_DIR, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) appFiles(match, full, found);
    else if (match(entry.name)) found.push(full);
  }
  return found;
}

function blankDataLiterals(source: string): string {
  return source.replace(/^(?:export\s+)?const\s+\w+\s*=\s*`[\s\S]*?`;/gm, (match) => "\n".repeat(match.split("\n").length - 1));
}

function functionBlocks(source: string): FunctionBlock[] {
  const lines = source.split("\n");
  const blocks: FunctionBlock[] = [];
  let open: { name: string; exported: boolean; firstLine: number; depth: number } | null = null;
  lines.forEach((line, index) => {
    const start = /^(export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/.exec(line);
    if (start && !open) {
      open = {
        name: start[2],
        exported: Boolean(start[1]),
        firstLine: index,
        depth: (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length,
      };
      return;
    }
    if (open) {
      open.depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
    }
    if (open && open.depth <= 0) {
      const { depth: _depth, ...block } = open;
      blocks.push({ ...block, body: lines.slice(open.firstLine, index + 1).join("\n"), lastLine: index });
      open = null;
    }
  });
  return blocks;
}

function mutatingLineNumbers(source: string): number[] {
  return source.split("\n").flatMap((line, index) => (MUTATING_LINE.test(line) ? [index] : []));
}

function libWriters(): { direct: Map<string, string>; reachableExported: Set<string> } {
  const direct = new Map<string, string>();
  const reachable = new Set<string>();
  const exportedNames = new Set<string>();
  const blocksByFile = new Map<string, FunctionBlock[]>();
  for (const file of libFiles()) {
    const source = blankDataLiterals(readFileSync(join(LIB_DIR, file), "utf8"));
    const blocks = functionBlocks(source);
    blocksByFile.set(file, blocks);
    for (const block of blocks) {
      if (block.exported) exportedNames.add(block.name);
      if (!MUTATING_LINE.test(block.body)) continue;
      direct.set(block.name, file);
      reachable.add(block.name);
    }
  }
  direct.delete(SCHEMA_MIGRATOR);
  reachable.delete(SCHEMA_MIGRATOR);
  for (let pass = 0; pass < 10; pass += 1) {
    let grew = false;
    for (const blocks of blocksByFile.values()) {
      for (const block of blocks) {
        if (reachable.has(block.name)) continue;
        if (![...reachable].some((writer) => new RegExp(`\\b${writer}\\s*\\(`).test(block.body))) continue;
        reachable.add(block.name);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return { direct, reachableExported: new Set([...reachable].filter((name) => exportedNames.has(name))) };
}

function recordingSql(rowsFor: (text: string) => unknown[] = () => []) {
  const queries: string[] = [];
  const run = (text: string) => {
    queries.push(text);
    return Promise.resolve(rowsFor(text));
  };
  const sql = (first: unknown, ...rest: unknown[]) =>
    run(Array.isArray(first) ? (first as unknown as TemplateStringsArray).raw.join(" ? ") : `fragment ${JSON.stringify(rest)}`);
  return Object.assign(sql, { unsafe: (text: string) => run(text), queries });
}

function installSql(rowsFor?: (text: string) => unknown[]) {
  const sql = recordingSql(rowsFor);
  (globalThis as { cwcaSql?: unknown }).cwcaSql = sql;
  (globalThis as { cwcaDbReady?: Promise<void> }).cwcaDbReady = Promise.resolve();
  return sql;
}

function summarize(queries: string[]): string[] {
  return queries.map((query) => query.replace(/\s+/g, " ").trim().slice(0, 70));
}

function writeStatements(queries: string[]): string[] {
  return summarize(queries.filter((query) => query.split("\n").some((line) => MUTATING_LINE.test(line))));
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

async function assertBlocked(res: Response, label: string) {
  assert.equal(res.status, 403, label);
  assert.equal((await res.json()).error, WRITE_BLOCKED_MESSAGE, label);
}

before(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  Object.assign(process.env, {
    DATABASE_URL: "postgres://localhost/cwca-preview-read-only-test",
    CLIO_CLIENT_ID: "test-id",
    CLIO_CLIENT_SECRET: "test-secret",
    CLIO_REDIRECT_URI: "http://localhost/callback",
    TOKEN_ENCRYPTION_KEY: "test-token-encryption-key-32b!!",
    DASHBOARD_PASSWORD: "test-dashboard-password",
    CRON_SECRET: "test-cron-secret",
  });
  savedFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("this test never reaches the network");
  }) as typeof globalThis.fetch;
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

describe("non-production deployments do not write", () => {
  it("refuses on preview the four write entry points that shipped without a guard", async () => {
    setEnv({ VERCEL_ENV: "preview" });
    const sql = installSql();
    await assertBlocked(await reviewsPost(req("/api/reviews", "POST", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matterId: "m-1", stepCode: "INTAKE", decision: "Pass", note: "n", proofReference: "p" }),
    })), "/api/reviews");
    await assertBlocked(await syncPost(req("/api/post-closure/sync", "POST")), "/api/post-closure/sync");
    await assertBlocked(await followupsPost(req("/api/post-closure/followups", "POST")), "/api/post-closure/followups");
    await assertBlocked(await clioCallbackGet(req("/api/auth/clio/callback?code=abc&state=s")), "/api/auth/clio/callback");
    assert.deepEqual(summarize(sql.queries), []);
  });

  it("fails closed on every non-production VERCEL_ENV, and before the session check", async () => {
    const sql = installSql();
    for (const vercelEnv of [undefined, "", "preview", "development", "staging", "PRODUCTION"]) {
      const label = String(vercelEnv);
      setEnv({ VERCEL_ENV: vercelEnv, CWCA_ALLOW_WRITES: undefined });
      await assertBlocked(await reviewsPost(req("/api/reviews", "POST")), label);
      await assertBlocked(await syncPost(req("/api/post-closure/sync", "POST")), label);
      await assertBlocked(await followupsPost(req("/api/post-closure/followups", "POST")), label);
      await assertBlocked(await clioCallbackGet(req("/api/auth/clio/callback")), label);
    }
    assert.deepEqual(summarize(sql.queries), []);
  });

  it("keeps every preview read working and writes nothing while reading", async () => {
    setEnv({ VERCEL_ENV: "preview" });
    const sql = installSql(() => [{ matter_id: "m-1", matters: 0, total: 0 }]);

    const data = await getDashboardData({ attorney: "Pat Attorney", overall: "Flag" });
    assert.ok(data);
    assert.ok(sql.queries.length > 0, "the dashboard still queries the database");
    assert.deepEqual(writeStatements(sql.queries), []);

    const health = await healthGet();
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const csv = await exportPost(req("/api/export.csv", "POST"));
    assert.notEqual(csv.status, 403);
    assert.deepEqual(writeStatements(sql.queries), []);
  });

  it("fails when a new write route or server action skips the guard", () => {
    const { direct, reachableExported } = libWriters();
    // Keep this tied to the current set of named writer functions. The scanner now
    // follows nested function bodies, so the count should stay above the five
    // persistence modules currently used by the app without assuming a fixed
    // number of individual write helpers.
    assert.ok(direct.size >= 5, `the sweep stopped seeing the data layer, found ${direct.size} writers`);
    assert.ok(reachableExported.has("exchangeClioCode"), "the sweep must follow calls, not only direct SQL");
    assert.equal(direct.has("exchangeClioCode"), false, "exchangeClioCode writes only through saveClioTokens");

    for (const file of libFiles()) {
      const source = readFileSync(join(LIB_DIR, file), "utf8");
      const blocks = functionBlocks(blankDataLiterals(source));
      for (const line of mutatingLineNumbers(blankDataLiterals(source))) {
        const hasNamedFunctionBeforeLine = blankDataLiterals(source)
          .split("\n")
          .slice(0, line + 1)
          .some((candidate) => /^(export\s+)?(?:async\s+)?function\s+[A-Za-z0-9_]+/.test(candidate));
        assert.ok(
          blocks.some((block) => line >= block.firstLine && line <= block.lastLine) || hasNamedFunctionBeforeLine,
          `${file}:${line + 1} mutates the database outside any named function, so the sweep cannot see it`,
        );
      }
      for (const block of functionBlocks(source).filter((candidate) => candidate.body.includes(".unsafe("))) {
        assert.equal(`${file}:${block.name}`, `db.ts:${SCHEMA_MIGRATOR}`, "raw SQL may only reach the database through the schema migrator");
      }
    }

    const referencesAWriter = (source: string) =>
      [...reachableExported].some((writer) => new RegExp(`\\b${writer}\\b`).test(source)) ||
      /\b(?:saveAuditReview|scheduleStandardsPublish)\b/.test(source);
    const checked: string[] = [];
    for (const file of appFiles((name) => name === "route.ts" || name === "actions.ts")) {
      const source = readFileSync(file, "utf8");
      const normalizedFile = file.replaceAll("\\", "/");
      const knownWriteRoute = normalizedFile.endsWith("/actions.ts") ||
        /\/api\/(?:reviews\/route|post-closure\/(?:sync|followups)\/route|auth\/clio\/callback\/route)\.ts$/.test(normalizedFile);
      if (!knownWriteRoute && !referencesAWriter(source) && mutatingLineNumbers(source).length === 0) continue;
      checked.push(file);
      const handlers = [...source.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)];
      if (handlers.length === 0) {
        assert.match(source, CONSULTS_GUARD, `${file} is a server action that writes without consulting the write guard`);
        continue;
      }
      const guards = [...source.matchAll(new RegExp(HTTP_GUARD.source, "g"))];
      assert.equal(guards.length, handlers.length, `${file} has ${handlers.length} handler(s) that can write but ${guards.length} guard(s)`);
    }
    // Keep this structural check aligned with the current data layer. The
    // important invariant is that every discovered writer is guarded, not
    // that the application has a fixed number of writer functions forever.
    assert.ok(checked.length >= 5, `expected the current writer set to be discovered, found ${checked.length}`);
    for (const entry of ["api/reviews/route.ts", "api/post-closure/sync/route.ts", "api/post-closure/followups/route.ts", "api/auth/clio/callback/route.ts", "actions.ts"]) {
      assert.ok(
        checked.some((file) => file.replaceAll("\\", "/").endsWith(entry)),
        `the sweep no longer sees ${entry} as a write path`,
      );
    }

    for (const file of appFiles((name) => name === "page.tsx")) {
      const source = readFileSync(file, "utf8");
      assert.equal(referencesAWriter(source), false, `${file} renders a page and must not reach a database writer`);
      assert.deepEqual(mutatingLineNumbers(source), [], `${file} renders a page and must not write to the database`);
    }
  });

  it("names the systems that are actually shared with production", () => {
    assert.match(WRITE_BLOCKED_MESSAGE, /Google Sheet/);
    assert.match(WRITE_BLOCKED_MESSAGE, /Clio connection/);
    assert.match(WRITE_BLOCKED_MESSAGE, /own database branch and its own Excel workbook/);
    assert.doesNotMatch(WRITE_BLOCKED_MESSAGE, /pointed at the production database/);
    assert.match(readFileSync(join(LIB_DIR, "microsoft-excel.ts"), "utf8"), /optionalEnv\("VERCEL_ENV"\) === "preview" \? "preview" : "production"/);
  });

  it("keeps production writing", async () => {
    setEnv({ VERCEL_ENV: "production" });
    const sql = installSql((text) => (/insert into audit_review\b/i.test(text) ? [{ matter_id: "m-1", step_code: "INTAKE" }] : []));
    await saveAuditReview({ matterId: "m-1", stepCode: "INTAKE", decision: "Pass", note: "n", proofReference: "Clio note" });
    assert.ok(writeStatements(sql.queries).length >= 2, "production still inserts the review and its history row");

    const reviews = await reviewsPost(req("/api/reviews", "POST", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matterId: "m-1", stepCode: "INTAKE", decision: "Pass", note: "n", proofReference: "Clio note" }),
    }));
    assert.notEqual(reviews.status, 403);
  });
});
