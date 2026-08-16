import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { dashboardReturnUrl, matterFocusId } from "./dashboard-return";

function source(rel: string) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

const FILTERS = {
  attorney: "Alex Blum",
  overall: "Flag",
  from: "2026-08-01",
  to: "2026-08-15",
  tab: "matters",
  wstatus: "followup",
  wfocus: "ongoing-cases",
  wstep: "WEEKLY_CLIENT_CHECKIN",
  cm: "Lori",
  closure_status: "due",
  closure_stage: "30",
  closure_attorney: "Elanna Myers",
  closure_window: "current",
  sort: "date",
  dir: "desc",
  page: "7",
};

describe("dashboard return after a mutation", () => {
  it("keeps every load-bearing filter and returns to the matter", () => {
    const url = dashboardReturnUrl({ ...FILTERS, audit: "ran", message: "Checked 1 matter." }, "1842");
    const parsed = new URL(url, "https://cwca.example");
    for (const [key, value] of Object.entries(FILTERS)) {
      assert.equal(parsed.searchParams.get(key), value, key);
    }
    assert.equal(parsed.searchParams.get("audit"), "ran");
    assert.equal(parsed.hash, "#matter-1842");
    assert.equal(parsed.pathname, "/");
  });

  it("omits empty filters the same way the old redirect did", () => {
    assert.equal(dashboardReturnUrl({ attorney: "", tab: "matters" }, "9"), "/?tab=matters#matter-9");
  });

  it("does not invent a hash when no matter was being edited", () => {
    assert.equal(dashboardReturnUrl({ tab: "matters" }), "/?tab=matters");
    assert.equal(matterFocusId(""), null);
    assert.equal(matterFocusId("not a valid id"), null);
  });

  it("audit, recheck, exclusion, and post-closure redirects use the shared return URL with the matter", () => {
    const files = [
      "../app/api/audit/run/route.ts",
      "../app/api/audit/recheck-items/route.ts",
      "../app/api/metrics/exclusion/route.ts",
      "../app/api/post-closure/followups/route.ts",
    ];
    for (const file of files) {
      const text = source(file);
      assert.match(text, /dashboardReturnUrl/, `${file} must call dashboardReturnUrl`);
      assert.match(text, /matterId/, `${file} must pass the matter id into the return URL`);
    }
  });

  it("matter cards keep an anchor and status save does not bare-reload the document top", () => {
    const page = source("../app/page.tsx");
    const cardStart = page.indexOf('className="matter-card"');
    assert.ok(cardStart >= 0, "matter-card markup not found");
    const card = page.slice(cardStart, cardStart + 2200);
    assert.match(card, /matterFocusId\(/);
    assert.match(card, /Case Manager/);
    assert.match(card, /standardsCaseManagerFor\(/);

    const controls = source("../app/matter-review-controls.tsx");
    assert.match(controls, /matterFocusId/);
    assert.equal(controls.includes("location.reload()"), false);
  });

  it("filter forms still carry every load-bearing query key", () => {
    const page = source("../app/page.tsx");
    const start = page.indexOf('<form className="filters"');
    assert.ok(start >= 0, "filter form not found");
    const form = page.slice(start, page.indexOf("</form>", start));
    for (const name of ["attorney", "overall", "from", "to", "tab", "wstatus", "wfocus", "wstep", "cm"]) {
      assert.match(form, new RegExp(`name="${name}"`), name);
    }
    for (const name of ["closure_status", "closure_stage", "closure_attorney", "closure_window"]) {
      assert.match(form, new RegExp(`name="${name}"`), name);
    }
    for (const name of ["sort", "dir", "page"]) {
      assert.match(form, new RegExp(`name="${name}"`), `${name} must survive Apply or paging resets to page 1`);
    }
  });
});
