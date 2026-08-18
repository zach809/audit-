import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditMatter } from "./audit";
import { zonedDateTimeToUtc } from "./business-time";
import type { ClioCalendarEntry, MatterRecord } from "./types";

const NOW = zonedDateTimeToUtc(2026, 8, 12, 15, 0, 0);
const MATTER_CREATED = zonedDateTimeToUtc(2026, 8, 7, 10, 0, 0);

function matter(createdAt = MATTER_CREATED): MatterRecord {
  return {
    matter_id: "1001",
    matter_number: "2026-001",
    matter_status: "open",
    client_id: "9",
    client_first_name: "Jordan",
    client_last_name: "Reyes",
    responsible_attorney_id: "2",
    responsible_attorney_name: "Alex Kim",
    matter_created_at: createdAt,
    effective_intake_at: createdAt,
    last_court_date: null,
    next_court_date: null,
    overall_status: "Pass",
    last_audited_at: null,
  };
}

function courtHearing(start: Date): ClioCalendarEntry {
  return {
    id: 41,
    summary: "Court Hearing",
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    created_at: MATTER_CREATED.toISOString(),
  };
}

function appearance(calendars: ClioCalendarEntry[] = [], now = NOW) {
  return auditMatter(matter(), { communications: [], calendars, errors: {} }, now).items.find(
    (item) => item.stepCode === "APPEARANCE_FILING",
  );
}

function snapshotCountsAppearanceSent(item: { stepCode: string; evidenceRefId: string | null } | undefined) {
  return Boolean(item && item.stepCode === "APPEARANCE_FILING" && item.evidenceRefId);
}

function standardCountsAsFulfilled(item: { status: string; evidenceRefId: string | null } | undefined) {
  if (!item) return false;
  return item.status === "On Track" || item.status === "On Time" || item.status === "Late" || Boolean(item.evidenceRefId);
}

describe("APPEARANCE_FILING court-date exception", () => {
  it("court date 3 months out, matter 5 days old: not flagged, not due yet, not fulfilled", () => {
    const item = appearance([courtHearing(zonedDateTimeToUtc(2026, 11, 12, 9, 0, 0))]);
    assert.equal(item?.status, "Pending");
    assert.equal(item?.operationalState, "Not Due Yet");
    assert.equal(item?.evidenceRefId, null);
    assert.equal(snapshotCountsAppearanceSent(item), false);
    assert.equal(standardCountsAsFulfilled(item), false);
  });

  it("court date 20 days out: flagged by the 48-hour rule", () => {
    const item = appearance([courtHearing(zonedDateTimeToUtc(2026, 9, 1, 9, 0, 0))]);
    assert.equal(item?.status, "Missing");
    assert.notEqual(item?.operationalState, "Not Due Yet");
  });

  it("court date 13 days out, no filing: flagged", () => {
    const item = appearance([courtHearing(zonedDateTimeToUtc(2026, 8, 25, 9, 0, 0))]);
    assert.equal(item?.status, "Missing");
    assert.notEqual(item?.operationalState, "Not Due Yet");
  });

  it("no court date: unchanged 48-hour behaviour", () => {
    const overdue = appearance([]);
    assert.equal(overdue?.status, "Missing");

    const stillOpen = appearance([], zonedDateTimeToUtc(2026, 8, 7, 16, 0, 0));
    assert.equal(stillOpen?.status, "Pending");
    assert.equal(stillOpen?.operationalState, "Waiting for 48-hour review window");
  });

  it("more than one month is decided on America/Chicago dates, not UTC", () => {
    const now = zonedDateTimeToUtc(2026, 8, 15, 23, 0, 0);
    const created = zonedDateTimeToUtc(2026, 8, 10, 10, 0, 0);
    const court = zonedDateTimeToUtc(2026, 9, 16, 1, 0, 0);
    const item = auditMatter(
      matter(created),
      { communications: [], calendars: [courtHearing(court)], errors: {} },
      now,
    ).items.find((row) => row.stepCode === "APPEARANCE_FILING");
    assert.equal(item?.status, "Pending");
    assert.equal(item?.operationalState, "Not Due Yet");
  });
});
