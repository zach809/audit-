import { addBusinessDaysDeadline, effectiveIntake, setupDeadlines } from "./business-time";
import { ClioApiError, ClioClient } from "./clio";
import { db, initDb, pruneExpiredStoredData } from "./db";
import {
  haystack,
  isAppearanceTemplate,
  isAttorneyCall,
  isCourtEvent,
  isCourtResultTemplate,
  isPossibleCourtEvent,
  isWelcomeTemplate,
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

function commDate(comm: ClioCommunication): Date | null {
  return parseDate(comm.date ?? comm.created_at ?? comm.received_at);
}

function isOutbound(comm: ClioCommunication, clientId: string | null): boolean | null {
  if (comm.user?.id) return true;
  const receivers = comm.receivers ?? [];
  const senders = comm.senders ?? [];
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

function isPettyTrafficMatter(record: MatterRecord): boolean {
  return haystack(record.matter_number).includes("petty traffic");
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
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
    const stillPending = corrective && now <= corrective;
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
    ...base(stepCode, status, status, deadlineAt, options.correctiveDeadlineAt ?? null),
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

function evidenceUrl(type: "communications" | "calendar_entries", id: number): string {
  return `/evidence/${type}/${id}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveMatter(matter: ClioMatter): Promise<MatterRecord> {
  const created = new Date(matter.created_at);
  const effective = effectiveIntake(created);
  const clientName = matter.client?.name ?? "";
  const splitName = clientName.split(" ");
  const first = matter.client?.first_name ?? splitName[0] ?? "";
  const last = matter.client?.last_name ?? splitName.slice(1).join(" ") ?? "";
  const record = {
    matter_id: String(matter.id),
    matter_number: matterNumber(matter),
    matter_status: matter.status ?? "",
    client_id: matter.client?.id ? String(matter.client.id) : null,
    client_first_name: first,
    client_last_name: last,
    responsible_attorney_id: matter.responsible_attorney?.id ? String(matter.responsible_attorney.id) : null,
    responsible_attorney_name: matter.responsible_attorney?.name ?? "",
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
        evidence_at, evidence_source, evidence_ref_id, evidence_url, reason_code, last_evaluated_at
      )
      values (
        ${matterId}, ${item.stepCode}, ${item.status}, ${item.operationalState},
        ${item.deadlineAt}, ${item.correctiveDeadlineAt}, ${item.evidenceAt},
        ${item.evidenceSource}, ${item.evidenceRefId}, ${item.evidenceUrl},
        ${item.reasonCode}, now()
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
  const fields = "id,number,display_number,status,created_at,responsible_attorney{id,name},client{id,first_name,last_name,name}";
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
  const since = matter.effective_intake_at.toISOString();
  const to = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
  const [communicationsResult, calendarsResult] = await Promise.allSettled([
    client.list<ClioCommunication>("/communications.json", {
      fields: "id,subject,type,date,created_at,received_at,matter{id},user{id,name},senders{id,name},receivers{id,name}",
      matter_id: matter.matter_id,
      created_since: since,
    }),
    client.list<ClioCalendarEntry>("/calendar_entries.json", {
      fields: "id,summary,description,start_at,end_at,created_at,all_day,matter{id},calendar_owner{id,name},calendar_entry_event_type{id,name}",
      matter_id: matter.matter_id,
      from: since,
      to,
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
  const appearanceDeadline = addBusinessDaysDeadline(record.effective_intake_at, 2);
  const commError = evidence.errors.communications;
  const calendarError = evidence.errors.calendars;

  const communicationEvidence = (matcher: (text: string) => boolean, deadlineWindowStart?: Date) =>
    earliest(
      evidence.communications
        .map((comm): Evidence<ClioCommunication> | null => {
          const at = commDate(comm);
          if (!at || (deadlineWindowStart && at < deadlineWindowStart)) return null;
          const text = haystack(comm.subject, comm.type);
          if (!matcher(text)) return null;
          const direction = isOutbound(comm, record.client_id);
          if (direction !== true) return null;
          return { item: comm, at, source: "Communication", url: evidenceUrl("communications", comm.id) };
        })
        .filter(Boolean) as Evidence<ClioCommunication>[],
    );

  const callEvidence = earliest(
    evidence.calendars
      .map((cal): Evidence<ClioCalendarEntry> | null => {
        const at = parseDate(cal.created_at ?? cal.start_at);
        if (!at) return null;
        if (!isAttorneyCall(haystack(cal.summary, cal.description, cal.calendar_entry_event_type?.name))) return null;
        return { item: cal, at, source: "Calendar", url: evidenceUrl("calendar_entries", cal.id) };
      })
      .filter(Boolean) as Evidence<ClioCalendarEntry>[],
  );

  const courtEvents = evidence.calendars
    .map((cal): Evidence<ClioCalendarEntry> | null => {
      const at = parseDate(cal.start_at);
      if (!at) return null;
      const text = haystack(cal.summary, cal.description, cal.calendar_entry_event_type?.name);
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
  const courtResult = lastCourtEnd ? communicationEvidence(isCourtResultTemplate, lastCourtEnd) : null;
  const postCourtCallDeadline = courtResult?.at ? addHours(courtResult.at, 24) : null;
  const courtResultWindowOpen = Boolean(courtResultDeadline && now <= courtResultDeadline);
  const postCourtCallWindowOpen = Boolean(postCourtCallDeadline && now <= postCourtCallDeadline);
  const postCourtCall = courtResult?.at
    ? earliest(
        evidence.calendars
          .map((cal): Evidence<ClioCalendarEntry> | null => {
            const at = parseDate(cal.created_at ?? cal.start_at);
            if (!at || at < courtResult.at) return null;
            if (!isAttorneyCall(haystack(cal.summary, cal.description, cal.calendar_entry_event_type?.name))) return null;
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

  const clientContact = earliest(
    evidence.communications
      .map((comm): Evidence<ClioCommunication> | null => {
        const at = commDate(comm);
        if (!at) return null;
        const direction = isOutbound(comm, record.client_id);
        if (direction !== true) return null;
        return { item: comm, at, source: "Communication", url: evidenceUrl("communications", comm.id) };
      })
      .filter(Boolean) as Evidence<ClioCommunication>[],
  );

  const unknownDirection = evidence.communications.some((comm) => isOutbound(comm, record.client_id) === null);
  const inboundStreak = evidence.communications
    .map((comm) => ({ comm, at: commDate(comm), direction: isOutbound(comm, record.client_id) }))
    .filter((entry) => entry.at)
    .sort((a, b) => a.at!.getTime() - b.at!.getTime())
    .reduce(
      (state, entry) => {
        if (entry.direction === false) state.streak += 1;
        if (entry.direction === true) state.streak = 0;
        state.max = Math.max(state.max, state.streak);
        return state;
      },
      { streak: 0, max: 0 },
    );

  const items: AuditItemResult[] = [
    classify("SETUP_WELCOME", communicationEvidence(isWelcomeTemplate), setup.onTime, {
      correctiveDeadlineAt: setup.corrective,
      operationalState: "Needs Welcome Packet",
      unknown: Boolean(commError),
      reasonCode: commError,
      missingAsReview: true,
      now,
    }),
    classify("SETUP_ATTY_CALL", callEvidence, setup.onTime, {
      required: !isPettyTrafficMatter(record),
      correctiveDeadlineAt: setup.corrective,
      operationalState: "Needs Attorney Call",
      unknown: Boolean(calendarError),
      reasonCode: calendarError,
      now,
    }),
    classify("SETUP_COURT_DATE", courtAdded, setup.onTime, {
      correctiveDeadlineAt: setup.corrective,
      operationalState: "Needs Court Date",
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
    classify("APPEARANCE_FILING", communicationEvidence(isAppearanceTemplate), appearanceDeadline, {
      operationalState: "Needs Appearance Filing",
      unknown: Boolean(commError),
      reasonCode: commError,
      missingAsReview: true,
      now,
    }),
    courtResultItem,
    postCourtCallItem,
    commError
      ? base("CLIENT_FOLLOWUP", "Unknown", "Unknown", null, null, commError)
      : inboundStreak.max >= 2
      ? base("CLIENT_FOLLOWUP", "Missing", "Client Follow-Up Risk", null, null, "TWO_INBOUND_BEFORE_RESPONSE")
      : base("CLIENT_FOLLOWUP", unknownDirection ? "Unknown" : "On Time", unknownDirection ? "Unknown" : "No Risk", null, null, unknownDirection ? "DIRECTION_UNCLEAR" : null),
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
  const runRows = await sql`insert into audit_run(status) values ('running') returning id`;
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
        const items: AuditItemResult[] = [
          "SETUP_WELCOME",
          "SETUP_ATTY_CALL",
          "SETUP_COURT_DATE",
          "CLIENT_CONTACT",
          "APPEARANCE_FILING",
          "COURT_RESULTS",
          "POST_COURT_CALL",
          "CLIENT_FOLLOWUP",
        ].map((step) => base(step as StepCode, "Unknown", "Unknown", null, null, status));
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
        and not exists (
          select 1
          from audit_item i
          where i.matter_id = m.matter_id
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
    const items: AuditItemResult[] = [
      "SETUP_WELCOME",
      "SETUP_ATTY_CALL",
      "SETUP_COURT_DATE",
      "CLIENT_CONTACT",
      "APPEARANCE_FILING",
      "COURT_RESULTS",
      "POST_COURT_CALL",
      "CLIENT_FOLLOWUP",
    ].map((step) => base(step as StepCode, "Unknown", "Unknown", null, null, status));
    await upsertItems(matter.matter_id, items, "Review", { last: null, next: null });
    throw error;
  }

  await rebuildMonthlySnapshots();
  await pruneExpiredStoredData();
  const remainingRows = await sql`
    select count(*)::int as count
    from audit_matter m
    where lower(coalesce(m.matter_status, '')) <> 'closed'
      and not exists (
        select 1
        from audit_item i
        where i.matter_id = m.matter_id
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
