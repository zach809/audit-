import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attributeCallRole, auditMatter, parseCallDurationSeconds } from "./audit";
import { zonedDateTimeToUtc } from "./business-time";
import type { ClioCalendarEntry, ClioCommunication, MatterRecord } from "./types";

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

const WEEKLY_NOW = zonedDateTimeToUtc(2026, 8, 14, 18, 0, 0);
const WEEKLY_EVENT_AT = zonedDateTimeToUtc(2026, 8, 12, 10, 0, 0);
const CALL_AT = zonedDateTimeToUtc(2026, 8, 12, 11, 0, 0);
const INBOUND_ONE_AT = zonedDateTimeToUtc(2026, 8, 10, 9, 0, 0);
const INBOUND_TWO_AT = zonedDateTimeToUtc(2026, 8, 11, 9, 0, 0);

function caelynMatter(): MatterRecord {
  return { ...matter(), responsible_attorney_id: "7", responsible_attorney_name: "Caelyn Deeb" };
}

function weeklyEvent(): ClioCalendarEntry {
  return {
    id: 77,
    summary: "Weekly client follow-up call",
    start_at: WEEKLY_EVENT_AT.toISOString(),
    end_at: new Date(WEEKLY_EVENT_AT.getTime() + 15 * 60 * 1000).toISOString(),
    created_at: WEEKLY_EVENT_AT.toISOString(),
  };
}

function inboundMessage(id: number, at: Date): ClioCommunication {
  return {
    id,
    subject: "Client message",
    date: at.toISOString(),
    senders: [{ id: 9, name: "Jordan Reyes", type: "Contact" }],
  };
}

function dialpadBody(durationLine: string): string {
  return `Outbound via Dialpad at 16:20 GMT\n\n${durationLine}`;
}

function dialpadCall(id: number, durationLine: string, extras: Partial<ClioCommunication> = {}): ClioCommunication {
  return {
    id,
    subject: extras.subject ?? "",
    body: extras.body ?? dialpadBody(durationLine),
    type: extras.type,
    date: CALL_AT.toISOString(),
    senders: extras.senders,
    receivers: extras.receivers,
    user: extras.user,
  };
}

function subjectPhoneCall(id: number, body?: string | null): ClioCommunication {
  return {
    id,
    subject: "Phone Call",
    body: body ?? null,
    date: CALL_AT.toISOString(),
    senders: [{ id: 2, name: "Alex Kim", type: "User" }],
  };
}

function followUpItem(record: MatterRecord, communications: ClioCommunication[], calendars: ClioCalendarEntry[] = []) {
  return auditMatter(record, { communications, calendars, errors: {} }, WEEKLY_NOW).items.find((item) => item.stepCode === "CLIENT_FOLLOWUP");
}

function weeklyItem(record: MatterRecord, communications: ClioCommunication[], calendars: ClioCalendarEntry[] = [weeklyEvent()]) {
  return auditMatter(record, { communications, calendars, errors: {} }, WEEKLY_NOW).items.find((item) => item.stepCode === "WEEKLY_CLIENT_CHECKIN");
}

function unansweredPair(): ClioCommunication[] {
  return [inboundMessage(11, INBOUND_ONE_AT), inboundMessage(12, INBOUND_TWO_AT)];
}

describe("parseCallDurationSeconds", () => {
  it("reads the observed Dialpad minute-second forms and an hours form", () => {
    assert.equal(parseCallDurationSeconds("Outbound via Dialpad at 16:20 GMT\n\nCall duration: 01m14s"), 74);
    assert.equal(parseCallDurationSeconds("Call duration: 00m03s"), 3);
    assert.equal(parseCallDurationSeconds("Call duration: 12m00s"), 720);
    assert.equal(parseCallDurationSeconds("Call duration: 01h02m03s"), 3723);
  });

  it("returns null for unknown wording and never throws", () => {
    assert.equal(parseCallDurationSeconds("Spoke with the client about next court"), null);
    assert.equal(parseCallDurationSeconds("Call duration: TBD"), null);
    assert.equal(parseCallDurationSeconds(""), null);
    assert.equal(parseCallDurationSeconds(null), null);
    assert.doesNotThrow(() => parseCallDurationSeconds("Call duration: 🚀"));
  });
});

