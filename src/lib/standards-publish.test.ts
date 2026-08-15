import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { publishConfiguredStandardsSheets, scheduleStandardsPublish } from "./standards-publish";

function deps(googleOn = true, excelOn = true, fail = false) {
  const calls = { google: 0, excel: 0, errors: 0 };
  return {
    calls,
    d: {
      googleConfigured: () => googleOn,
      excelConfigured: () => excelOn,
      async syncGoogle() { calls.google += 1; if (fail) throw new Error("401 invalid_grant"); },
      async syncExcel() { calls.excel += 1; if (fail) throw new Error("401"); },
      logError() { calls.errors += 1; },
    },
  };
}

function source(rel: string) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("standards publish trigger", () => {
  it("skips an unconfigured publisher silently and still runs the other", async () => {
    const { calls, d } = deps(false, true);
    assert.deepEqual(await publishConfiguredStandardsSheets(d), { google: "skipped", excel: "synced" });
    assert.deepEqual(calls, { google: 0, excel: 1, errors: 0 });
  });

  it("broken credentials fail the publisher only — the result stays failed, never thrown", async () => {
    const { calls, d } = deps(true, true, true);
    assert.deepEqual(await publishConfiguredStandardsSheets(d), { google: "failed", excel: "failed" });
    assert.deepEqual(calls, { google: 1, excel: 1, errors: 2 });
  });

  it("a partially failed audit does not call either publisher", async () => {
    const { calls, d } = deps();
    for (const status of [null, "running", "failed", "", "unknown"]) {
      assert.deepEqual(await scheduleStandardsPublish({ auditStatus: status }, d), { google: "skipped", excel: "skipped" });
    }
    assert.deepEqual(calls, { google: 0, excel: 0, errors: 0 });
  });

  it("coalesces a bulk of same-tick schedules into one publish", async () => {
    const { calls, d } = deps();
    const scheduled = Array.from({ length: 8 }, () => scheduleStandardsPublish(undefined, d));
    assert.equal(new Set(await Promise.all(scheduled)).size, 1);
    assert.deepEqual(calls, { google: 1, excel: 1, errors: 0 });
  });

  it("audit run and review routes trigger once per request, never from the failure path", () => {
    const audit = source("../app/api/audit/run/route.ts");
    const reviews = source("../app/api/reviews/route.ts");
    assert.equal([...audit.matchAll(/scheduleStandardsPublish\(/g)].length, 3);
    assert.match(audit, /scheduleStandardsPublish\(\{\s*auditStatus:\s*"completed"/);
    assert.equal([...reviews.matchAll(/scheduleStandardsPublish\(/g)].length, 1);
    assert.match(reviews, /const review = await saveAuditReview[\s\S]*scheduleStandardsPublish\(\)/);
    for (const block of `${audit}\n${reviews}`.match(/catch \([^)]+\) \{[^}]+\}/g) ?? []) {
      assert.doesNotMatch(block, /scheduleStandardsPublish/);
    }
  });
});
