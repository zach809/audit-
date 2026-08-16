import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { getDashboardData, standardsCaseManagerFor } from "./dashboard-data";

function source(rel: string) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

function dashboardLoaderSource() {
  const full = source("./dashboard-data.ts");
  const start = full.indexOf("export async function getDashboardData");
  const end = full.indexOf("export async function dashboardCsv");
  assert.ok(start >= 0 && end > start, "getDashboardData source block not found");
  return full.slice(start, end);
}

function classifyDashboardQuery(text: string): string | null {
  if (text.includes("audit_metric_snapshot")) return "metrics";
  if (text.includes("audit_run")) return "lastRun";
  if (text.includes("missing_items")) return "summary";
  if (text.includes("responsible_attorney_id as id")) return "attorneys";
  if (text.includes("limit 150")) return "matters";
  if (text.includes("limit 1000")) return "workspaceItems";
  return null;
}

const FIXTURES = {
  matters: [{ matter_id: "m-1", matter_number: "1001", items: [] }],
  attorneys: [{ id: "a-1", name: "Pat Attorney", count: 2 }],
  summary: [{ total: 2, unchecked: 0, pass: 1, pending: 0, late: 0, flag: 1, review: 0, missing_items: 1, late_items: 0, unknown_items: 0 }],
  lastRun: [{ id: 9, status: "completed", started_at: "2026-08-15T00:00:00.000Z" }],
  metrics: [{ snapshot_id: 3, responsible_attorney_name: "Pat Attorney" }],
  workspaceItems: [{ matter_id: "m-1", matter_number: "1001", step_code: "SETUP_WELCOME", item_status: "On Time" }],
} as const;

const EXPECTED_DASHBOARD_JSON = JSON.stringify({
  matters: FIXTURES.matters,
  attorneys: FIXTURES.attorneys,
  summary: FIXTURES.summary[0],
  lastRun: FIXTURES.lastRun[0],
  metrics: FIXTURES.metrics,
  workspaceItems: FIXTURES.workspaceItems,
});

function installMockSql(delays: Record<string, number>) {
  const events: Array<{ name: string; start: number; end?: number }> = [];
  const sql = (strings: TemplateStringsArray) => {
    const name = classifyDashboardQuery(strings.join(" "));
    if (!name) return { fragment: strings.join(" ") };
    const start = Date.now();
    events.push({ name, start });
    return new Promise((resolve) => {
      setTimeout(() => {
        const event = events.find((row) => row.name === name && row.start === start);
        if (event) event.end = Date.now();
        resolve(FIXTURES[name as keyof typeof FIXTURES]);
      }, delays[name] ?? 5);
    });
  };
  (globalThis as { cwcaSql?: unknown; cwcaDbReady?: Promise<void> }).cwcaSql = sql;
  (globalThis as { cwcaDbReady?: Promise<void> }).cwcaDbReady = Promise.resolve();
  return events;
}

afterEach(() => {
  const globals = globalThis as { cwcaSql?: unknown; cwcaDbReady?: Promise<void> };
  delete globals.cwcaSql;
  delete globals.cwcaDbReady;
});

describe("dashboard query batching", () => {
  it("runs the six independent dashboard queries in one Promise.all", () => {
    const loader = dashboardLoaderSource();
    assert.match(loader, /await Promise\.all\(/);
    assert.equal((loader.match(/await sql/g) ?? []).length, 0);
    const batch = loader.match(/await Promise\.all\(\[([\s\S]*?)\]\)/);
    assert.ok(batch, "getDashboardData Promise.all batch not found");
    assert.equal((batch[1].match(/sql(?:<[^>]+>)?`/g) ?? []).length, 6);
  });

  it("sizes the pool so the dashboard batch does not queue on a connection", () => {
    const max = Number(source("./db.ts").match(/max:\s*(\d+)/)?.[1]);
    assert.ok(Number.isFinite(max) && max >= 8, `pool max must be >= 8 so 6 dashboard + standards + post-closure do not queue; got ${max}`);
  });

  it("starts standardsReportRows in the same page-level Promise.all as getDashboardData", () => {
    const page = source("../app/page.tsx");
    const tryBlock = page.match(/try \{([\s\S]*?)\} catch \(error\)/);
    assert.ok(tryBlock, "dashboard try/catch not found");
    assert.match(tryBlock[1], /getDashboardData\(filters\)/);
    assert.match(tryBlock[1], /getPostClosureData\(/);
    assert.match(tryBlock[1], /standardsReportRows\(/);
  });

  it("keeps serialized dashboard output byte-identical when the six queries overlap", async () => {
    const events = installMockSql({
      matters: 80,
      attorneys: 25,
      summary: 45,
      lastRun: 20,
      metrics: 20,
      workspaceItems: 55,
    });
    const wallStart = Date.now();
    const result = await getDashboardData({});
    const wallMs = Date.now() - wallStart;

    assert.equal(JSON.stringify(result), EXPECTED_DASHBOARD_JSON);

    const names = events.map((event) => event.name).sort();
    assert.deepEqual(names, ["attorneys", "lastRun", "matters", "metrics", "summary", "workspaceItems"]);
    const firstEnd = Math.min(...events.map((event) => event.end ?? Number.POSITIVE_INFINITY));
    assert.ok(events.every((event) => event.start < firstEnd), "every query must start before the first query finishes");
    assert.ok(wallMs < 200, `concurrent wall time should be near the slowest query, not the sum; got ${wallMs}ms`);
  });
});

describe("standardsCaseManagerFor", () => {
  it("assigns Elanna Myers Park City matters to Ronald, and her other matters to Lori", () => {
    assert.equal(
      standardsCaseManagerFor({
        matter_number: "PC-88",
        client_first_name: "Park City",
        client_last_name: "Holdings",
        responsible_attorney_name: "Elanna Myers",
        case_manager_name: null,
      }),
      "Ronald",
    );
    assert.equal(
      standardsCaseManagerFor({
        matter_number: "2026-440",
        client_first_name: "Jordan",
        client_last_name: "Reyes",
        responsible_attorney_name: "Elanna Myers",
        case_manager_name: null,
      }),
      "Lori",
    );
  });

  it("shows Unassigned when no attorney map or manual name exists", () => {
    assert.equal(
      standardsCaseManagerFor({
        matter_number: "2026-001",
        client_first_name: "Sam",
        client_last_name: "Lee",
        responsible_attorney_name: "Someone New",
        case_manager_name: null,
      }),
      "Unassigned",
    );
  });
});

