import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { complianceMark, COMPLIANCE_KINDS } from "./compliance-mark";

describe("complianceMark", () => {
  it("keeps the five official words, including aliases people already see", () => {
    assert.deepEqual(complianceMark("On Time"), { kind: "on-time", label: "On Time" });
    assert.deepEqual(complianceMark("On Track"), { kind: "on-time", label: "On Time" });
    assert.deepEqual(complianceMark("Late"), { kind: "late", label: "Late" });
    assert.deepEqual(complianceMark("Timing Review"), { kind: "late", label: "Late" });
    assert.deepEqual(complianceMark("Missing"), { kind: "missing", label: "Missing" });
    assert.deepEqual(complianceMark("Needs Follow-Up"), { kind: "missing", label: "Missing" });
    assert.deepEqual(complianceMark("Pending"), { kind: "not-due", label: "Not Due Yet" });
    assert.deepEqual(complianceMark("Not Due Yet"), { kind: "not-due", label: "Not Due Yet" });
    assert.deepEqual(complianceMark("No activity"), { kind: "no-activity", label: "No activity" });
  });

  it("gives each official state a different mark kind so greyscale still works", () => {
    const kinds = [
      complianceMark("On Time").kind,
      complianceMark("Late").kind,
      complianceMark("Missing").kind,
      complianceMark("Not Due Yet").kind,
      complianceMark("No activity").kind,
    ];
    assert.deepEqual(kinds, ["on-time", "late", "missing", "not-due", "no-activity"]);
    assert.equal(new Set(kinds).size, 5);
    for (const kind of kinds) {
      assert.ok(COMPLIANCE_KINDS.includes(kind));
    }
  });

  it("does not fold review states into Missing or Late", () => {
    assert.equal(complianceMark("Needs Review").kind, "other");
    assert.equal(complianceMark("Needs Review").label, "Needs Review");
    assert.equal(complianceMark("Unknown").kind, "other");
  });
});
