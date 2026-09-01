import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkspaceAuditItem } from "./dashboard-data";
import { buildCaseManagerActionQueue, buildCaseManagerScore } from "./case-manager-score";
import { APP_VERSION } from "./version";

function row(overrides: Partial<WorkspaceAuditItem> = {}): WorkspaceAuditItem {
  return {
    matter_id: "matter-1",
    matter_number: "1001-2026",
    client_first_name: "Test",
    client_last_name: "Client",
    responsible_attorney_name: "Test Attorney",
    step_code: "SETUP_WELCOME",
    step_label: "Welcome Letter",
    item_status: "On Time",
    operational_state: "On Track",
    matter_created_at: new Date("2026-08-24T15:00:00.000Z"),
    deadline_at: new Date("2026-08-24T22:00:00.000Z"),
    evidence_at: new Date("2026-08-24T16:00:00.000Z"),
    evidence_ref_id: "proof-1",
    evidence_url: "https://app.clio.com/proof-1",
    reason_code: null,
    audit_version: APP_VERSION,
    review_decision: null,
    review_updated_at: null,
    metric_excluded: false,
    metric_exclusion_requested_by: null,
    ...overrides,
  } as WorkspaceAuditItem;
}

describe("case-manager score", () => {
  const options = {
    from: "2026-08-24",
    to: "2026-08-30",
    now: new Date("2026-08-29T18:00:00.000Z"),
  };

  it("deducts two points for a confirmed missing item", () => {
    const score = buildCaseManagerScore([
      row({
        item_status: "Missing",
        evidence_at: null,
        evidence_ref_id: null,
        evidence_url: null,
        reason_code: "WELCOME_LETTER_NOT_FOUND",
      }),
    ], options);

    assert.equal(score.score, 98);
    assert.equal(score.totalMissing, 1);
    assert.equal(score.totalDeduction, 2);
  });

  it("deducts half a point for completed-late proof", () => {
    const score = buildCaseManagerScore([
      row({ item_status: "Late", reason_code: "FOUND_AFTER_DEADLINE" }),
    ], options);

    assert.equal(score.score, 99.5);
    assert.equal(score.totalLate, 1);
    assert.equal(score.totalDeduction, 0.5);
  });

  it("gives full credit for an approved exception", () => {
    const score = buildCaseManagerScore([
      row({
        item_status: "Missing",
        evidence_at: null,
        evidence_ref_id: null,
        evidence_url: null,
        reason_code: "WELCOME_LETTER_NOT_FOUND",
        review_decision: "Approved Exception",
      }),
    ], options);

    assert.equal(score.score, 100);
    assert.equal(score.totalDeduction, 0);
    assert.equal(score.kpis[0].completed, 1);
  });

  it("does not deduct points from a stale audit version", () => {
    const score = buildCaseManagerScore([
      row({
        item_status: "Missing",
        evidence_at: null,
        evidence_ref_id: null,
        evidence_url: null,
        reason_code: "WELCOME_LETTER_NOT_FOUND",
        audit_version: "older-build",
      }),
    ], options);

    assert.equal(score.score, 100);
    assert.equal(score.totalDeduction, 0);
  });

  it("lists incomplete work due within seven days without deducting points", () => {
    const pending = row({
      item_status: "Pending",
      evidence_at: null,
      evidence_ref_id: null,
      evidence_url: null,
      deadline_at: new Date("2026-08-31T22:00:00.000Z"),
    });

    const queue = buildCaseManagerActionQueue([pending], { now: options.now });
    const score = buildCaseManagerScore([pending], options);

    assert.equal(queue.length, 1);
    assert.equal(queue[0].urgency, "due-soon");
    assert.equal(score.totalDeduction, 0);
  });

  it("does not list completed, protected, stale, or distant work", () => {
    const queue = buildCaseManagerActionQueue([
      row({ matter_id: "complete", deadline_at: new Date("2026-08-30T22:00:00.000Z") }),
      row({
        matter_id: "protected",
        item_status: "Pending",
        evidence_at: null,
        evidence_ref_id: null,
        evidence_url: null,
        review_decision: "Approved Exception",
        deadline_at: new Date("2026-08-30T22:00:00.000Z"),
      }),
      row({
        matter_id: "stale",
        item_status: "Pending",
        evidence_at: null,
        evidence_ref_id: null,
        evidence_url: null,
        audit_version: "older-build",
        deadline_at: new Date("2026-08-30T22:00:00.000Z"),
      }),
      row({
        matter_id: "distant",
        item_status: "Pending",
        evidence_at: null,
        evidence_ref_id: null,
        evidence_url: null,
        deadline_at: new Date("2026-09-20T22:00:00.000Z"),
      }),
    ], { now: options.now });

    assert.equal(queue.length, 0);
  });
});
