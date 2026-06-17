import { isBusinessDay, localParts, zonedDateTimeToUtc } from "./business-time";
import { ClioClient } from "./clio";
import { db, initDb } from "./db";
import type { ClioMatter } from "./types";

export const POST_CLOSURE_TOUCHPOINTS = [
  { months: 1, label: "1 Month" },
  { months: 6, label: "6 Months" },
  { months: 12, label: "12 Months" },
] as const;

export const POST_CLOSURE_REVIEW_STATUSES = [
  "In Progress",
  "Completed",
  "Unable to Reach",
  "No Action Needed",
  "Issue Found",
] as const;

export const POST_CLOSURE_CONTACT_METHODS = ["Phone", "Email", "Text", "Other"] as const;

export const POST_CLOSURE_ISSUE_TYPES = [
  "None",
  "Client satisfaction concern",
  "Billing or unpaid fee issue",
  "Missing document or question",
  "New legal concern",
  "Compliance or supervision concern",
  "Other",
] as const;

export type PostClosureFollowUpRow = {
  matter_id: string;
  touchpoint_months: number;
  touchpoint_label: string;
  matter_number: string;
  client_first_name: string;
  client_last_name: string;
  responsible_attorney_name: string;
  matter_closed_at: string | Date;
  due_at: string | Date;
  review_status: string;
  display_status: string;
  contact_method: string;
  issue_type: string;
  followup_note: string;
  reviewed_by: string;
  completed_at: string | Date | null;
  updated_at: string | Date;
};

export type PostClosureSummary = {
  total: number;
  due_now: number;
  overdue: number;
  upcoming: number;
  in_progress: number;
  issue_found: number;
  completed: number;
};

export type PostClosureFilters = {
  status?: string;
  stage?: string;
};

type ClosedMatter = ClioMatter & {
  close_date?: string | null;
};

function cleanText(value: unknown, max = 500): string {
  return String(value ?? "").trim().slice(0, max);
}

function matterNumber(matter: ClioMatter): string {
  return matter.display_number ?? String(matter.number ?? matter.id);
}

function parseClioCloseDate(value?: string | null): Date | null {
  if (!value) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return zonedDateTimeToUtc(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]), 17);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function nextBusinessMorning(date: Date): Date {
  let parts = localParts(date);
  let candidate = zonedDateTimeToUtc(parts.year, parts.month, parts.day, 9);
  while (!isBusinessDay(candidate)) {
    parts = localParts(candidate);
    candidate = zonedDateTimeToUtc(parts.year, parts.month, parts.day + 1, 9);
  }
  return candidate;
}

function addCalendarMonthsDueDate(date: Date, months: number): Date {
  const parts = localParts(date);
  const monthIndex = parts.month - 1 + months;
  const year = parts.year + Math.floor(monthIndex / 12);
  const month = ((monthIndex % 12) + 12) % 12 + 1;
  const day = Math.min(parts.day, daysInMonth(year, month));
  return nextBusinessMorning(zonedDateTimeToUtc(year, month, day, 9));
}

function computedStatusSql() {
  const sql = db();
  return sql`
    case
      when review_status in ('Completed', 'Unable to Reach', 'No Action Needed') then review_status
      when review_status = 'Issue Found' then 'Issue Found'
      when review_status = 'In Progress' then 'In Progress'
      when due_at > now() then 'Not Due Yet'
      when due_at < now() - interval '7 days' then 'Overdue'
      else 'Due Now'
    end
  `;
}