describe("connected call follow-up completeness", () => {
  it("a 14-second Dialpad call does not count, but remains not due inside the 10-day window", () => {
    const communications = [...unansweredPair(), dialpadCall(21, "Call duration: 00m14s")];
    const followUp = followUpItem(matter(), communications);
    const weekly = weeklyItem(matter(), communications);
    assert.equal(followUp?.status, "Missing");
    assert.equal(followUp?.reasonCode, "CURRENT_UNANSWERED_CLIENT_MESSAGES");
    assert.equal(weekly?.status, "Pending");
    assert.equal(weekly?.operationalState, "Not Due Yet");
  });

  it("a 16-second Dialpad call is not a missed follow-up", () => {
    const communications = [...unansweredPair(), dialpadCall(22, "Call duration: 00m16s")];
    const followUp = followUpItem(matter(), communications);
    const weekly = weeklyItem(matter(), communications);
    assert.equal(followUp?.status, "On Time");
    assert.equal(followUp?.operationalState, "No Risk");
    assert.equal(weekly?.status, "On Time");
    assert.equal(weekly?.evidenceRefId, "22");
  });

  it("a 74-second Dialpad body with no phone-looking subject is not a missed follow-up", () => {
    const communications = [...unansweredPair(), dialpadCall(23, "Call duration: 01m14s")];
    const followUp = followUpItem(matter(), communications);
    const weekly = weeklyItem(matter(), communications);
    assert.equal(followUp?.status, "On Time");
    assert.equal(weekly?.status, "On Time");
    assert.equal(weekly?.evidenceRefId, "23");
  });

  it("an unparseable body leaves the audit item exactly as a no-duration phone call does today", () => {
    const baselineComms = [...unansweredPair(), subjectPhoneCall(31)];
    const unparsedComms = [...unansweredPair(), subjectPhoneCall(31, "Spoke with the client about next court date.")];
    const baselineFollowUp = followUpItem(matter(), baselineComms);
    const unparsedFollowUp = followUpItem(matter(), unparsedComms);
    const baselineWeekly = weeklyItem(matter(), baselineComms);
    const unparsedWeekly = weeklyItem(matter(), unparsedComms);
    assert.deepEqual(unparsedFollowUp, baselineFollowUp);
    assert.deepEqual(unparsedWeekly, baselineWeekly);
    assert.equal(baselineFollowUp?.status, "On Time");
    assert.equal(baselineFollowUp?.operationalState, "No Risk");
    assert.equal(baselineFollowUp?.reasonCode, null);
    assert.equal(baselineWeekly?.status, "On Time");
    assert.equal(baselineWeekly?.evidenceRefId, "31");
  });
});

