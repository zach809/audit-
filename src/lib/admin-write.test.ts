import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { WRITE_BLOCKED_MESSAGE, writesAllowed } from "./write-guard";
import { adminWriteRefusal, SIGN_IN_TO_WRITE_MESSAGE } from "./admin-write";
import { writeMetricExclusion } from "./metric-exclusion";

const ENV_KEYS = ["VERCEL_ENV", "CWCA_ALLOW_WRITES"] as const;
const savedEnv: Record<string, string | undefined> = {};

function source(rel: string) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

before(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
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
});

describe("in-place dashboard writes", () => {
  it("refuses preview writes even when the caller claims a signed-in admin session", () => {
    setEnv({ VERCEL_ENV: "preview", CWCA_ALLOW_WRITES: "1" });
    assert.equal(writesAllowed(), false);
    assert.equal(adminWriteRefusal(true), WRITE_BLOCKED_MESSAGE);
    assert.match(JSON.stringify({ error: adminWriteRefusal(true) }), /preview deployment pointed at the production database/);
  });

  it("refuses an unsigned-in write when production writes are allowed", () => {
    setEnv({ VERCEL_ENV: "production" });
    assert.equal(writesAllowed(), true);
    assert.equal(adminWriteRefusal(false), SIGN_IN_TO_WRITE_MESSAGE);
    assert.equal(adminWriteRefusal(true), null);
  });

  it("fails closed on unset or garbage VERCEL_ENV, ignoring a forged session flag", () => {
    for (const vercelEnv of [undefined, "", "staging", "prod", "PRODUCTION"]) {
      setEnv({ VERCEL_ENV: vercelEnv, CWCA_ALLOW_WRITES: undefined });
      assert.equal(adminWriteRefusal(true), WRITE_BLOCKED_MESSAGE);
    }
  });

  it("server actions take identity from the signed cookie, not from caller fields", () => {
    const actions = source("../app/matter-actions.ts");
    assert.match(actions, /"use server"/);
    assert.match(actions, /adminWriteRefusal\(hasDashboardSession\(\)\)/);
    assert.match(actions, /writeMetricExclusion/);
    assert.match(actions, /saveAuditReview/);
    assert.doesNotMatch(actions, /headers|searchParams|x-app-role|body\.role|input\.role/);
    assert.doesNotMatch(actions, /redirect\(/);
  });

  it("matter cards and follow-up rows update in place instead of posting a 303 form", () => {
    const page = source("../app/page.tsx");
    const cardStart = page.indexOf('className="matter-card"');
    assert.ok(cardStart >= 0, "matter-card markup not found");
    const card = page.slice(cardStart, cardStart + 2800);
    assert.match(card, /MatterExclusionControl/);
    assert.doesNotMatch(card, /action="\/api\/metrics\/exclusion"/);
    assert.match(page, /MatterExclusionControl/);

    const ongoing = page.slice(page.indexOf("ongoing-action-buttons"), page.indexOf("ongoing-action-buttons") + 1800);
    assert.match(ongoing, /MatterExclusionControl/);
    assert.doesNotMatch(ongoing, /action="\/api\/metrics\/exclusion"/);

    const controls = source("../app/matter-review-controls.tsx");
    assert.match(controls, /saveMatterReview/);
    assert.doesNotMatch(controls, /location\.assign|location\.reload|router\.refresh|useRouter/);
    assert.match(controls, /committed/);

    const row = source("../app/matter-row-write.tsx");
    assert.match(row, /"use client"/);
    assert.match(row, /aria-busy/);
    assert.match(row, /updateMatterExclusion/);
    assert.doesNotMatch(row, /location\.assign|location\.reload|router\.refresh/);
  });

  it("rejects an unknown exclusion action before touching the database", async () => {
    await assert.rejects(
      () => writeMetricExclusion({ action: "admin", matterId: "1842", reason: "", requestedBy: "" }),
      /Unknown metric action/,
    );
  });

  it("exclusion SQL still lives in one write helper used by the action and the route", () => {
    const helper = source("./metric-exclusion.ts");
    assert.match(helper, /insert into audit_metric_exclusion/);
    assert.match(helper, /update audit_metric_exclusion/);
    assert.match(helper, /action !== "exclude" && action !== "restore"/);

    const route = source("../app/api/metrics/exclusion/route.ts");
    assert.match(route, /writeMetricExclusion/);
    assert.match(route, /rejectNonProductionWrite/);
    assert.match(route, /dashboardReturnUrl/);
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
