import { addBusinessDaysDeadline, addWeekdayHours, effectiveIntake, isBusinessDay, localParts, setupDeadlines, zonedDateTimeToUtc } from "./business-time";
import { ClioApiError, ClioClient } from "./clio";
import { db, initDb, pruneExpiredStoredData } from "./db";
import {
  haystack,
  isAppearanceTemplate,
  isAttorneyCall,
  isCalendarEmailContact,
  isCourtEvent,
  isCourtReminderTemplate,
  isCourtResultTemplate,
  isPossibleCourtEvent,
  isPhoneCallCommunication,
  isWelcomeTemplate,
  isWeeklyClientCheckIn,
} from "./patterns";
import type {
  AuditItemResult,
  AuditStatus,
  ClioCalendarEntry,
  ClioCommunication,
  ClioMatter,
  MatterRecord,
  OverallStatus,
  StepCode,
} from "./types";
import { appConfig } from "./config";
import { APP_VERSION } from "./version";

type Evidence<T> = { item: T; at: Date; source: AuditItemResult["evidenceSource"]; url: string };
type EvidenceErrors = {
  communications?: string;
  calendars?: string;
};
type EvidenceBundle = {
  communications: ClioCommunication[];
  calendars: ClioCalendarEntry[];
  errors: EvidenceErrors;
};
type AuditBatchFilters = {
  attorney?: string;
  from?: string;
  to?: string;
};

function apiReason(error: unknown, label: string): string {
  if (error instanceof ClioApiError) {
    let detail = error.body;
    try {
      const parsed = JSON.parse(error.body);
      detail = parsed?.error?.message ?? parsed?.message ?? error.body;
    } catch {
      // Keep original response body when it is not JSON.
    }
    return `${label.toUpperCase()}_${error.status}: ${detail}`.slice(0, 220);
  }
  return `${label.toUpperCase()}_ERROR: ${error instanceof Error ? error.message : String(error)}`.slice(0, 220);
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isDateOnly(value?: string | null): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test((value ?? "").trim());
}

function commDate(comm: ClioCommunication): Date | null {
  const preciseDate = [comm.date, comm.received_at, comm.created_at]
    .filter((value) => value && !isDateOnly(value))
    .map((value) => parseDate(value))
    .find((value): value is Date => Boolean(value));
  return preciseDate ?? parseDate(comm.date ?? comm.received_at ?? comm.created_at);
}

function communicationSearchText(comm: ClioCommunication, includeBody = false): string {
  const externalValues = comm.external_properties?.flatMap((prop) => [prop.name, prop.value]) ?? [];
  const senderValues = comm.senders?.flatMap((sender) => [sender.name, sender.type]) ?? [];
  const receiverValues = comm.receivers?.flatMap((receiver) => [receiver.name, receiver.type]) ?? [];
  return haystack(comm.subject, comm.type, comm.user?.name, ...senderValues, ...receiverValues, ...externalValues, includeBody ? comm.body : null);
}

function communicationDirectionText(comm: ClioCommunication): string {
  const externalValues = comm.external_properties?.flatMap((prop) => [prop.name, prop.value]) ?? [];
  const senderValues = comm.senders?.flatMap((sender) => [sender.name, sender.type]) ?? [];
  const receiverValues = comm.receivers?.flatMap((receiver) => [receiver.name, receiver.type]) ?? [];
  return haystack(comm.subject, comm.type, comm.user?.name, ...senderValues, ...receiverValues, ...externalValues);
}

function isReplySubject(subject?: string | null): boolean {
  return /^\s*(re|fw|fwd)\s*:/i.test(subject ?? "");
}

function isOutbound(comm: ClioCommunication, clientId: string | null): boolean | null {
  const directionText = communicationDirectionText(comm);
  if (directionText.includes("inbound")) return false;
  if (directionText.includes("outbound")) return true;
  if (comm.user?.id) return true;
  const receivers = comm.receivers ?? [];
  const senders = comm.senders ?? [];
  if (senders.some((s) => haystack(s.type, s.name).includes("user") || haystack(s.type, s.name).includes("firm"))) return true;
  if (senders.some((s) => haystack(s.type).includes("contact") || haystack(s.type).includes("client"))) return false;
  if (clientId && receivers.some((r) => String(r.id) === clientId)) return true;
  if (clientId && senders.some((s) => String(s.id) === clientId)) return false;
  return null;
}

function earliest<T>(items: Evidence<T>[]): Evidence<T> | null {
  return items.sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
}

function calendarEnd(cal: ClioCalendarEntry): Date | null {
  return parseDate(cal.end_at) ?? parseDate(cal.start_at);
}

function calendarSearchText(cal: ClioCalendarEntry): string {
  return haystack(cal.summary, cal.description, cal.calendar_entry_event_type?.name, cal.calendar_owner?.name);
}

function isFirmPhoneCall(comm: ClioCommunication, clientId: string | null): boolean {
  if (!isPhoneCallCommunication(communicationSearchText(comm))) return false;
  return isOutbound(comm, clientId) !== false;
}

