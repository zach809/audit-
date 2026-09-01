import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  caseManagerPortalIdentity,
  caseManagerPortalOwner,
  canonicalCaseManagerIdentity,
} from "./case-manager-identity";

describe("case-manager portal identity", () => {
  it("maps a case-manager email to that case manager", () => {
    assert.deepEqual(caseManagerPortalIdentity("ivan@hirschlawgroup.com"), { isAdmin: false, owner: "Ivan" });
  });

  it("does not let a case manager switch ownership through the URL", () => {
    assert.equal(caseManagerPortalOwner("ivan@hirschlawgroup.com", "Lori"), "Ivan");
  });

  it("lets the admin select a case manager", () => {
    assert.equal(caseManagerPortalOwner("zach@hirschlawgroup.com", "Lori"), "Lori");
  });

  it("fails closed for an unknown account", () => {
    assert.equal(canonicalCaseManagerIdentity("unknown person"), "");
    assert.equal(caseManagerPortalIdentity("unknown@hirschlawgroup.com").owner, "");
  });
});