describe("rolling 10-day weekly client check-in window", () => {
  it("does not count a future weekly event as completed proof", () => {
    const futureEvent = { ...weeklyEvent(), id: 78, start_at: zonedDateTimeToUtc(2026, 8, 20, 10, 0, 0).toISOString() };
    const weekly = weeklyItem(matter(), [], [futureEvent]);
    assert.equal(weekly?.status, "Pending");
    assert.equal(weekly?.operationalState, "Not Due Yet");
    assert.equal(weekly?.evidenceRefId, null);
  });

  it("sends partial calendar proof to review instead of deducting the score", () => {
    const afterWindow = zonedDateTimeToUtc(2026, 8, 20, 18, 0, 0);
    const weekly = auditMatter(matter(), { communications: [], calendars: [weeklyEvent()], errors: {} }, afterWindow).items.find(
      (item) => item.stepCode === "WEEKLY_CLIENT_CHECKIN",
    );
    assert.equal(weekly?.status, "Unknown");
    assert.equal(weekly?.operationalState, "Needs Review - Call Proof");
    assert.equal(weekly?.reasonCode, "WEEKLY_EVENT_FOUND_CALL_NOT_FOUND");
  });

  it("marks the check-in missing only when both proof sources are absent after the grace period", () => {
    const afterWindow = zonedDateTimeToUtc(2026, 8, 20, 18, 0, 0);
    const weekly = auditMatter(matter(), { communications: [], calendars: [], errors: {} }, afterWindow).items.find(
      (item) => item.stepCode === "WEEKLY_CLIENT_CHECKIN",
    );
    assert.equal(weekly?.status, "Missing");
    assert.equal(weekly?.operationalState, "Overdue After Grace Period");
    assert.equal(weekly?.reasonCode, "WEEKLY_CLIENT_CONTACT_OVERDUE");
  });

  it("rolls a weekend day-10 deadline to Monday at 5 PM Illinois time", () => {
    const created = zonedDateTimeToUtc(2026, 8, 19, 10, 0, 0);
    const mondayBeforeFive = zonedDateTimeToUtc(2026, 8, 31, 16, 59, 0);
    const mondayAfterFive = zonedDateTimeToUtc(2026, 8, 31, 17, 1, 0);
    const wednesdayAfterFive = zonedDateTimeToUtc(2026, 9, 2, 17, 1, 0);
    const before = auditMatter(matter(created), { communications: [], calendars: [], errors: {} }, mondayBeforeFive).items.find(
      (item) => item.stepCode === "WEEKLY_CLIENT_CHECKIN",
    );
    const duringGrace = auditMatter(matter(created), { communications: [], calendars: [], errors: {} }, mondayAfterFive).items.find(
      (item) => item.stepCode === "WEEKLY_CLIENT_CHECKIN",
    );
    const afterGrace = auditMatter(matter(created), { communications: [], calendars: [], errors: {} }, wednesdayAfterFive).items.find(
      (item) => item.stepCode === "WEEKLY_CLIENT_CHECKIN",
    );
    assert.equal(before?.status, "Pending");
    assert.equal(before?.deadlineAt?.toISOString(), zonedDateTimeToUtc(2026, 8, 31, 17, 0, 0).toISOString());
    assert.equal(duringGrace?.status, "Pending");
    assert.equal(duringGrace?.operationalState, "Grace Period - No Score Deduction");
    assert.equal(duringGrace?.correctiveDeadlineAt?.toISOString(), zonedDateTimeToUtc(2026, 9, 2, 17, 0, 0).toISOString());
    assert.equal(afterGrace?.status, "Missing");
  });

  it("gives a documented outgoing call attempt three business days of grace", () => {
    const attemptAt = zonedDateTimeToUtc(2026, 8, 18, 10, 0, 0);
    const attempt: ClioCommunication = {
      id: 91,
      subject: "Attempted call - no answer - left voicemail",
      type: "PhoneCommunication",
      date: attemptAt.toISOString(),
      senders: [{ id: 2, name: "Alex Kim", type: "User" }],
      receivers: [{ id: 9, name: "Jordan Reyes", type: "Contact" }],
    };
    const duringGrace = zonedDateTimeToUtc(2026, 8, 19, 12, 0, 0);
    const weekly = auditMatter(matter(), { communications: [attempt], calendars: [], errors: {} }, duringGrace).items.find(
      (item) => item.stepCode === "WEEKLY_CLIENT_CHECKIN",
    );
    assert.equal(weekly?.status, "Pending");
    assert.equal(weekly?.operationalState, "Contact Attempted - Grace Period");
    assert.equal(weekly?.reasonCode, "WEEKLY_CONTACT_ATTEMPT_GRACE");
    assert.equal(weekly?.evidenceRefId, "91");
  });

  it("a newer outgoing email completes the check-in and starts a new 10-day window", () => {
    const contactAt = zonedDateTimeToUtc(2026, 8, 16, 9, 0, 0);
    const outgoingEmail: ClioCommunication = {
      id: 90,
      subject: "Case update",
      type: "EmailCommunication",
      date: contactAt.toISOString(),
      senders: [{ id: 2, name: "Alex Kim", type: "User" }],
      receivers: [{ id: 9, name: "Jordan Reyes", type: "Contact" }],
    };
    const afterOriginalWindow = zonedDateTimeToUtc(2026, 8, 18, 18, 0, 0);
    const weekly = auditMatter(
      matter(),
      { communications: [outgoingEmail], calendars: [weeklyEvent()], errors: {} },
      afterOriginalWindow,
    ).items.find((item) => item.stepCode === "WEEKLY_CLIENT_CHECKIN");
    assert.equal(weekly?.status, "On Time");
    assert.equal(weekly?.operationalState, "On Track");
    assert.equal(weekly?.evidenceRefId, "90");
  });

  it("an outgoing SMS completes the check-in without requiring a calendar event", () => {
    const contactAt = zonedDateTimeToUtc(2026, 8, 16, 11, 0, 0);
    const outgoingSms: ClioCommunication = {
      id: 92,
      subject: "[SMS] Outbound - Case update sent to client",
      type: "TextCommunication",
      date: contactAt.toISOString(),
      senders: [{ id: 2, name: "Alex Kim", type: "User" }],
      receivers: [{ id: 9, name: "Jordan Reyes", type: "Contact" }],
    };
    const weekly = auditMatter(
      matter(),
      { communications: [outgoingSms], calendars: [], errors: {} },
      zonedDateTimeToUtc(2026, 8, 18, 18, 0, 0),
    ).items.find((item) => item.stepCode === "WEEKLY_CLIENT_CHECKIN");
    assert.equal(weekly?.status, "On Time");
    assert.equal(weekly?.operationalState, "On Track");
    assert.equal(weekly?.evidenceRefId, "92");
  });
});

describe("call attribution", () => {
  it("attributes an outbound Dialpad call to the mapped case manager or the attorney", () => {
    const record = caelynMatter();
    assert.equal(
      attributeCallRole(
        dialpadCall(41, "Call duration: 01m14s", { senders: [{ id: 4, name: "Jesus", type: "User" }] }),
        record,
      ),
      "case_manager",
    );
    assert.equal(
      attributeCallRole(
        dialpadCall(42, "Call duration: 01m14s", { senders: [{ id: 7, name: "Caelyn Deeb", type: "User" }] }),
        record,
      ),
      "attorney",
    );
    assert.equal(
      attributeCallRole(dialpadCall(43, "Call duration: 01m14s"), record),
      "unknown",
    );
  });

  it("does not move a case-manager call onto another matter", () => {
    const record = caelynMatter();
    const call = dialpadCall(44, "Call duration: 01m14s", { senders: [{ id: 4, name: "Jesus", type: "User" }] });
    const result = auditMatter(record, { communications: [call], calendars: [weeklyEvent()], errors: {} }, WEEKLY_NOW);
    assert.equal(result.items.every((item) => item.stepCode), true);
    const weekly = result.items.find((item) => item.stepCode === "WEEKLY_CLIENT_CHECKIN");
    assert.equal(weekly?.evidenceRefId, "44");
    assert.equal(record.matter_id, "1001");
  });
});