function isPettyTrafficMatter(record: MatterRecord): boolean {
  return haystack(record.matter_number).includes("petty traffic");
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function addDaysRaw(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function previousBusinessDayEnd(date: Date): Date {
  const parts = localParts(date);
  let candidate = zonedDateTimeToUtc(parts.year, parts.month, parts.day - 1, 17, 0, 0);
  while (!isBusinessDay(candidate)) {
    const candidateParts = localParts(candidate);
    candidate = zonedDateTimeToUtc(candidateParts.year, candidateParts.month, candidateParts.day - 1, 17, 0, 0);
  }
  return candidate;
}

function previousBusinessDayStart(date: Date): Date {
  const parts = localParts(date);
  let candidate = zonedDateTimeToUtc(parts.year, parts.month, parts.day - 1, 8, 0, 0);
  while (!isBusinessDay(candidate)) {
    const candidateParts = localParts(candidate);
    candidate = zonedDateTimeToUtc(candidateParts.year, candidateParts.month, candidateParts.day - 1, 8, 0, 0);
  }
  return candidate;
}

function localDateKey(date: Date): string {
  const parts = localParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localDateDistanceDays(a: Date, b: Date): number {
  const [ay, am, ad] = localDateKey(a).split("-").map(Number);
  const [by, bm, bd] = localDateKey(b).split("-").map(Number);
  const aUtc = Date.UTC(ay, am - 1, ad);
  const bUtc = Date.UTC(by, bm - 1, bd);
  return Math.round((aUtc - bUtc) / (24 * 60 * 60 * 1000));
}

function endOfLocalBusinessDay(date: Date): Date {
  const parts = localParts(date);
  return zonedDateTimeToUtc(parts.year, parts.month, parts.day, 17, 0, 0);
}

function startOfLocalDay(date: Date): Date {
  const parts = localParts(date);
  return zonedDateTimeToUtc(parts.year, parts.month, parts.day, 0, 0, 0);
}

function endOfLocalDay(date: Date): Date {
  const parts = localParts(date);
  return zonedDateTimeToUtc(parts.year, parts.month, parts.day, 23, 59, 59);
}

function withEvidence<T extends { id: number }>(result: AuditItemResult, evidence: Evidence<T>): AuditItemResult {
  return {
    ...result,
    evidenceAt: evidence.at,
    evidenceSource: evidence.source,
    evidenceRefId: String(evidence.item.id),
    evidenceUrl: evidence.url,
  };
}

function classify(
  stepCode: StepCode,
  evidence: Evidence<{ id: number }> | null,
  deadlineAt: Date | null,
  options: {
    required?: boolean;
    operationalState?: string;
    correctiveDeadlineAt?: Date | null;
    reasonCode?: string | null;
    now?: Date;
    unknown?: boolean;
    missingAsReview?: boolean;
  } = {},
): AuditItemResult {
  const required = options.required ?? true;
  const now = options.now ?? new Date();
  if (!required) {
    return base(stepCode, "N/A", "", deadlineAt, options.correctiveDeadlineAt ?? null);
  }
  if (options.unknown) {
    return base(stepCode, "Unknown", "Unknown", deadlineAt, options.correctiveDeadlineAt ?? null, options.reasonCode ?? "UNKNOWN");
  }
  if (!evidence) {
    const corrective = options.correctiveDeadlineAt ?? deadlineAt;
    const stillPending = deadlineAt && now <= deadlineAt;
    if (!stillPending && options.missingAsReview) {
      return base(stepCode, "Unknown", "Needs Review", deadlineAt, corrective, options.reasonCode ?? "EVIDENCE_NOT_CONFIRMED");
    }
    return base(
      stepCode,
      stillPending ? "Pending" : "Missing",
      stillPending ? options.operationalState ?? "Pending" : "Overdue",
      deadlineAt,
      corrective,
      stillPending ? null : options.reasonCode ?? "NOT_FOUND",
    );
  }
  const status: AuditStatus = deadlineAt && evidence.at <= deadlineAt ? "On Time" : "Late";
  return {
    ...base(stepCode, status, status, deadlineAt, options.correctiveDeadlineAt ?? null, status === "Late" ? options.reasonCode ?? "FOUND_AFTER_DEADLINE" : null),
    evidenceAt: evidence.at,
    evidenceSource: evidence.source,
    evidenceRefId: String(evidence.item.id),
    evidenceUrl: evidence.url,
  };
}

function base(
  stepCode: StepCode,
  status: AuditStatus,
  operationalState: string,
  deadlineAt: Date | null,
  correctiveDeadlineAt: Date | null,
  reasonCode: string | null = null,
): AuditItemResult {
  return {
    stepCode,
    status,
    operationalState,
    deadlineAt,
    correctiveDeadlineAt,
    evidenceAt: null,
    evidenceSource: null,
    evidenceRefId: null,
    evidenceUrl: null,
    reasonCode,
  };
}

function overall(items: AuditItemResult[]): OverallStatus {
  if (items.some((i) => i.status === "Unknown")) return "Review";
  if (items.some((i) => i.status === "Missing")) return "Flag";
  if (items.some((i) => i.status === "Late")) return "Late";
  if (items.some((i) => i.status === "Pending")) return "Pending";
  return "Pass";
}

function matterNumber(matter: ClioMatter): string {
  return matter.display_number ?? String(matter.number ?? matter.id);
}

function isFirmPlaceholderAttorney(name?: string | null): boolean {
  const text = haystack(name);
  return !text || text === "hirsch law group" || text === "the hirsch law group" || text === "hirsch law" || text === "firm";
}

function matterAttorney(matter: ClioMatter): { id: string | null; name: string } {
  const responsible = matter.responsible_attorney;
  if (responsible?.name && !isFirmPlaceholderAttorney(responsible.name)) {
    return {
      id: responsible.id ? String(responsible.id) : null,
      name: responsible.name,
    };
  }

  const originating = matter.originating_attorney;
  if (originating?.name && !isFirmPlaceholderAttorney(originating.name)) {
    return {
      id: originating.id ? String(originating.id) : null,
      name: originating.name,
    };
  }

  return {
    id: responsible?.id ? String(responsible.id) : originating?.id ? String(originating.id) : null,
    name: responsible?.name ?? originating?.name ?? "",
  };
}

function evidenceUrl(type: "communications" | "calendar_entries", id: number): string {
  return `/evidence/${type}/${id}`;
}

const AUDIT_STEP_CODES: StepCode[] = [
  "SETUP_WELCOME",
  "SETUP_ATTY_CALL",
  "SETUP_COURT_DATE",
  "CLIENT_CONTACT",
  "APPEARANCE_FILING",
  "COURT_RESULTS",
  "POST_COURT_CALL",
  "COURT_REMINDER_CALL",
  "CLIENT_FOLLOWUP",
  "WEEKLY_CLIENT_CHECKIN",
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function saveMatter(matter: ClioMatter): Promise<MatterRecord> {
  const created = new Date(matter.created_at);
  const effective = effectiveIntake(created);
  const clientName = matter.client?.name ?? "";
  const splitName = clientName.split(" ");
  const first = matter.client?.first_name ?? splitName[0] ?? "";
  const last = matter.client?.last_name ?? splitName.slice(1).join(" ") ?? "";
  const attorney = matterAttorney(matter);
  const record = {
    matter_id: String(matter.id),
    matter_number: matterNumber(matter),
    matter_status: matter.status ?? "",
    client_id: matter.client?.id ? String(matter.client.id) : null,
    client_first_name: first,
    client_last_name: last,
    responsible_attorney_id: attorney.id,
    responsible_attorney_name: attorney.name,
    matter_created_at: created,
    effective_intake_at: effective,
    last_court_date: null,
    next_court_date: null,
    overall_status: "Pass" as OverallStatus,
    last_audited_at: null,
  };
  await db()`
    insert into audit_matter ${db()(record)}
    on conflict (matter_id) do update set
      matter_number = excluded.matter_number,
      matter_status = excluded.matter_status,
      client_id = excluded.client_id,
      client_first_name = excluded.client_first_name,
      client_last_name = excluded.client_last_name,
      responsible_attorney_id = excluded.responsible_attorney_id,
      responsible_attorney_name = excluded.responsible_attorney_name,
      matter_created_at = excluded.matter_created_at,
      effective_intake_at = excluded.effective_intake_at
  `;
  return record;
}

async function upsertItems(matterId: string, items: AuditItemResult[], overallStatus: OverallStatus, court: { last: Date | null; next: Date | null }) {
  const sql = db();
  for (const item of items) {
    await sql`
      insert into audit_item (
        matter_id, step_code, status, operational_state, deadline_at, corrective_deadline_at,
        evidence_at, evidence_source, evidence_ref_id, evidence_url, reason_code, audit_version, last_evaluated_at
      )
      values (
        ${matterId}, ${item.stepCode}, ${item.status}, ${item.operationalState},
        ${item.deadlineAt}, ${item.correctiveDeadlineAt}, ${item.evidenceAt},
        ${item.evidenceSource}, ${item.evidenceRefId}, ${item.evidenceUrl},
        ${item.reasonCode}, ${APP_VERSION}, now()
      )
      on conflict (matter_id, step_code) do update set
        status = excluded.status,
        operational_state = excluded.operational_state,
        deadline_at = excluded.deadline_at,
        corrective_deadline_at = excluded.corrective_deadline_at,
        evidence_at = excluded.evidence_at,
        evidence_source = excluded.evidence_source,
        evidence_ref_id = excluded.evidence_ref_id,
        evidence_url = excluded.evidence_url,
        reason_code = excluded.reason_code,
        audit_version = excluded.audit_version,
        last_evaluated_at = now()
    `;
  }
  await sql`
    update audit_matter
    set overall_status = ${overallStatus},
        last_court_date = ${court.last},
        next_court_date = ${court.next},
        last_audited_at = now()
    where matter_id = ${matterId}
  `;
}

export async function discoverMatters(client = new ClioClient(), lookbackDays = appConfig().initialLookbackDays): Promise<number> {
  await initDb();
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const fields = "id,number,display_number,status,created_at,responsible_attorney{id,name},originating_attorney{id,name},client{id,first_name,last_name,name}";
  const matters = await client.list<ClioMatter>("/matters.json", { fields, created_since: since.toISOString() });
  let count = 0;
  for (const matter of matters) {
    await saveMatter(matter);
    if ((matter.status ?? "").toLowerCase() === "closed") continue;
    count += 1;
  }
  return count;
}

async function fetchEvidence(client: ClioClient, matter: MatterRecord): Promise<EvidenceBundle> {
  const calendarFrom = new Date(matter.matter_created_at.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const calendarTo = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const [communicationsResult, calendarsResult] = await Promise.allSettled([
    client.list<ClioCommunication>("/communications.json", {
      fields: "id,subject,body,type,date,created_at,received_at,matter{id},user{id,name},senders{id,name,type},receivers{id,name,type},external_properties{name,value}",
      matter_id: matter.matter_id,
    }),
    client.list<ClioCalendarEntry>("/calendar_entries.json", {
      fields: "id,summary,description,start_at,end_at,created_at,all_day,matter{id},calendar_owner{id,name},calendar_entry_event_type{id,name}",
      matter_id: matter.matter_id,
      from: calendarFrom,
      to: calendarTo,
    }),
  ]);
  const errors: EvidenceErrors = {};
  if (communicationsResult.status === "rejected") errors.communications = apiReason(communicationsResult.reason, "communications");
  if (calendarsResult.status === "rejected") errors.calendars = apiReason(calendarsResult.reason, "calendars");
  return {
    communications: communicationsResult.status === "fulfilled" ? communicationsResult.value : [],
    calendars: calendarsResult.status === "fulfilled" ? calendarsResult.value : [],
    errors,
  };
}

function auditMatter(record: MatterRecord, evidence: EvidenceBundle, now = new Date()) {
  const setup = setupDeadlines(record.matter_created_at);
  const clientDeadline = addBusinessDaysDeadline(record.effective_intake_at, 1);
  const appearanceDeadline = addWeekdayHours(record.matter_created_at, 48);
  const firstWeeklyCheckInDeadline = addBusinessDaysDeadline(record.effective_intake_at, 5);
  const commError = evidence.errors.communications;
  const calendarError = evidence.errors.calendars;

  const communicationEvidence = (matcher: (text: string) => boolean, deadlineWindowStart?: Date, options: { allowUnclearDirection?: boolean; allowAnyDirection?: boolean; includeBodyText?: boolean } = {}) =>
    earliest(
      evidence.communications
        .map((comm): Evidence<ClioCommunication> | null => {
          const at = commDate(comm);
          if (!at || (deadlineWindowStart && at < deadlineWindowStart)) return null;
          const text = communicationSearchText(comm, options.includeBodyText);
          if (!matcher(text)) return null;
          const direction = isOutbound(comm, record.client_id);
          if (options.allowAnyDirection) return { item: comm, at, source: "Communication", url: evidenceUrl("communications", comm.id) };
          if (direction !== true && !options.allowUnclearDirection) return null;
          if (direction === false) return null;
          return { item: comm, at, source: "Communication", url: evidenceUrl("communications", comm.id) };
        })
        .filter(Boolean) as Evidence<ClioCommunication>[],
    );

  const templateCommunicationEvidence = (matcher: (text: string) => boolean, deadlineWindowStart?: Date) =>
    earliest(
      evidence.communications
        .map((comm): Evidence<ClioCommunication> | null => {
          const at = commDate(comm);
          if (!at || (deadlineWindowStart && at < deadlineWindowStart)) return null;
          const direction = isOutbound(comm, record.client_id);
          if (direction === false) return null;
          if (direction !== true && isReplySubject(comm.subject)) return null;

          const externalValues = comm.external_properties?.flatMap((prop) => [prop.name, prop.value]) ?? [];
          const subjectText = haystack(comm.subject, ...externalValues);
          const fullText = communicationSearchText(comm, true);
          if (!matcher(subjectText) && !matcher(fullText)) return null;

          return { item: comm, at, source: "Communication", url: evidenceUrl("communications", comm.id) };
        })
        .filter(Boolean) as Evidence<ClioCommunication>[],
    );

  const callEvidence = earliest(
    evidence.calendars
      .map((cal): Evidence<ClioCalendarEntry> | null => {
        const at = parseDate(cal.created_at ?? cal.start_at);
        if (!at) return null;
        if (!isAttorneyCall(calendarSearchText(cal))) return null;
        return { item: cal, at, source: "Calendar", url: evidenceUrl("calendar_entries", cal.id) };
      })
      .filter(Boolean) as Evidence<ClioCalendarEntry>[],
  );
  const attorneyCallCommunicationEvidence = communicationEvidence(isPhoneCallCommunication, record.effective_intake_at, {
    allowUnclearDirection: true,
    includeBodyText: false,
  });
  const attorneyCallEvidence = callEvidence ?? attorneyCallCommunicationEvidence;

  const weeklyCheckInEvents = evidence.calendars
    .map((cal): Evidence<ClioCalendarEntry> | null => {
      const at = parseDate(cal.start_at);
      if (!at) return null;
      if (!isWeeklyClientCheckIn(calendarSearchText(cal))) return null;
      return { item: cal, at, source: "Calendar", url: evidenceUrl("calendar_entries", cal.id) };
    })
    .filter(Boolean) as Evidence<ClioCalendarEntry>[];

  const pastOrTodayWeeklyCheckIn = weeklyCheckInEvents
    .filter((event) => event.at <= now)
    .sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
  const nextWeeklyCheckIn = weeklyCheckInEvents
    .filter((event) => event.at > now)
    .sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
  const weeklyCheckInEvent = pastOrTodayWeeklyCheckIn ?? nextWeeklyCheckIn;
  const weeklyCheckInDeadline = weeklyCheckInEvent ? endOfLocalBusinessDay(weeklyCheckInEvent.at) : firstWeeklyCheckInDeadline;
  const weeklyCheckInCall = weeklyCheckInEvent
    ? earliest(
        evidence.communications
          .map((comm): Evidence<ClioCommunication> | null => {
            const at = commDate(comm);
            if (!at || localDateKey(at) !== localDateKey(weeklyCheckInEvent.at)) return null;
            if (!isFirmPhoneCall(comm, record.client_id)) return null;
            return { item: comm, at, source: "Communication", url: evidenceUrl("communications", comm.id) };
          })
          .filter(Boolean) as Evidence<ClioCommunication>[],
      )
    : null;
  const nearbyWeeklyCheckInCall = weeklyCheckInEvent
    ? (evidence.communications
        .map((comm): (Evidence<ClioCommunication> & { distance: number }) | null => {
          const at = commDate(comm);
          if (!at || !isFirmPhoneCall(comm, record.client_id)) return null;
          const distance = Math.abs(localDateDistanceDays(at, weeklyCheckInEvent.at));
          if (distance === 0 || distance > 3) return null;
          return { item: comm, at, source: "Communication", url: evidenceUrl("communications", comm.id), distance };
        })
        .filter(Boolean) as Array<Evidence<ClioCommunication> & { distance: number }>)
        .sort((a, b) => a.distance - b.distance || a.at.getTime() - b.at.getTime())[0] ?? null
    : null;
  const weeklyCallWithoutCalendar = !weeklyCheckInEvent
    ? earliest(
        evidence.communications
          .map((comm): Evidence<ClioCommunication> | null => {
            const at = commDate(comm);
            if (!at || at < addDaysRaw(firstWeeklyCheckInDeadline, -7)) return null;
            if (!isFirmPhoneCall(comm, record.client_id)) return null;
            return { item: comm, at, source: "Communication", url: evidenceUrl("communications", comm.id) };
          })
          .filter(Boolean) as Evidence<ClioCommunication>[],
      )
    : null;
  const weeklyCheckInItem = (() => {
    if (calendarError) {
      return base("WEEKLY_CLIENT_CHECKIN", "Unknown", "Unknown", weeklyCheckInDeadline, null, calendarError);
    }
    if (!weeklyCheckInEvent) {
      if (weeklyCallWithoutCalendar && now > firstWeeklyCheckInDeadline) {
        return withEvidence(
          base("WEEKLY_CLIENT_CHECKIN", "Late", "Timing Review", firstWeeklyCheckInDeadline, null, "WEEKLY_CALL_FOUND_EVENT_NOT_FOUND"),
          weeklyCallWithoutCalendar,
        );
      }
      return classify("WEEKLY_CLIENT_CHECKIN", null, firstWeeklyCheckInDeadline, {
        operationalState: "Waiting for weekly check-in window",
        reasonCode: "WEEKLY_CALENDAR_EVENT_NOT_FOUND",
        now,
      });
    }
    if (weeklyCheckInCall) {
      return withEvidence(base("WEEKLY_CLIENT_CHECKIN", "On Time", "On Time", weeklyCheckInDeadline, null), weeklyCheckInCall);
    }
    if (nearbyWeeklyCheckInCall) {
      return withEvidence(base("WEEKLY_CLIENT_CHECKIN", "Late", "Late", weeklyCheckInDeadline, null, "CALL_FOUND_NEARBY_DATE"), nearbyWeeklyCheckInCall);
    }
    if (now <= weeklyCheckInDeadline) {
      return withEvidence(base("WEEKLY_CLIENT_CHECKIN", "Pending", "Not Due Yet", weeklyCheckInDeadline, null), weeklyCheckInEvent);
    }
    if (commError) {
      return withEvidence(base("WEEKLY_CLIENT_CHECKIN", "Unknown", "Unknown", weeklyCheckInDeadline, null, commError), weeklyCheckInEvent);
    }
    return withEvidence(base("WEEKLY_CLIENT_CHECKIN", "Missing", "Needs Same-Day Call Proof", weeklyCheckInDeadline, null, "WEEKLY_EVENT_FOUND_CALL_NOT_FOUND"), weeklyCheckInEvent);
  })();

  const courtEvents = evidence.calendars
    .map((cal): Evidence<ClioCalendarEntry> | null => {
      const at = parseDate(cal.start_at);
      if (!at) return null;
      const text = calendarSearchText(cal);
      if (!isCourtEvent(text) && !isPossibleCourtEvent(text)) return null;
      return { item: cal, at, source: "Calendar", url: evidenceUrl("calendar_entries", cal.id) };
    })
    .filter(Boolean) as Evidence<ClioCalendarEntry>[];

  const courtAdded = earliest(
    courtEvents
      .map((ev) => ({ ...ev, at: parseDate(ev.item.created_at ?? ev.item.start_at) ?? ev.at }))
      .filter((ev) => ev.at >= record.effective_intake_at),
  );

  const pastCourts = courtEvents
    .filter((ev) => {
      const endedAt = calendarEnd(ev.item);
      return Boolean(endedAt && endedAt < now);
    })
    .sort((a, b) => {
      const aEnd = calendarEnd(a.item) ?? a.at;
      const bEnd = calendarEnd(b.item) ?? b.at;
      return bEnd.getTime() - aEnd.getTime();
    });
  const lastCourt = pastCourts[0] ?? null;
  const lastCourtEnd = lastCourt ? calendarEnd(lastCourt.item) : null;
  const nextCourt = lastCourtEnd
    ? courtEvents.filter((ev) => ev.at > lastCourtEnd && ev.at > now).sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null
    : courtEvents.filter((ev) => ev.at > now).sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;

  const courtResultDeadline = lastCourtEnd ? addHours(lastCourtEnd, 48) : null;
  const courtResult = lastCourtEnd ? templateCommunicationEvidence(isCourtResultTemplate, lastCourtEnd) ?? communicationEvidence(isCourtResultTemplate, lastCourtEnd, { includeBodyText: true }) : null;
  const postCourtCallDeadline = courtResult?.at ? addHours(courtResult.at, 24) : null;
  const courtReminderDeadline = nextCourt ? previousBusinessDayEnd(nextCourt.at) : null;
  const courtReminderCallWindowStart = nextCourt ? previousBusinessDayStart(nextCourt.at) : null;
  const courtReminderWindowStart = nextCourt ? new Date(nextCourt.at.getTime() - 14 * 24 * 60 * 60 * 1000) : null;
  const courtReminderTemplateEvidence = courtReminderWindowStart
    ? templateCommunicationEvidence(isCourtReminderTemplate, courtReminderWindowStart) ?? communicationEvidence(isCourtReminderTemplate, courtReminderWindowStart, { includeBodyText: true })
    : null;
  const courtReminderCallEvidence = courtReminderCallWindowStart && nextCourt
    ? earliest(
        evidence.communications
          .map((comm): Evidence<ClioCommunication> | null => {
            const at = commDate(comm);
            if (!at || at < courtReminderCallWindowStart || at > nextCourt.at) return null;
            if (!isFirmPhoneCall(comm, record.client_id)) return null;
            return { item: comm, at, source: "Communication", url: evidenceUrl("communications", comm.id) };
          })
          .filter(Boolean) as Evidence<ClioCommunication>[],
      )
    : null;
  const nearbyCourtReminderCallEvidence = courtReminderCallWindowStart && nextCourt
    ? (evidence.communications
        .map((comm): (Evidence<ClioCommunication> & { distance: number }) | null => {
          const at = commDate(comm);
          if (!at || !isFirmPhoneCall(comm, record.client_id)) return null;
          if (at >= courtReminderCallWindowStart && at <= nextCourt.at) return null;
          if (at < startOfLocalDay(addDaysRaw(courtReminderCallWindowStart, -3)) || at > endOfLocalDay(nextCourt.at)) return null;
          const distance = Math.abs(localDateDistanceDays(at, courtReminderDeadline ?? nextCourt.at));
          return { item: comm, at, source: "Communication", url: evidenceUrl("communications", comm.id), distance };
        })
        .filter(Boolean) as Array<Evidence<ClioCommunication> & { distance: number }>)
        .sort((a, b) => a.distance - b.distance || b.at.getTime() - a.at.getTime())[0] ?? null
    : null;
  const courtReminderDeadlinePassed = Boolean(courtReminderDeadline && now > courtReminderDeadline);
  const courtReminderMissingReason = courtReminderTemplateEvidence ? "REMINDER_TEMPLATE_FOUND_CALL_NOT_FOUND" : "CALL_NOT_FOUND_PRE_COURT";
  const courtResultWindowOpen = Boolean(courtResultDeadline && now <= courtResultDeadline);
  const postCourtCallWindowOpen = Boolean(postCourtCallDeadline && now <= postCourtCallDeadline);
  const postCourtCall = courtResult?.at
    ? earliest(
        evidence.calendars
          .map((cal): Evidence<ClioCalendarEntry> | null => {
            const at = parseDate(cal.created_at ?? cal.start_at);
            if (!at || at < courtResult.at) return null;
            if (!isAttorneyCall(calendarSearchText(cal))) return null;
            return { item: cal, at, source: "Calendar", url: evidenceUrl("calendar_entries", cal.id) };
          })
          .filter(Boolean) as Evidence<ClioCalendarEntry>[],
      )
    : null;
  const courtResultItem =
    lastCourtEnd
      ? classify("COURT_RESULTS", courtResult, courtResultDeadline, {
          operationalState: "Not Due Yet",
          unknown: Boolean(!courtResult && !courtResultWindowOpen && (commError || calendarError)),
          reasonCode: commError || calendarError,
          now,
        })
      : nextCourt
        ? base("COURT_RESULTS", "Pending", "Not Due Yet", calendarEnd(nextCourt.item), null)
        : base("COURT_RESULTS", "N/A", "", null, null);
  const postCourtCallItem =
    courtResult && nextCourt
      ? classify("POST_COURT_CALL", postCourtCall, postCourtCallDeadline, {
          operationalState: "Not Due Yet",
          unknown: Boolean(!postCourtCall && !postCourtCallWindowOpen && calendarError),
          reasonCode: calendarError,
          now,
        })
      : lastCourtEnd && !courtResult
        ? base("POST_COURT_CALL", "Pending", "Not Due Yet", courtResultDeadline, null)
        : nextCourt
          ? base("POST_COURT_CALL", "Pending", "Not Due Yet", calendarEnd(nextCourt.item), null)
          : base("POST_COURT_CALL", "N/A", "", null, null);
  const courtReminderItem = (() => {
    if (!nextCourt) return base("COURT_REMINDER_CALL", "N/A", "", null, null);
    if (courtReminderCallEvidence) {
      return classify("COURT_REMINDER_CALL", courtReminderCallEvidence, courtReminderDeadline, {
        operationalState: "Waiting until 5:00 PM Illinois time",
        reasonCode: courtReminderCallEvidence.at > (courtReminderDeadline ?? courtReminderCallEvidence.at) ? "CALL_FOUND_AFTER_REMINDER_GOAL" : null,
        now,
      });
    }
    if (nearbyCourtReminderCallEvidence) {
      return withEvidence(
        base("COURT_REMINDER_CALL", "Late", "Timing Review", courtReminderDeadline, null, "CALL_FOUND_NEARBY_PRE_COURT"),
        nearbyCourtReminderCallEvidence,
      );
    }
    if (!courtReminderDeadlinePassed) return base("COURT_REMINDER_CALL", "Pending", "Not Due Yet", courtReminderDeadline, null);
    return classify("COURT_REMINDER_CALL", null, courtReminderDeadline, {
      operationalState: "Waiting until 5:00 PM Illinois time",
      unknown: Boolean(commError),
      reasonCode: commError || courtReminderMissingReason,
      now,
    });
  })();

  const welcomeWindowStart = new Date(record.matter_created_at.getTime() - 60 * 60 * 1000);
  const welcomeEvidence = templateCommunicationEvidence(isWelcomeTemplate, welcomeWindowStart) ?? communicationEvidence(isWelcomeTemplate, welcomeWindowStart);
  const appearanceWindowStart = new Date(record.matter_created_at.getTime() - 24 * 60 * 60 * 1000);
  const appearanceEvidence =
    templateCommunicationEvidence(isAppearanceTemplate, appearanceWindowStart) ??
    communicationEvidence(isAppearanceTemplate, appearanceWindowStart, { allowUnclearDirection: true, includeBodyText: true });

  const clientContactCommunication = evidence.communications
      .map((comm): Evidence<ClioCommunication> | null => {
        const at = commDate(comm);
        if (!at) return null;
        const direction = isOutbound(comm, record.client_id);
        if (direction !== true) return null;
        return { item: comm, at, source: "Communication", url: evidenceUrl("communications", comm.id) };
      })
      .filter(Boolean) as Evidence<ClioCommunication>[];

  const clientContactCalendar = evidence.calendars
    .map((cal): Evidence<ClioCalendarEntry> | null => {
      const at = parseDate(cal.created_at ?? cal.start_at);
      if (!at) return null;
      const text = calendarSearchText(cal);
      if (!isCalendarEmailContact(text)) return null;
      return { item: cal, at, source: "Calendar", url: evidenceUrl("calendar_entries", cal.id) };
    })
    .filter(Boolean) as Evidence<ClioCalendarEntry>[];

  const clientContact = earliest(
    [...clientContactCommunication, ...clientContactCalendar],
  );

  const unknownDirection = evidence.communications.some((comm) => isOutbound(comm, record.client_id) === null);
  const followUpState = evidence.communications
    .map((comm) => ({ comm, at: commDate(comm), direction: isOutbound(comm, record.client_id) }))
    .filter((entry) => entry.at)
    .sort((a, b) => a.at!.getTime() - b.at!.getTime())
    .reduce(
      (state, entry) => {
        if (entry.direction === false) {
          state.unansweredInboundCount += 1;
          state.firstUnansweredInboundAt ??= entry.at!;
          state.lastInboundAt = entry.at!;
        }
        if (entry.direction === true) {
          state.unansweredInboundCount = 0;
          state.firstUnansweredInboundAt = null;
          state.lastFirmResponseAt = entry.at!;
        }
        return state;
      },
      {
        unansweredInboundCount: 0,
        firstUnansweredInboundAt: null as Date | null,
        lastInboundAt: null as Date | null,
        lastFirmResponseAt: null as Date | null,
      },
    );
  const currentClientFollowUpRisk = followUpState.unansweredInboundCount >= 2;

  const items: AuditItemResult[] = [
    classify("SETUP_WELCOME", welcomeEvidence, setup.twoBusinessHours, {
      correctiveDeadlineAt: setup.twoBusinessHoursCorrective,
      operationalState: "Waiting for Welcome Letter deadline",
      unknown: Boolean(commError),
      reasonCode: commError,
      now,
    }),
    classify("SETUP_ATTY_CALL", attorneyCallEvidence, setup.twoBusinessHours, {
      required: !isPettyTrafficMatter(record),
      correctiveDeadlineAt: setup.twoBusinessHoursCorrective,
      operationalState: "Needs Attorney Call",
      unknown: Boolean(calendarError),
      reasonCode: calendarError,
      now,
    }),
    classify("SETUP_COURT_DATE", courtAdded, setup.twoBusinessHours, {
      correctiveDeadlineAt: setup.twoBusinessHoursCorrective,
      operationalState: "Waiting for Court Date deadline",
      unknown: Boolean(calendarError),
      reasonCode: calendarError,
      now,
    }),
    classify("CLIENT_CONTACT", clientContact, clientDeadline, {
      operationalState: "Needs Client Contact",
      unknown: !clientContact && Boolean(commError || unknownDirection),
      reasonCode: commError || "DIRECTION_UNCLEAR",
      now,
    }),
    classify("APPEARANCE_FILING", appearanceEvidence, appearanceDeadline, {
      operationalState: "Waiting for 48-hour review window",
      unknown: Boolean(commError && now > appearanceDeadline),
      reasonCode: commError,
      now,
    }),
    courtResultItem,
    postCourtCallItem,
    courtReminderItem,
    commError
      ? base("CLIENT_FOLLOWUP", "Unknown", "Unknown", null, null, commError)
      : currentClientFollowUpRisk
      ? base(
          "CLIENT_FOLLOWUP",
          "Missing",
          "Client Follow-Up Risk",
          followUpState.firstUnansweredInboundAt,
          null,
          "CURRENT_UNANSWERED_CLIENT_MESSAGES",
        )
      : base("CLIENT_FOLLOWUP", unknownDirection ? "Unknown" : "On Time", unknownDirection ? "Unknown" : "No Risk", null, null, unknownDirection ? "DIRECTION_UNCLEAR" : null),
    weeklyCheckInItem,
  ];

  return {
    items,
    overallStatus: overall(items),
    court: { last: lastCourt?.at ?? null, next: nextCourt?.at ?? null },
  };
}

export async function auditNextBatch(
  client = new ClioClient(),
  options: { discover?: boolean; batchSize?: number; discoverLookbackDays?: number; selection?: "priority" | "recent"; filters?: AuditBatchFilters; maxRunMs?: number } = {},
): Promise<{ audited: number; discovered: number; remainingUnchecked: number; message: string }> {
  await initDb();
  await pruneExpiredStoredData();
  const sql = db();
  const config = appConfig();
  if (config.auditCooldownSeconds > 0) {
    const cooldownRows = await sql`
      select greatest(
        0,
        ceil(extract(epoch from (max(started_at) + (${config.auditCooldownSeconds}::int * interval '1 second') - now())))
      )::int as wait_seconds
      from audit_run
      where started_at > now() - (${config.auditCooldownSeconds}::int * interval '1 second')
    `;
    const waitSeconds = Number(cooldownRows[0]?.wait_seconds ?? 0);
    if (waitSeconds > 0) {
      await sleep(waitSeconds * 1000);
    }
  }
  const runRows = await sql`insert into audit_run(status, app_version) values ('running', ${APP_VERSION}) returning id`;
  const runId = runRows[0].id;
  let discovered = 0;
  let audited = 0;
  const startedAt = Date.now();
  try {
    const existingRows = await sql`select count(*)::int as count from audit_matter`;
    const needsDiscovery = Number(existingRows[0]?.count ?? 0) === 0;
    if (options.discover ?? needsDiscovery) {
      discovered = await discoverMatters(client, options.discoverLookbackDays);
    }
    const batchSize = options.batchSize ?? config.auditBatchSize;
    const fromDate = parseDate(options.filters?.from);
    const toDate = parseDate(options.filters?.to ? `${options.filters.to}T23:59:59` : undefined);
    const batchConditions = [
      sql`lower(coalesce(m.matter_status, '')) <> 'closed'`,
      options.filters?.attorney ? sql`m.responsible_attorney_id = ${options.filters.attorney}` : sql`true`,
      fromDate ? sql`m.matter_created_at >= ${fromDate}` : sql`true`,
      toDate ? sql`m.matter_created_at < ${toDate}` : sql`true`,
    ];
    const matters =
      options.selection === "recent"
        ? await sql<MatterRecord[]>`
            select m.*
            from audit_matter m
            where ${batchConditions[0]} and ${batchConditions[1]} and ${batchConditions[2]} and ${batchConditions[3]}
            order by
              case
                when not exists (
                  select 1
                  from audit_item ai_unchecked
                  where ai_unchecked.matter_id = m.matter_id
                ) then 0
                when not exists (
                  select 1
                  from audit_item ai_missing_weekly
                  where ai_missing_weekly.matter_id = m.matter_id
                    and ai_missing_weekly.step_code = 'WEEKLY_CLIENT_CHECKIN'
                ) then 0
                when exists (
                  select 1
                  from audit_item ai_stale_appearance
                  where ai_stale_appearance.matter_id = m.matter_id
                    and ai_stale_appearance.step_code = 'APPEARANCE_FILING'
                    and ai_stale_appearance.status = 'Unknown'
                    and ai_stale_appearance.reason_code = 'EVIDENCE_NOT_CONFIRMED'
                ) then 1
                when exists (
                  select 1
                  from audit_item ai
                  where ai.matter_id = m.matter_id
                    and (
                      ai.reason_code like 'NOTES_400:%'
                      or (ai.status = 'Unknown' and ai.reason_code in ('API_ERROR', 'MATTER_ERROR: API_ERROR'))
                    )
                ) then 1
                else 2
              end,
              m.last_audited_at nulls first,
              m.matter_created_at desc
            limit ${batchSize}
          `
        : await sql<MatterRecord[]>`
            select m.*
            from audit_matter m
            where ${batchConditions[0]} and ${batchConditions[1]} and ${batchConditions[2]} and ${batchConditions[3]}
            order by
              case
                when not exists (
                  select 1
                  from audit_item ai_unchecked
                  where ai_unchecked.matter_id = m.matter_id
                ) then 0
                when not exists (
                  select 1
                  from audit_item ai_missing_weekly
                  where ai_missing_weekly.matter_id = m.matter_id
                    and ai_missing_weekly.step_code = 'WEEKLY_CLIENT_CHECKIN'
                ) then 0
                when exists (
                  select 1
                  from audit_item ai_stale_appearance
                  where ai_stale_appearance.matter_id = m.matter_id
                    and ai_stale_appearance.step_code = 'APPEARANCE_FILING'
                    and ai_stale_appearance.status = 'Unknown'
                    and ai_stale_appearance.reason_code = 'EVIDENCE_NOT_CONFIRMED'
                ) then 1
                when exists (
                  select 1
                  from audit_item ai
                  where ai.matter_id = m.matter_id
                    and (
                      ai.reason_code like 'NOTES_400:%'
                      or (ai.status = 'Unknown' and ai.reason_code in ('API_ERROR', 'MATTER_ERROR: API_ERROR'))
                    )
                ) then 1
                else 2
              end,
              case m.overall_status when 'Review' then 1 when 'Flag' then 2 when 'Pending' then 3 else 4 end,
              m.last_audited_at nulls first,
              m.matter_created_at desc
            limit ${batchSize}
          `;
    for (const matter of matters) {
      if (options.maxRunMs && audited > 0 && Date.now() - startedAt > options.maxRunMs) {
        break;
      }
      try {
        const evidence = await fetchEvidence(client, matter);
        const result = auditMatter(matter, evidence);
        await upsertItems(matter.matter_id, result.items, result.overallStatus, result.court);
        audited += 1;
      } catch (error) {
        const status = apiReason(error, "matter");
        const items = AUDIT_STEP_CODES.map((step) => base(step, "Unknown", "Unknown", null, null, status));
        await upsertItems(matter.matter_id, items, "Review", { last: null, next: null });
        audited += 1;
      }
    }
    await rebuildMonthlySnapshots();
    await pruneExpiredStoredData();
    const remainingRows = await sql`
      select count(*)::int as count
      from audit_matter m
      where ${batchConditions[0]} and ${batchConditions[1]} and ${batchConditions[2]} and ${batchConditions[3]}
        and (
          not exists (
            select 1
            from audit_item i
            where i.matter_id = m.matter_id
          )
          or not exists (
            select 1
            from audit_item weekly_item
            where weekly_item.matter_id = m.matter_id
              and weekly_item.step_code = 'WEEKLY_CLIENT_CHECKIN'
          )
        )
    `;
    const remainingUnchecked = Number(remainingRows[0]?.count ?? 0);
    const batchesLeft = Math.ceil(remainingUnchecked / Math.max(1, batchSize));
    const batchLabel = batchesLeft === 1 ? "time" : "times";
    const matterLabel = remainingUnchecked === 1 ? "matter" : "matters";
    const nextStep = remainingUnchecked > 0
      ? `${remainingUnchecked} ${matterLabel} still need an audit. Click Run Audit Batch about ${batchesLeft} more ${batchLabel}.`
      : "All discovered matters in this view have been audited.";
    const message = `Audited ${audited} more matters. ${nextStep} Found/updated ${discovered} Clio matters.`;
    await sql`update audit_run set finished_at = now(), status = 'completed', matters_discovered = ${discovered}, matters_audited = ${audited}, message = ${message} where id = ${runId}`;
    return { audited, discovered, remainingUnchecked, message };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`update audit_run set finished_at = now(), status = 'failed', matters_discovered = ${discovered}, matters_audited = ${audited}, message = ${message} where id = ${runId}`;
    throw error;
  }
}

export async function auditOneMatterById(client = new ClioClient(), matterId: string): Promise<{ audited: number; discovered: number; remainingUnchecked: number; message: string }> {
  await initDb();
  await pruneExpiredStoredData();
  const sql = db();
  const rows = await sql<MatterRecord[]>`
    select *
    from audit_matter
    where matter_id = ${matterId}
    limit 1
  `;
  const matter = rows[0];
  if (!matter) throw new Error("Matter was not found in the audit database. Run Audit Batch first.");

  try {
    const evidence = await fetchEvidence(client, matter);
    const result = auditMatter(matter, evidence);
    await upsertItems(matter.matter_id, result.items, result.overallStatus, result.court);
  } catch (error) {
    const status = apiReason(error, "matter");
    const items = AUDIT_STEP_CODES.map((step) => base(step, "Unknown", "Unknown", null, null, status));
    await upsertItems(matter.matter_id, items, "Review", { last: null, next: null });
    throw error;
  }

  await rebuildMonthlySnapshots();
  await pruneExpiredStoredData();
  const remainingRows = await sql`
    select count(*)::int as count
    from audit_matter m
    where lower(coalesce(m.matter_status, '')) <> 'closed'
      and (
        not exists (
          select 1
          from audit_item i
          where i.matter_id = m.matter_id
        )
        or not exists (
          select 1
          from audit_item weekly_item
          where weekly_item.matter_id = m.matter_id
            and weekly_item.step_code = 'WEEKLY_CLIENT_CHECKIN'
        )
      )
  `;
  const name = `${matter.client_first_name} ${matter.client_last_name}`.trim() || matter.matter_number;
  return { audited: 1, discovered: 0, remainingUnchecked: Number(remainingRows[0]?.count ?? 0), message: `Rechecked ${name}.` };
}

export async function rebuildMonthlySnapshots() {
  const sql = db();
  await sql`delete from audit_metric_snapshot where period_type = 'month' and period_start = date_trunc('month', now())::date`;
  await sql`
    insert into audit_metric_snapshot (
      period_start, period_end, period_type, responsible_attorney_id, responsible_attorney_name,
      matters_checked, pass_count, late_count, flag_count, review_count,
      missing_item_count, late_item_count, unknown_item_count,
      welcome_packets_sent, appearance_filings_sent, court_result_emails_sent, attorney_calls_scheduled
    )
    select
      date_trunc('month', now())::date,
      (date_trunc('month', now()) + interval '1 month - 1 day')::date,
      'month',
      m.responsible_attorney_id,
      m.responsible_attorney_name,
      count(distinct m.matter_id) filter (where exists (select 1 from audit_item checked where checked.matter_id = m.matter_id))::int,
      count(distinct m.matter_id) filter (where m.overall_status = 'Pass' and exists (select 1 from audit_item checked where checked.matter_id = m.matter_id))::int,
      count(distinct m.matter_id) filter (where m.overall_status = 'Late' and exists (select 1 from audit_item checked where checked.matter_id = m.matter_id))::int,
      count(distinct m.matter_id) filter (where m.overall_status = 'Flag' and exists (select 1 from audit_item checked where checked.matter_id = m.matter_id))::int,
      count(distinct m.matter_id) filter (where m.overall_status = 'Review' and exists (select 1 from audit_item checked where checked.matter_id = m.matter_id))::int,
      count(i.*) filter (where i.status = 'Missing')::int,
      count(i.*) filter (where i.status = 'Late')::int,
      count(i.*) filter (where i.status = 'Unknown')::int,
      count(i.*) filter (where i.step_code = 'SETUP_WELCOME' and i.evidence_ref_id is not null)::int,
      count(i.*) filter (where i.step_code = 'APPEARANCE_FILING' and i.evidence_ref_id is not null)::int,
      count(i.*) filter (where i.step_code = 'COURT_RESULTS' and i.evidence_ref_id is not null)::int,
      count(i.*) filter (where i.step_code = 'SETUP_ATTY_CALL' and i.evidence_ref_id is not null)::int
    from audit_matter m
    left join audit_item i on i.matter_id = m.matter_id
    where m.matter_created_at >= date_trunc('month', now())
      and lower(coalesce(m.matter_status, '')) <> 'closed'
      and not exists (
        select 1
        from audit_item stale
        where stale.matter_id = m.matter_id
          and stale.status = 'Unknown'
          and stale.reason_code in ('API_ERROR', 'MATTER_ERROR: API_ERROR')
        group by stale.matter_id
        having count(*) >= 3
      )
      and not exists (
        select 1
        from audit_item stale_notes
        where stale_notes.matter_id = m.matter_id
          and stale_notes.reason_code like 'NOTES_400:%'
      )
    group by m.responsible_attorney_id, m.responsible_attorney_name
  `;
}
