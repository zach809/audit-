import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { currentChicagoMonthRange } from "./standards-sheet-sync";
import { publishConfiguredStandardsSheets, scheduleStandardsPublish } from "./standards-publish";

function deps(googleOn = true, excelOn = true, fail = false) {
  const calls = { google: 0, excel: 0, errors: 0 };
  const excelFilters: Array<unknown> = [];
  const errorMessages: string[] = [];
  return {
    calls,
    excelFilters,
    errorMessages,
    d: {
      googleConfigured: () => googleOn,
      excelConfigured: () => excelOn,
      workbookTarget: () => "workbook-item-cwca-standards",
      async syncGoogle() {
        calls.google += 1;
        if (fail) throw new Error("401 invalid_grant");
      },
      async syncExcel(filters?: unknown) {
        calls.excel += 1;
        excelFilters.push(filters);
        if (fail) throw new Error("401 Excel unreachable");
      },
      logError(message: string) {
        calls.errors += 1;
        errorMessages.push(message);
      },
    },
  };
}

function source(rel: string) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("standards publish trigger", () => {
  it("on-change publishes Excel Online and does not call Google even when a Google stub is provided", async () => {
    const { calls, d } = deps(true, true);
    assert.deepEqual(await publishConfiguredStandardsSheets(d), { google: "skipped", excel: "synced" });
    assert.equal(calls.google, 0);
    assert.equal(calls.excel, 1);
    assert.equal(calls.errors, 0);
  });

  it("skips Excel when it is not configured — skipped, not an error — and still never calls Google", async () => {
    const { calls, d } = deps(true, false);
    assert.deepEqual(await publishConfiguredStandardsSheets(d), { google: "skipped", excel: "skipped" });
    assert.deepEqual(calls, { google: 0, excel: 0, errors: 0 });
  });

  it("broken Excel credentials fail the publisher only — failed, logged with the workbook target, never thrown, Google untouched", async () => {
    const { calls, d, errorMessages } = deps(true, true, true);
    assert.deepEqual(await publishConfiguredStandardsSheets(d), { google: "skipped", excel: "failed" });
    assert.equal(calls.google, 0);
    assert.equal(calls.excel, 1);
    assert.equal(calls.errors, 1);
    assert.match(errorMessages[0] ?? "", /Excel Online/);
    assert.match(errorMessages[0] ?? "", /workbook-item-cwca-standards/);
  });

  it("passes the current Chicago month through today to Excel, computed per call", async () => {
    const first = deps();
    await publishConfiguredStandardsSheets(first.d);
    assert.deepEqual(first.excelFilters[0], currentChicagoMonthRange());
    assert.equal(first.calls.google, 0);

    const second = deps();
    await publishConfiguredStandardsSheets(second.d);
    assert.deepEqual(second.excelFilters[0], currentChicagoMonthRange());

    const publish = source("./standards-publish.ts");
    assert.match(publish, /syncExcel\(currentChicagoMonthRange\(\)\)/);
    assert.doesNotMatch(publish, /const \w+\s*=\s*currentChicagoMonthRange\(\)/);
  });

  it("a partially failed audit does not publish Excel or Google", async () => {
    const { calls, d } = deps();
    for (const status of [null, "running", "failed", "", "unknown"]) {
      assert.deepEqual(await scheduleStandardsPublish({ auditStatus: status }, d), {
        google: "skipped",
        excel: "skipped",
      });
    }
    assert.deepEqual(calls, { google: 0, excel: 0, errors: 0 });
  });

  it("coalesces a bulk of same-tick schedules into one Excel publish and zero Google calls", async () => {
    const { calls, d } = deps();
    const scheduled = Array.from({ length: 40 }, () => scheduleStandardsPublish(undefined, d));
    assert.equal(new Set(await Promise.all(scheduled)).size, 1);
    assert.deepEqual(calls, { google: 0, excel: 1, errors: 0 });
  });

  it("audit run and review routes trigger Excel publish once per request, never from the failure path", () => {
    const audit = source("../app/api/audit/run/route.ts");
    const reviews = source("../app/api/reviews/route.ts");
    assert.equal([...audit.matchAll(/scheduleStandardsPublish\(/g)].length, 3);
    assert.match(audit, /scheduleStandardsPublish\(\{\s*auditStatus:\s*"completed"/);
    assert.doesNotMatch(audit, /await scheduleStandardsPublish/);
    assert.equal([...reviews.matchAll(/scheduleStandardsPublish\(/g)].length, 1);
    assert.match(reviews, /const review = await saveAuditReview[\s\S]*scheduleStandardsPublish\(\)/);
    assert.doesNotMatch(reviews, /await scheduleStandardsPublish/);
    for (const block of `${audit}\n${reviews}`.match(/catch \([^)]+\) \{[^}]+\}/g) ?? []) {
      assert.doesNotMatch(block, /scheduleStandardsPublish/);
    }
  });

  it("does not import or call the Google Sheets writer from the on-change publisher", () => {
    const publish = source("./standards-publish.ts");
    assert.doesNotMatch(publish, /google-sheets/);
    assert.doesNotMatch(publish, /syncStandardsToGoogleSheets/);
    assert.doesNotMatch(publish, /googleSheetsConfigured/);
  });

  it("leaves the Google Sheets weekday cron and google-sync route wired as they ship today", () => {
    const vercel = JSON.parse(source("../../vercel.json")) as {
      crons: Array<{ path: string; schedule: string }>;
    };
    assert.deepEqual(
      vercel.crons.find((cron) => cron.path === "/api/standards/google-sync"),
      { path: "/api/standards/google-sync", schedule: "30 23 * * 1-5" },
    );
    const googleRoute = source("../app/api/standards/google-sync/route.ts");
    assert.match(googleRoute, /syncStandardsToGoogleSheets/);
    assert.doesNotMatch(googleRoute, /scheduleStandardsPublish/);
  });
});
