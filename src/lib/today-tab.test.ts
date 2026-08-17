import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { complianceMark } from "./compliance-mark";
import { statusSegments } from "./status-distribution";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("Today tab composition", () => {
  it("puts the owed-work table before metrics and keys badges off mark.kind", () => {
    const today = read("app/today-tab.tsx");
    const tableAt = today.indexOf("<Table");
    const metricsAt = today.indexOf("today-metrics");
    assert.ok(tableAt >= 0, "Today is missing a Table");
    assert.ok(metricsAt > tableAt, "the work list must sit above the metrics");
    assert.match(today, /mark-\$\{mark\.kind\}/);
    assert.doesNotMatch(today, /Start with what is missing/);
    for (const column of ["Status", "Matter", "Owner", "What is missing", "Action"]) {
      assert.match(today, new RegExp(column));
    }
  });

  it("does not style a badge from the visible label", () => {
    const badge = read("components/ui/badge.tsx");
    assert.match(badge, /mark-\$\{kind\}/);
    assert.doesNotMatch(badge, /mark-\$\{mark\.label\}/);
    assert.doesNotMatch(badge, /className=\{.*label/);
    const late = complianceMark("Late");
    const timing = complianceMark("Timing Review");
    assert.equal(late.kind, timing.kind);
    assert.equal(late.kind, "late");
  });
});

describe("status distribution", () => {
  it("splits rows by compliance kind, not by the printed word", () => {
    const segments = statusSegments([
      { status: "Missing" },
      { status: "Needs Follow-Up" },
      { status: "Late" },
      { status: "Timing Review" },
      { status: "On Track" },
    ]);
    const byKind = Object.fromEntries(segments.map((segment) => [segment.kind, segment.count]));
    assert.equal(byKind.missing, 2);
    assert.equal(byKind.late, 2);
    assert.equal(byKind["on-time"], 1);
    assert.ok(segments.every((segment) => segment.className === `mark-${segment.kind}`));
  });
});
