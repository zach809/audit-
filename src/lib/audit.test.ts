import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import {
  attributeCallRole,
  auditMatter,
  evidenceSweepWindow,
  fetchEvidence,
  groupEvidenceByMatter,
  INITIAL_SWEEP_MAX_PAGES,
  lastCompletedFinishedAt,
  mergeSweepItems,
  parseCallDurationSeconds,
  pickEvidenceForMatters,
  shouldWriteSweepAudit,
  sweepFirmEvidence,
  SWEEP_OVERLAP_MS,
} from "./audit";
import { ClioClient } from "./clio";
import { zonedDateTimeToUtc } from "./business-time";
import type { AuditItemResult, ClioCalendarEntry, ClioCommunication, MatterRecord } from "./types";

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
  it("a 14-second Dialpad call still counts as a missed follow-up", () => {
    const communications = [...unansweredPair(), dialpadCall(21, "Call duration: 00m14s")];
    const followUp = followUpItem(matter(), communications);
    const weekly = weeklyItem(matter(), communications);
    assert.equal(followUp?.status, "Missing");
    assert.equal(followUp?.reasonCode, "CURRENT_UNANSWERED_CLIENT_MESSAGES");
    assert.equal(weekly?.status, "Missing");
    assert.equal(weekly?.reasonCode, "WEEKLY_EVENT_FOUND_CALL_NOT_FOUND");
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

function serializeItems(items: AuditItemResult[]) {
  return JSON.stringify(
    items,
    (_, value) => (value instanceof Date ? value.toISOString() : value),
  );
}

function welcomeLetter(id: number, matterId: string, at: Date): ClioCommunication {
  return {
    id,
    subject: "Welcome to Hirsch Law Group",
    date: at.toISOString(),
    created_at: at.toISOString(),
    matter: { id: Number(matterId) },
    senders: [{ id: 2, name: "Alex Kim", type: "User" }],
  };
}

function hearingFor(id: number, matterId: string, start: Date): ClioCalendarEntry {
  return {
    id,
    summary: "Court Hearing",
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    created_at: MATTER_CREATED.toISOString(),
    matter: { id: Number(matterId) },
  };
}

describe("evidence watermark", () => {
  const completedAt = new Date("2026-08-16T00:30:00.000Z");
  const failedAt = new Date("2026-08-16T00:45:00.000Z");
  const now = new Date("2026-08-16T01:00:00.000Z");

  it("uses the last completed finished_at, never a later failed run", () => {
    const since = lastCompletedFinishedAt([
      { status: "completed", finished_at: completedAt },
      { status: "failed", finished_at: failedAt },
      { status: "running", finished_at: null },
      { status: "completed", finished_at: "not-a-date" },
    ]);
    assert.equal(since?.toISOString(), completedAt.toISOString());
    const window = evidenceSweepWindow({
      runs: [
        { status: "completed", finished_at: completedAt },
        { status: "failed", finished_at: failedAt },
      ],
      now,
      lookbackDays: 90,
    });
    assert.equal(window.kind, "incremental");
    assert.equal(window.since.toISOString(), new Date(completedAt.getTime() - SWEEP_OVERLAP_MS).toISOString());
  });

  it("a mid-run failure leaves the next window on the last successful cover", () => {
    const firstWindow = evidenceSweepWindow({
      runs: [{ status: "completed", finished_at: completedAt }],
      now,
      lookbackDays: 90,
    });
    const afterFailure = evidenceSweepWindow({
      runs: [
        { status: "completed", finished_at: completedAt },
        { status: "failed", finished_at: failedAt },
      ],
      now: new Date("2026-08-16T01:10:00.000Z"),
      lookbackDays: 90,
    });
    assert.equal(afterFailure.since.toISOString(), firstWindow.since.toISOString());
    assert.equal(afterFailure.kind, "incremental");
  });

  it("the first run is a 90-day lookback, chunked only by the page bound", () => {
    const window = evidenceSweepWindow({ runs: [], now, lookbackDays: 90 });
    assert.equal(window.kind, "initial");
    assert.equal(window.since.toISOString(), new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString());
    assert.equal(INITIAL_SWEEP_MAX_PAGES, 40);
  });
});

describe("sweep grouping and empty-window guard", () => {
  it("groups by matter_id, drops rows with no matter, and does not keep out-of-scope matters", () => {
    const comms = [
      welcomeLetter(1, "1001", MATTER_CREATED),
      welcomeLetter(2, "2002", MATTER_CREATED),
      { id: 3, subject: "Orphan", date: MATTER_CREATED.toISOString() },
    ];
    const cals = [hearingFor(41, "1001", zonedDateTimeToUtc(2026, 8, 20, 9, 0, 0)), hearingFor(42, "9999", NOW)];
    const grouped = groupEvidenceByMatter(comms, cals);
    assert.deepEqual([...grouped.keys()].sort(), ["1001", "2002", "9999"]);
    assert.equal(grouped.get("1001")?.communications.length, 1);
    assert.equal(grouped.get("1001")?.calendars.length, 1);
    assert.equal(grouped.get("2002")?.communications[0]?.id, 2);
    const scoped = pickEvidenceForMatters(grouped, ["1001"]);
    assert.deepEqual([...scoped.keys()], ["1001"]);
    assert.equal(scoped.has("2002"), false);
    assert.equal(scoped.has("9999"), false);
  });

  it("same matters in, same serialized audit_item rows from per-matter evidence vs grouped sweep", () => {
    const one = matter();
    const two: MatterRecord = { ...matter(), matter_id: "2002", matter_number: "2026-002" };
    const comms = [welcomeLetter(1, "1001", MATTER_CREATED), welcomeLetter(2, "2002", MATTER_CREATED)];
    const cals = [
      hearingFor(41, "1001", zonedDateTimeToUtc(2026, 8, 20, 9, 0, 0)),
      hearingFor(42, "2002", zonedDateTimeToUtc(2026, 8, 21, 9, 0, 0)),
    ];
    const grouped = groupEvidenceByMatter(comms, cals);
    const perMatter = [one, two].map((record) =>
      auditMatter(
        record,
        {
          communications: comms.filter((row) => String(row.matter?.id) === record.matter_id),
          calendars: cals.filter((row) => String(row.matter?.id) === record.matter_id),
          errors: {},
        },
        NOW,
      ),
    );
    const fromSweep = [one, two].map((record) => auditMatter(record, grouped.get(record.matter_id)!, NOW));
    assert.equal(serializeItems(fromSweep[0].items), serializeItems(perMatter[0].items));
    assert.equal(serializeItems(fromSweep[1].items), serializeItems(perMatter[1].items));
    assert.equal(fromSweep[0].overallStatus, perMatter[0].overallStatus);
    assert.equal(fromSweep[1].overallStatus, perMatter[1].overallStatus);
  });

  it("an empty incremental sweep is not treated as no evidence existing", () => {
    const record = matter();
    const prior = auditMatter(
      record,
      {
        communications: [welcomeLetter(1, "1001", MATTER_CREATED)],
        calendars: [hearingFor(41, "1001", zonedDateTimeToUtc(2026, 8, 20, 9, 0, 0))],
        errors: {},
      },
      NOW,
    );
    const empty = auditMatter(record, { communications: [], calendars: [], errors: {} }, NOW);
    assert.notEqual(serializeItems(empty.items), serializeItems(prior.items));
    assert.equal(empty.items.find((item) => item.stepCode === "SETUP_WELCOME")?.status, "Missing");
    assert.equal(prior.items.find((item) => item.stepCode === "SETUP_WELCOME")?.status, "On Time");
    assert.equal(
      shouldWriteSweepAudit({
        kind: "incremental",
        communicationCount: 0,
        calendarCount: 0,
        hasPriorItems: true,
      }),
      "keep-prior",
    );
    assert.equal(
      shouldWriteSweepAudit({
        kind: "incremental",
        communicationCount: 0,
        calendarCount: 0,
        hasPriorItems: false,
      }),
      "keep-prior",
    );
    assert.equal(
      shouldWriteSweepAudit({
        kind: "initial",
        communicationCount: 0,
        calendarCount: 0,
        hasPriorItems: false,
      }),
      "audit",
    );
    const merged = mergeSweepItems(empty.items, prior.items);
    assert.equal(merged.find((item) => item.stepCode === "SETUP_WELCOME")?.evidenceRefId, "1");
    assert.equal(merged.find((item) => item.stepCode === "SETUP_COURT_DATE")?.evidenceRefId, "41");
  });
});

type CountStub = {
  arrivals: string[];
  handler: (req: IncomingMessage, res: ServerResponse) => void;
};

function sendJson(res: ServerResponse, body: unknown) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function withCountingClient(stub: CountStub, run: (client: ClioClient) => Promise<void>) {
  const server = createServer((req, res) => {
    stub.arrivals.push(req.url ?? "");
    stub.handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const client = new ClioClient(6000, {
    apiBase: `http://127.0.0.1:${port}`,
    accessToken: async () => "stub-token",
  });
  try {
    await run(client);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

describe("firm-wide evidence sweep request count", () => {
  const records = [matter(), { ...matter(), matter_id: "2002" }, { ...matter(), matter_id: "3003" }, { ...matter(), matter_id: "4004" }, { ...matter(), matter_id: "5005" }];

  it("drops from 2 requests per matter to 2 firm-wide list calls for the same five matters", async (t) => {
    const comms = records.map((record, index) => welcomeLetter(index + 1, record.matter_id, MATTER_CREATED));
    const cals = records.map((record, index) => hearingFor(50 + index, record.matter_id, zonedDateTimeToUtc(2026, 8, 20, 9, 0, 0)));
    const handler = (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const matterId = url.searchParams.get("matter_id");
      const rows = url.pathname.includes("communications") ? comms : cals;
      const data = matterId ? rows.filter((row) => String(row.matter?.id) === matterId) : rows;
      sendJson(res, { data });
    };

    const before: CountStub = { arrivals: [], handler };
    await withCountingClient(before, async (client) => {
      for (const record of records) await fetchEvidence(client, record);
    });

    const after: CountStub = { arrivals: [], handler };
    await withCountingClient(after, async (client) => {
      const sweep = await sweepFirmEvidence(client, {
        since: new Date(NOW.getTime() - 90 * 24 * 60 * 60 * 1000),
        until: NOW,
        kind: "initial",
      });
      assert.equal(pickEvidenceForMatters(sweep.grouped, records.map((record) => record.matter_id)).size, 5);
    });

    const beforePaths = before.arrivals.map((url) => new URL(url, "http://127.0.0.1").pathname);
    t.diagnostic(`REQUEST COUNT before=${before.arrivals.length} after=${after.arrivals.length}`);
    assert.equal(before.arrivals.length, 10, `before arrivals=${before.arrivals.join(" | ")}`);
    assert.equal(after.arrivals.length, 2, `after arrivals=${after.arrivals.join(" | ")}`);
    assert.equal(beforePaths.filter((path) => path === "/communications.json").length, 5);
    assert.ok(after.arrivals.every((url) => !url.includes("matter_id=")));
    assert.ok(after.arrivals.some((url) => url.includes("updated_since=")));
  });

  it("a page-bound sweep throws so the run cannot complete and move the watermark", async () => {
    await assert.rejects(
      () =>
        sweepFirmEvidence(
          {
            list: async () => {
              throw new Error("Clio list /communications.json exceeded 40 pages; the audit watermark will not advance");
            },
          },
          { since: new Date("2026-05-18T00:00:00.000Z"), until: NOW, kind: "initial" },
        ),
      /exceeded 40 pages/,
    );
  });
});

