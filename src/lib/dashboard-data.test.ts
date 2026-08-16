import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MATTER_PAGE_SIZE,
  EXPORT_MATTER_PAGE_SIZE,
  getDashboardData,
  parseMatterDir,
  parseMatterPage,
  parseMatterSort,
  standardsCaseManagerFor,
} from "./dashboard-data";

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
  if (text.includes("as matter_total")) return "matterCount";
  if (text.includes("as items")) return "matters";
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
  matterCount: [{ matter_total: 1474 }],
} as const;

const EXPECTED_DASHBOARD_JSON = JSON.stringify({
  matters: FIXTURES.matters,
  attorneys: FIXTURES.attorneys,
  summary: FIXTURES.summary[0],
  lastRun: FIXTURES.lastRun[0],
  metrics: FIXTURES.metrics,
  workspaceItems: FIXTURES.workspaceItems,
  matterTotal: 1474,
});

type CapturedQuery = { name: string; text: string; values: unknown[] };

function installMockSql(delays: Record<string, number>, captured?: CapturedQuery[]) {
  const events: Array<{ name: string; start: number; end?: number }> = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    const name = classifyDashboardQuery(text);
    if (!name) return { fragment: text };
    captured?.push({ name, text, values });
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
  it("runs the seven independent dashboard queries in one Promise.all", () => {
    const loader = dashboardLoaderSource();
    assert.match(loader, /await Promise\.all\(/);
    assert.equal((loader.match(/await sql/g) ?? []).length, 0);
    const batch = loader.match(/await Promise\.all\(\[([\s\S]*?)\]\)/);
    assert.ok(batch, "getDashboardData Promise.all batch not found");
    assert.equal((batch[1].match(/sql(?:<[^>]+>)?`/g) ?? []).length, 7);
    assert.match(batch[1], /as matter_total/);
  });

  it("sizes the pool so the dashboard batch does not queue on a connection", () => {
    const max = Number(source("./db.ts").match(/max:\s*(\d+)/)?.[1]);
    assert.ok(Number.isFinite(max) && max >= 10, `pool max must be >= 10 so 7 dashboard + standards + post-closure do not queue; got ${max}`);
  });

  it("starts standardsReportRows in the same page-level Promise.all as getDashboardData", () => {
    const page = source("../app/page.tsx");
    const tryBlock = page.match(/try \{([\s\S]*?)\} catch \(error\)/);
    assert.ok(tryBlock, "dashboard try/catch not found");
    assert.match(tryBlock[1], /getDashboardData\(/);
    assert.match(tryBlock[1], /getPostClosureData\(/);
    assert.match(tryBlock[1], /standardsReportRows\(/);
  });

  it("keeps serialized dashboard output byte-identical when the seven queries overlap", async () => {
    const events = installMockSql({
      matters: 80,
      attorneys: 25,
      summary: 45,
      lastRun: 20,
      metrics: 20,
      workspaceItems: 55,
      matterCount: 30,
    });
    const wallStart = Date.now();
    const result = await getDashboardData({});
    const wallMs = Date.now() - wallStart;

    assert.equal(JSON.stringify(result), EXPECTED_DASHBOARD_JSON);

    const names = events.map((event) => event.name).sort();
    assert.deepEqual(names, ["attorneys", "lastRun", "matterCount", "matters", "metrics", "summary", "workspaceItems"]);
    const firstEnd = Math.min(...events.map((event) => event.end ?? Number.POSITIVE_INFINITY));
    assert.ok(events.every((event) => event.start < firstEnd), "every query must start before the first query finishes");
    assert.ok(wallMs < 200, `concurrent wall time should be near the slowest query, not the sum; got ${wallMs}ms`);
  });
});

describe("matter paging and sort", () => {
  it("fails closed on forged or unparseable page, sort, and direction", () => {
    assert.equal(parseMatterPage(undefined), 1);
    assert.equal(parseMatterPage("0"), 1);
    assert.equal(parseMatterPage("-3"), 1);
    assert.equal(parseMatterPage("admin"), 1);
    assert.equal(parseMatterPage("2.9"), 1);
    assert.equal(parseMatterPage("8"), 8);
    assert.equal(parseMatterSort("admin"), "compliance");
    assert.equal(parseMatterSort("role"), "compliance");
    assert.equal(parseMatterSort({ sort: "date" }), "compliance");
    assert.equal(parseMatterSort("date"), "date");
    assert.equal(parseMatterSort("attorney"), "attorney");
    assert.equal(parseMatterSort("case_manager"), "case_manager");
    assert.equal(parseMatterSort("compliance"), "compliance");
    assert.equal(parseMatterDir("asc"), "asc");
    assert.equal(parseMatterDir("ASC"), "desc");
    assert.equal(parseMatterDir("admin"), "desc");
  });

  it("pages in SQL with offset, not a leftover limit 150", async () => {
    const captured: CapturedQuery[] = [];
    installMockSql({}, captured);
    await getDashboardData({ page: 7, pageSize: DEFAULT_MATTER_PAGE_SIZE, sort: "date", dir: "desc" });
    const matters = captured.find((row) => row.name === "matters");
    assert.ok(matters, "matters query was not issued");
    assert.doesNotMatch(matters.text, /limit 150/);
    assert.match(matters.text, /limit\s+\$?|limit\s+$/i);
    assert.match(matters.text, /offset/i);
    assert.ok(matters.values.includes(DEFAULT_MATTER_PAGE_SIZE), `page size ${DEFAULT_MATTER_PAGE_SIZE} must be bound`);
    assert.ok(matters.values.includes(150), "page 7 of 25 must bind offset 150 so rank 151 is reachable");
    const count = captured.find((row) => row.name === "matterCount");
    assert.ok(count, "count query was not issued");
    assert.match(count.text, /as matter_total/);
    assert.doesNotMatch(count.text, /limit|offset/i);
  });

  it("does not let a caller pageSize from the URL dump the full caseload", () => {
    const page = source("../app/page.tsx");
    assert.doesNotMatch(page, /searchParams\.pageSize/);
    assert.match(page, /DEFAULT_MATTER_PAGE_SIZE/);
    assert.match(page, /parseMatterPage\(searchParams\.page\)/);
    assert.match(page, /parseMatterSort\(searchParams\.sort\)/);
    assert.match(page, /parseMatterDir\(searchParams\.dir\)/);
  });

  it("keeps every existing filter in the shared URL when paging and sorting", () => {
    const page = source("../app/page.tsx");
    for (const key of ["attorney", "overall", "from", "to", "tab", "wstatus", "wfocus", "wstep", "cm", "closure_status", "closure_stage", "closure_attorney", "closure_window", "sort", "dir", "page"]) {
      assert.match(page, new RegExp(`name="${key}"|${key}:`), `missing ${key} in dashboard URL state`);
    }
    assert.match(page, /Showing .* of |of \{matterTotal/);
  });

  it("exports the full filtered set instead of one dashboard page", () => {
    const full = source("./dashboard-data.ts");
    const start = full.indexOf("export async function dashboardCsv");
    const end = full.indexOf("async function getActionRows");
    const csv = full.slice(start, end);
    assert.match(csv, /EXPORT_MATTER_PAGE_SIZE/);
    assert.ok(EXPORT_MATTER_PAGE_SIZE >= 10000);
  });

  it("cuts the matters payload by paging and omitting review history from the list query", () => {
    const loader = dashboardLoaderSource();
    const mattersBlock = loader.slice(loader.indexOf("select"), loader.indexOf("select responsible_attorney_id"));
    assert.doesNotMatch(mattersBlock, /audit_review_history/);
    assert.doesNotMatch(mattersBlock, /limit 150/);
    const fat = JSON.stringify(Array.from({ length: 150 }, (_, i) => ({
      matter_id: `m-${i}`,
      items: [{ stepCode: "SETUP_WELCOME", reviewHistory: [{ historyId: i, resultsDetails: "x".repeat(200) }] }],
    })));
    const paged = JSON.stringify(Array.from({ length: DEFAULT_MATTER_PAGE_SIZE }, (_, i) => ({
      matter_id: `m-${i}`,
      items: [{ stepCode: "SETUP_WELCOME" }],
    })));
    assert.ok(fat.length > 1_000_000 || fat.length > paged.length * 8, `expected a large before size; got ${fat.length} vs ${paged.length}`);
    assert.ok(paged.length < fat.length / 5, `paged list must be substantially smaller than 150 fat rows; before ${fat.length} after ${paged.length}`);
  });
});

describe("matter bulk actions", () => {
  it("repeats the existing guarded per-row endpoints and does not add a new write route", () => {
    const bulk = source("../app/matter-bulk-bar.tsx");
    assert.match(bulk, /\/api\/audit\/run/);
    assert.match(bulk, /\/api\/metrics\/exclusion/);
    assert.match(bulk, /for \(const matterId of/);
    assert.doesNotMatch(bulk, /\/api\/matters\/bulk/);
    const page = source("../app/page.tsx");
    assert.match(page, /MatterBulkBar/);
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