async function listClosedMatterCandidates(client: ClioClient, since: Date): Promise<ClosedMatter[]> {
  const fields = "id,number,display_number,status,created_at,updated_at,close_date,responsible_attorney{id,name},client{id,first_name,last_name,name}";
  const attempts = [
    { fields, status: "closed", updated_since: since.toISOString() },
    { fields, status: "Closed", updated_since: since.toISOString() },
    { fields, updated_since: since.toISOString() },
    { fields, status: "closed", created_since: since.toISOString() },
    { fields, created_since: since.toISOString() },
  ];
  let lastError: unknown;
  for (const query of attempts) {
    try {
      const matters = await client.list<ClosedMatter>("/matters.json", query);
      return matters.filter((matter) => String(matter.status ?? "").toLowerCase() === "closed");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not read closed matters from Clio.");
}

export async function syncPostClosureFollowups(
  client = new ClioClient(),
  lookbackDays = 395,
): Promise<{ syncedMatters: number; remindersCreated: number; skippedWithoutCloseDate: number }> {
  await initDb();
  const sql = db();
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const matters = await listClosedMatterCandidates(client, since);
  let syncedMatters = 0;
  let remindersCreated = 0;
  let skippedWithoutCloseDate = 0;

  for (const matter of matters) {
    const closedAt = parseClioCloseDate(matter.close_date);
    if (!closedAt) {
      skippedWithoutCloseDate += 1;
      continue;
    }

    const clientName = matter.client?.name ?? "";
    const splitName = clientName.split(" ");
    const first = matter.client?.first_name ?? splitName[0] ?? "";
    const last = matter.client?.last_name ?? splitName.slice(1).join(" ") ?? "";
    syncedMatters += 1;

    for (const touchpoint of POST_CLOSURE_TOUCHPOINTS) {
      const dueAt = addCalendarMonthsDueDate(closedAt, touchpoint.months);
      await sql`
        insert into post_closure_followup (
          matter_id, touchpoint_months, touchpoint_label, matter_number,
          client_first_name, client_last_name, responsible_attorney_name,
          matter_closed_at, due_at, last_synced_at, updated_at
        )
        values (
          ${String(matter.id)}, ${touchpoint.months}, ${touchpoint.label}, ${matterNumber(matter)},
          ${first}, ${last}, ${matter.responsible_attorney?.name ?? ""},
          ${closedAt}, ${dueAt}, now(), now()
        )
        on conflict (matter_id, touchpoint_months) do update set
          touchpoint_label = excluded.touchpoint_label,
          matter_number = excluded.matter_number,
          client_first_name = excluded.client_first_name,
          client_last_name = excluded.client_last_name,
          responsible_attorney_name = excluded.responsible_attorney_name,
          matter_closed_at = excluded.matter_closed_at,
          due_at = excluded.due_at,
          last_synced_at = now(),
          updated_at = now()
      `;
      remindersCreated += 1;
    }
  }

  await sql`
    insert into audit_state(key, value, updated_at)
    values ('post_closure_last_sync', ${new Date().toISOString()}, now())
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;

  return { syncedMatters, remindersCreated, skippedWithoutCloseDate };
}

export async function getPostClosureData(filters: PostClosureFilters = {}): Promise<{
  rows: PostClosureFollowUpRow[];
  summary: PostClosureSummary;
  lastSync: string | null;
}> {
  await initDb();
  const sql = db();
  const displayStatus = computedStatusSql();
  const stage = Number(filters.stage);
  const stageCondition = Number.isFinite(stage) && stage > 0 ? sql`touchpoint_months = ${stage}` : sql`true`;
  const status = filters.status || "due";
  const statusCondition =
    status === "all"
      ? sql`true`
      : status === "upcoming"
        ? sql`display_status = 'Not Due Yet'`
        : status === "completed"
          ? sql`display_status in ('Completed', 'Unable to Reach', 'No Action Needed')`
          : status === "issues"
            ? sql`display_status = 'Issue Found'`
            : sql`display_status in ('Due Now', 'Overdue', 'In Progress', 'Issue Found')`;

  const rows = await sql<PostClosureFollowUpRow[]>`
    select *
    from (
      select
        *,
        ${displayStatus} as display_status
      from post_closure_followup
    ) followups
    where ${stageCondition}
      and ${statusCondition}
    order by
      case display_status
        when 'Overdue' then 1
        when 'Due Now' then 2
        when 'Issue Found' then 3
        when 'In Progress' then 4
        when 'Not Due Yet' then 5
        else 6
      end,
      due_at asc,
      client_last_name,
      client_first_name,
      touchpoint_months
    limit 300
  `;

  const summaryRows = await sql<PostClosureSummary[]>`
    select
      count(*)::int as total,
      count(*) filter (where display_status = 'Due Now')::int as due_now,
      count(*) filter (where display_status = 'Overdue')::int as overdue,
      count(*) filter (where display_status = 'Not Due Yet')::int as upcoming,
      count(*) filter (where display_status = 'In Progress')::int as in_progress,
      count(*) filter (where display_status = 'Issue Found')::int as issue_found,
      count(*) filter (where display_status in ('Completed', 'Unable to Reach', 'No Action Needed'))::int as completed
    from (
      select ${displayStatus} as display_status
      from post_closure_followup
    ) followups
  `;

  const syncRows = await sql`
    select value
    from audit_state
    where key = 'post_closure_last_sync'
    limit 1
  `;

  return {
    rows,
    summary: summaryRows[0] ?? { total: 0, due_now: 0, overdue: 0, upcoming: 0, in_progress: 0, issue_found: 0, completed: 0 },
    lastSync: syncRows[0]?.value ?? null,
  };
}

export async function savePostClosureFollowup(input: {
  matterId: unknown;
  touchpointMonths: unknown;
  reviewStatus: unknown;
  contactMethod?: unknown;
  issueType?: unknown;
  followupNote?: unknown;
  reviewedBy?: unknown;
}): Promise<PostClosureFollowUpRow> {
  await initDb();
  const sql = db();
  const matterId = cleanText(input.matterId, 80);
  const touchpointMonths = Number(input.touchpointMonths);
  const reviewStatus = cleanText(input.reviewStatus, 80);
  const validStatuses = new Set<string>(POST_CLOSURE_REVIEW_STATUSES);
  if (!matterId || !Number.isFinite(touchpointMonths)) throw new Error("Matter or follow-up stage was not provided.");
  if (!validStatuses.has(reviewStatus)) throw new Error("Choose a valid follow-up status.");

  const completedStatuses = new Set(["Completed", "Unable to Reach", "No Action Needed"]);
  const rows = await sql<PostClosureFollowUpRow[]>`
    update post_closure_followup
    set review_status = ${reviewStatus},
        contact_method = ${cleanText(input.contactMethod, 80)},
        issue_type = ${cleanText(input.issueType, 120)},
        followup_note = ${cleanText(input.followupNote, 1200)},
        reviewed_by = ${cleanText(input.reviewedBy, 120)},
        completed_at = case when ${completedStatuses.has(reviewStatus)} then now() else null end,
        updated_at = now()
    where matter_id = ${matterId}
      and touchpoint_months = ${touchpointMonths}
    returning *, ${computedStatusSql()} as display_status
  `;
  if (!rows[0]) throw new Error("Follow-up reminder was not found. Refresh closed matters first.");
  return rows[0];
}
