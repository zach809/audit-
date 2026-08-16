import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ARRIVAL_APPLY_KEYS,
  FILTER_PARAM_KEYS,
  arrivalHref,
  clientNameMatches,
  hasExplicitFilterParam,
  parseRemembered,
  prefsFromSearch,
} from "./dashboard-prefs";

function source(rel: string) {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

describe("remembered dashboard filters", () => {
  it("names every shared query key the dashboard already carries", () => {
    assert.deepEqual([...FILTER_PARAM_KEYS], [
      "attorney",
      "overall",
      "from",
      "to",
      "tab",
      "wstatus",
      "wfocus",
      "wstep",
      "cm",
      "closure_status",
      "closure_stage",
      "closure_attorney",
      "closure_window",
      "sort",
      "dir",
      "page",
    ]);
  });

  it("treats a URL with any of those keys as an explicit shared link", () => {
    assert.equal(hasExplicitFilterParam(""), false);
    assert.equal(hasExplicitFilterParam("?"), false);
    assert.equal(hasExplicitFilterParam("?audit=ran"), false);
    assert.equal(hasExplicitFilterParam("?cm=Lori"), true);
    assert.equal(hasExplicitFilterParam("?tab=matters"), true);
    assert.equal(hasExplicitFilterParam("foo=1&page=2"), true);
  });

  it("lets an explicit shared link beat a different remembered cm", () => {
    assert.equal(arrivalHref("?cm=Ronald", { cm: "Lori" }), null);
    assert.equal(arrivalHref("?tab=matters", { cm: "Lori" }), null);
    assert.equal(arrivalHref("?cm=Lori", { cm: "Lori" }), null);
  });

  it("applies a remembered cm only on a fresh arrival with no filter params", () => {
    assert.equal(arrivalHref("", { cm: "Lori" }), "/?cm=Lori");
    assert.equal(arrivalHref("?", { cm: "Lori" }), "/?cm=Lori");
    assert.equal(arrivalHref("?audit=ran", { cm: "Svetlana" }), "/?cm=Svetlana");
    assert.equal(arrivalHref("", null), null);
    assert.equal(arrivalHref("", {}), null);
    assert.equal(arrivalHref("", { tab: "debug", page: "7" }), null);
  });

  it("does not invent a case manager when memory is empty or junk", () => {
    assert.equal(parseRemembered(null), null);
    assert.equal(parseRemembered(""), null);
    assert.equal(parseRemembered("not-json"), null);
    assert.equal(parseRemembered("[]"), null);
    assert.deepEqual(parseRemembered('{"cm":"Lori","role":"admin","tab":"debug"}'), { cm: "Lori", tab: "debug" });
    assert.deepEqual(prefsFromSearch("?cm=Lori&page=2&notice=hi"), { cm: "Lori", page: "2" });
  });

  it("does not treat a client-name query as a match for a different person", () => {
    assert.equal(clientNameMatches("Maria Santos", "sant"), true);
    assert.equal(clientNameMatches("Maria Santos", "Lori"), false);
    assert.equal(clientNameMatches("Maria Santos", ""), true);
  });

  it("fresh arrival never applies tab or page from memory", () => {
    const applied = ARRIVAL_APPLY_KEYS.join(",");
    assert.doesNotMatch(applied, /(^|,)tab(,|$)/);
    assert.doesNotMatch(applied, /(^|,)page(,|$)/);
  });
});

describe("fewer-steps dashboard surface", () => {
  it("groups the ten destinations and keeps every one reachable", () => {
    const page = source("../app/page.tsx");
    assert.match(page, /DAILY_TABS/);
    assert.match(page, /RECORDS_TABS/);
    assert.match(page, /TOOL_TABS/);
    assert.match(page, />Records</);
    assert.match(page, />Tools</);
    for (const label of [
      "Today",
      "Matters",
      "Standards",
      "Ongoing",
      "Post-Closure",
      "Reports",
      "Audit Debug",
      "Guide",
      "Compliance",
      "Review Site",
    ]) {
      assert.match(page, new RegExp(label.replace(" ", "\\s")), label);
    }
  });

  it("lands Today on the remembered case-manager list and marks one primary action per row", () => {
    const page = source("../app/page.tsx");
    const start = page.indexOf("const todaysPriorities");
    assert.ok(start >= 0, "todaysPriorities missing");
    assert.match(page.slice(start, start + 500), /caseManagerWorkspaceRows/);
    assert.match(page, /data-job-row/);
    assert.match(page, /data-job-primary/);
    assert.match(page, /DashboardJobChrome/);
  });

  it("does not hide the secondary row action behind hover", () => {
    const css = source("../app/docket.css");
    assert.doesNotMatch(css, /command-task-actions[^}]*display:\s*none/);
    assert.doesNotMatch(css, /:hover[^{]*\{[^}]*command-task-actions/);
  });
});
