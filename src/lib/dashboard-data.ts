import { APP_TZ } from "./config";
import { initDb, db } from "./db";
import { workflowLabel } from "./workflow-rules";
import { actionFor, displayAuditStatus, priorityFor, timingGoalFor, whyFlagged } from "./audit-display";
import { reviewResult } from "./review-shared";
import { APP_VERSION } from "./version";
import { buildStandardsScorecard } from "./standards-scorecard";

export const MATTER_SORTS = ["date", "attorney", "case_manager", "compliance"] as const;
export type MatterSort = (typeof MATTER_SORTS)[number];
export type MatterDir = "asc" | "desc";

export const DEFAULT_MATTER_PAGE_SIZE = 25;
export const EXPORT_MATTER_PAGE_SIZE = 10_000;

export type DashboardFilters = {
  attorney?: string;
  overall?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: string;
};

export function parseMatterPage(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") return 1;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}

export function parseMatterSort(value: unknown): MatterSort {
  if (value === "date" || value === "attorney" || value === "case_manager" || value === "compliance") return value;
  return "compliance";
}

export function parseMatterDir(value: unknown): MatterDir {
  return value === "asc" ? "asc" : "desc";
}

function matterPageSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return DEFAULT_MATTER_PAGE_SIZE;
  return Math.min(value, EXPORT_MATTER_PAGE_SIZE);
}

type ActionCsvRow = {
  matter_id: string;
  matter_number: string;
  client_first_name: string | null;
  client_last_name: string | null;
  responsible_attorney_name: string | null;
  matter_created_at: string | Date | null;
  overall_status: string;
  step_code: string;
  item_status: string;
  deadline_at: string | Date | null;
  evidence_at: string | Date | null;
  evidence_source: string | null;
  evidence_ref_id: string | null;
  reason_code: string | null;
  audit_version: string | null;
  review_decision: string | null;
  review_note: string | null;
  case_manager_name: string | null;
  proof_type: string | null;
  proof_reference: string | null;
  next_step: string | null;
  report_summary: string | null;
  internal_notes: string | null;
  include_in_report: boolean | null;
  reviewed_by: string | null;
  review_completed_at: string | Date | null;
  review_updated_at: string | Date | null;
  review_history: unknown;
};

export type LogicIssueRow = {
  matter_id: string;
  matter_number: string;
  client_first_name: string | null;
  client_last_name: string | null;
  responsible_attorney_name: string | null;
  matter_status: string | null;
  step_code: string;
  item_status: string;
  operational_state: string | null;
  deadline_at: string | Date | null;
  evidence_at: string | Date | null;
  evidence_source: string | null;
  evidence_ref_id: string | null;
  reason_code: string | null;
  audit_version: string | null;
  last_evaluated_at: string | Date | null;
  review_decision: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  review_updated_at: string | Date | null;
};

export type WorkspaceAuditItem = {
  matter_id: string;
  matter_number: string;
  client_first_name: string | null;
  client_last_name: string | null;
  matter_created_at: string | Date | null;
  responsible_attorney_id: string | null;
  responsible_attorney_name: string | null;
  step_code: string;
  item_status: string;
  deadline_at: string | Date | null;
  evidence_at: string | Date | null;
  evidence_source: string | null;
  evidence_ref_id: string | null;
  evidence_url: string | null;
  reason_code: string | null;
  audit_version: string | null;
  review_decision: string | null;
  review_note: string | null;
  case_manager_name: string | null;
  proof_type: string | null;
  proof_reference: string | null;
  next_step: string | null;
  report_summary: string | null;
  internal_notes: string | null;
  include_in_report: boolean | null;
  reviewed_by: string | null;
  review_completed_at: string | Date | null;
  review_updated_at: string | Date | null;
  review_history: unknown;
  metric_excluded: boolean | null;
  metric_exclusion_requested_by: string | null;
  metric_exclusion_reason: string | null;
  metric_exclusion_updated_at: string | Date | null;
};

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function humanStatus(status: string): string {
  return displayAuditStatus(status);
}

function formatCsvDate(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function proofPath(origin: string, source?: string | null, refId?: string | null): string {
  if (!refId || !source) return "";
  if (source === "Communication") return `${origin}/evidence/communications/${refId}`;
  if (source === "Calendar") return `${origin}/evidence/calendar_entries/${refId}`;
  return "";
}

function clioMatterLink(matterId: string): string {
  const baseUrl = process.env.CLIO_BASE_URL || "https://app.clio.com";
  return `${baseUrl.replace(/\/$/, "")}/nc/#/matters/${encodeURIComponent(matterId)}`;
}

export function logicIssueType(row: LogicIssueRow): string {
  const reason = String(row.reason_code ?? "");
  if (reason.includes("_ERROR") || reason.includes("ERROR:")) return "API or connection error";
  if (reason.startsWith("NOTES_400:")) return "Clio notes access issue";
  if (reason === "EVIDENCE_NOT_CONFIRMED") return "Evidence matching uncertainty";
  if (reason === "DIRECTION_UNCLEAR") return "Communication direction unclear";
  if (row.item_status === "Unknown") return "Needs rule review";
  return "Audit logic review";
}

export function logicIssueExplanation(row: LogicIssueRow): string {
  const area = workflowLabel(row.step_code);
  const reason = String(row.reason_code ?? "");
  if (logicIssueType(row) === "API or connection error") {
    return `${area} could not be checked cleanly because Clio returned an API or connection error.`;
  }
  if (reason.startsWith("NOTES_400:")) {
    return `${area} depended on note-related evidence, but Clio did not allow that read in this audit result.`;
  }
  if (reason === "EVIDENCE_NOT_CONFIRMED") {
    return `${area} is not confidently matched from read-only Clio evidence. This may need a keyword/template rule adjustment.`;
  }
  if (reason === "DIRECTION_UNCLEAR") {
    return `${area} found communication activity, but CWCA could not clearly tell whether it was firm-to-client or client-to-firm.`;
  }
  return `${area} is marked Unknown or has a reason code that should be reviewed before treating it as a team issue.`;
}

export function logicIssueNextStep(row: LogicIssueRow): string {
  const reason = String(row.reason_code ?? "");
  if (reason.includes("_ERROR") || reason.includes("ERROR:")) {
    return "Recheck the matter. If it repeats, review Clio permissions, rate limits, and the endpoint named in the reason code.";
  }
  if (reason.startsWith("NOTES_400:")) {
    return "Avoid depending on note text for this rule, or confirm the Clio scope/endpoint allows the needed read-only metadata.";
  }
  if (reason === "EVIDENCE_NOT_CONFIRMED") {
    return "Open the matter in Clio, compare the real subject/title/template wording, and add the valid pattern to CWCA.";
  }
  if (reason === "DIRECTION_UNCLEAR") {
    return "Review sender/receiver metadata and adjust the direction logic or accepted communication types.";
  }
  return "Review the Clio proof and decide whether this is a true workflow issue or a rule that needs tuning.";
}

export async function getDashboardData(filters: DashboardFilters = {}) {
  await initDb();
  const sql = db();
  const page = parseMatterPage(filters.page ?? 1);
  const pageSize = matterPageSize(filters.pageSize);
  const sort = parseMatterSort(filters.sort);
  const dir = filters.dir === "asc" || filters.dir === "desc" ? filters.dir : sort === "compliance" ? "asc" : "desc";
  const offset = (page - 1) * pageSize;
  const attorneyCondition =
    filters.attorney === "__unassigned"
      ? sql`(m.responsible_attorney_id is null or m.responsible_attorney_id = '')`
      : filters.attorney
        ? sql`m.responsible_attorney_id = ${filters.attorney}`
        : sql`true`;
  const overallCondition =
    filters.overall === "Unchecked"
      ? sql`
        (
          not exists (select 1 from audit_item filter_item where filter_item.matter_id = m.matter_id)
          or not exists (
            select 1
            from audit_item weekly_filter_item
            where weekly_filter_item.matter_id = m.matter_id
              and weekly_filter_item.step_code = 'WEEKLY_CLIENT_CHECKIN'
          )
        )
        `
      : filters.overall
        ? sql`
            m.overall_status = ${filters.overall}
            and exists (select 1 from audit_item filter_item where filter_item.matter_id = m.matter_id)
          `
        : sql`true`;
  const conditions = [
    sql`lower(coalesce(m.matter_status, '')) <> 'closed'`,
    attorneyCondition,
    overallCondition,
    filters.from ? sql`m.matter_created_at >= ${new Date(filters.from)}` : sql`true`,
    filters.to ? sql`m.matter_created_at < ${new Date(`${filters.to}T23:59:59`)}` : sql`true`,
    sql`
      not exists (
        select 1
        from audit_item stale
        where stale.matter_id = m.matter_id
          and stale.status = 'Unknown'
          and stale.reason_code in ('API_ERROR', 'MATTER_ERROR: API_ERROR')
        group by stale.matter_id
        having count(*) >= 3
      )
    `,
    sql`
      not exists (
        select 1
        from audit_item stale_notes
        where stale_notes.matter_id = m.matter_id
          and stale_notes.reason_code like 'NOTES_400:%'
      )
    `,
  ];
  const workspaceDateCondition =
    filters.from || filters.to
      ? sql`
          (
            (
              ${filters.from ? sql`m.matter_created_at >= ${new Date(filters.from)}` : sql`true`}
              and ${filters.to ? sql`m.matter_created_at < ${new Date(`${filters.to}T23:59:59`)}` : sql`true`}
            )
            or (
              i.step_code in ('CLIENT_CONTACT', 'WEEKLY_CLIENT_CHECKIN', 'COURT_REMINDER_CALL')
              and ${filters.from ? sql`coalesce(i.deadline_at, i.evidence_at, m.matter_created_at) >= ${new Date(filters.from)}` : sql`true`}
              and ${filters.to ? sql`coalesce(i.deadline_at, i.evidence_at, m.matter_created_at) < ${new Date(`${filters.to}T23:59:59`)}` : sql`true`}
            )
          )
        `
      : sql`true`;
  const normalizedItemStatus = sql`
    case
      when i.deadline_at is not null
        and now() <= i.deadline_at
        and i.step_code in ('CLIENT_CONTACT', 'WEEKLY_CLIENT_CHECKIN', 'COURT_REMINDER_CALL', 'APPEARANCE_FILING', 'COURT_RESULTS', 'POST_COURT_CALL')
        and i.status in ('Missing', 'Unknown', 'Needs Review', 'Needs Recheck')
        then 'Pending'
      when i.step_code in ('CLIENT_CONTACT', 'WEEKLY_CLIENT_CHECKIN', 'COURT_REMINDER_CALL')
        then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else i.status end
      when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
        then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
      when i.step_code = 'APPEARANCE_FILING'
        and i.status = 'Unknown'
        and i.reason_code = 'EVIDENCE_NOT_CONFIRMED'
        then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
      else i.status
    end
  `;
  const normalizedOperationalState = sql`
    case
      when i.step_code in ('CLIENT_CONTACT', 'WEEKLY_CLIENT_CHECKIN', 'COURT_REMINDER_CALL')
        then case when i.deadline_at is not null and now() <= i.deadline_at then 'Not Due Yet' else i.operational_state end
      when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
        then case when i.deadline_at is not null and now() <= i.deadline_at then 'Needs Court Results' else 'Overdue' end
      when i.step_code = 'APPEARANCE_FILING'
        and i.status = 'Unknown'
        and i.reason_code = 'EVIDENCE_NOT_CONFIRMED'
        then case when i.deadline_at is not null and now() <= i.deadline_at then 'Waiting for 48-hour review window' else 'Overdue' end
      else i.operational_state
    end
  `;
  const normalizedReasonCode = sql`
    case
      when i.deadline_at is not null
        and now() <= i.deadline_at
        and i.step_code in ('CLIENT_CONTACT', 'WEEKLY_CLIENT_CHECKIN', 'COURT_REMINDER_CALL', 'APPEARANCE_FILING', 'COURT_RESULTS', 'POST_COURT_CALL')
        and i.status in ('Missing', 'Unknown', 'Needs Review', 'Needs Recheck')
        then null
      when i.step_code in ('CLIENT_CONTACT', 'WEEKLY_CLIENT_CHECKIN', 'COURT_REMINDER_CALL')
        then case when i.deadline_at is not null and now() <= i.deadline_at then null else i.reason_code end
      when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
        then case when i.deadline_at is not null and now() <= i.deadline_at then null else 'NOT_FOUND' end
      when i.step_code = 'APPEARANCE_FILING'
        and i.status = 'Unknown'
        and i.reason_code = 'EVIDENCE_NOT_CONFIRMED'
        then case when i.deadline_at is not null and now() <= i.deadline_at then null else 'NOT_FOUND' end
      else i.reason_code
    end
  `;
  const complianceRank = sql`
    case
      when count(i.*) = 0 or count(*) filter (where i.step_code = 'WEEKLY_CLIENT_CHECKIN') = 0 then 6
      when count(*) filter (where (${normalizedItemStatus}) = 'Unknown') > 0 then 5
      when count(*) filter (where (${normalizedItemStatus}) = 'Missing') > 0 then 4
      when count(*) filter (where (${normalizedItemStatus}) = 'Late') > 0 then 3
      when count(*) filter (where (${normalizedItemStatus}) = 'Pending') > 0 then 2
      else 1
    end
  `;
  const matterOrder =
    sort === "date"
      ? dir === "asc"
        ? sql`m.matter_created_at asc nulls last, m.matter_id asc`
        : sql`m.matter_created_at desc nulls last, m.matter_id desc`
      : sort === "attorney"
        ? dir === "asc"
          ? sql`coalesce(m.responsible_attorney_name, '') asc, m.matter_id asc`
          : sql`coalesce(m.responsible_attorney_name, '') desc, m.matter_id desc`
        : sort === "case_manager"
          ? dir === "asc"
            ? sql`coalesce(max(nullif(r.case_manager_name, '')), 'Unassigned') asc, m.matter_id asc`
            : sql`coalesce(max(nullif(r.case_manager_name, '')), 'Unassigned') desc, m.matter_id desc`
          : dir === "asc"
            ? sql`${complianceRank} asc, m.matter_created_at desc, m.matter_id asc`
            : sql`${complianceRank} desc, m.matter_created_at desc, m.matter_id desc`;

  const [matters, attorneys, summary, lastRun, metrics, workspaceItems, matterCount] = await Promise.all([
    sql`
    select
      m.*,
      coalesce(mex.active, false) as metric_excluded,
      mex.requested_by as metric_exclusion_requested_by,
      mex.request_reason as metric_exclusion_reason,
      mex.updated_at as metric_exclusion_updated_at,
      case
        when count(i.*) = 0 or count(*) filter (where i.step_code = 'WEEKLY_CLIENT_CHECKIN') = 0 then 'Unchecked'
        when count(*) filter (where (${normalizedItemStatus}) = 'Unknown') > 0 then 'Review'
        when count(*) filter (where (${normalizedItemStatus}) = 'Missing') > 0 then 'Flag'
        when count(*) filter (where (${normalizedItemStatus}) = 'Late') > 0 then 'Late'
        when count(*) filter (where (${normalizedItemStatus}) = 'Pending') > 0 then 'Pending'
        else m.overall_status
      end as display_overall_status,
      coalesce(json_agg(
        json_build_object(
          'stepCode', i.step_code,
          'status', ${normalizedItemStatus},
          'operationalState', ${normalizedOperationalState},
          'deadlineAt', i.deadline_at,
          'evidenceAt', i.evidence_at,
          'evidenceSource', i.evidence_source,
          'evidenceRefId', i.evidence_ref_id,
          'evidenceUrl', i.evidence_url,
          'auditVersion', i.audit_version,
          'lastEvaluatedAt', i.last_evaluated_at,
          'reviewDecision', r.review_decision,
          'reviewNote', r.review_note,
          'caseManagerName', r.case_manager_name,
          'proofType', r.proof_type,
          'reviewProofReference', r.proof_reference,
          'nextStep', r.next_step,
          'reportSummary', r.report_summary,
          'internalNotes', r.internal_notes,
          'includeInReport', r.include_in_report,
          'reviewedBy', r.reviewed_by,
          'reviewCompletedAt', r.review_completed_at,
          'reviewUpdatedAt', r.updated_at,
          'reasonCode', ${normalizedReasonCode}
        )
        order by i.step_code
      ) filter (where i.step_code is not null), '[]') as items
    from audit_matter m
    left join audit_item i on i.matter_id = m.matter_id
    left join audit_review r on r.matter_id = i.matter_id and r.step_code = i.step_code
    left join audit_metric_exclusion mex on mex.matter_id = m.matter_id
    where ${conditions[0]} and ${conditions[1]} and ${conditions[2]} and ${conditions[3]} and ${conditions[4]} and ${conditions[5]} and ${conditions[6]}
      and exists (
        select 1
        from audit_item visible_item
        where visible_item.matter_id = m.matter_id
      )
    group by m.matter_id, mex.active, mex.requested_by, mex.request_reason, mex.updated_at
    order by ${matterOrder}
    limit ${pageSize}
    offset ${offset}
  `,
    sql`
    select responsible_attorney_id as id, responsible_attorney_name as name, count(*)::int as count
    from audit_matter m
    where ${conditions[0]} and ${conditions[5]} and ${conditions[6]}
    group by responsible_attorney_id, responsible_attorney_name
    order by responsible_attorney_name
  `,
    sql`
    select
      count(*)::int as total,
      count(*) filter (where display_overall_status = 'Unchecked')::int as unchecked,
      count(*) filter (where display_overall_status = 'Pass')::int as pass,
      count(*) filter (where display_overall_status = 'Pending')::int as pending,
      count(*) filter (where display_overall_status = 'Late')::int as late,
      count(*) filter (where display_overall_status = 'Flag')::int as flag,
      count(*) filter (where display_overall_status = 'Review')::int as review,
      coalesce(sum(missing_items), 0)::int as missing_items,
      coalesce(sum(late_items), 0)::int as late_items,
      coalesce(sum(unknown_items), 0)::int as unknown_items
    from (
      select
        m.matter_id,
        case
          when count(i.*) = 0 or count(*) filter (where i.step_code = 'WEEKLY_CLIENT_CHECKIN') = 0 then 'Unchecked'
          when count(*) filter (where (${normalizedItemStatus}) = 'Unknown') > 0 then 'Review'
          when count(*) filter (where (${normalizedItemStatus}) = 'Missing') > 0 then 'Flag'
          when count(*) filter (where (${normalizedItemStatus}) = 'Late') > 0 then 'Late'
          when count(*) filter (where (${normalizedItemStatus}) = 'Pending') > 0 then 'Pending'
          else m.overall_status
        end as display_overall_status,
        count(i.*) filter (where (${normalizedItemStatus}) = 'Missing')::int as missing_items,
        count(i.*) filter (where (${normalizedItemStatus}) = 'Late')::int as late_items,
        count(i.*) filter (where (${normalizedItemStatus}) = 'Unknown')::int as unknown_items
      from audit_matter m
      left join audit_item i on i.matter_id = m.matter_id
      where ${conditions[0]} and ${conditions[1]} and ${conditions[2]} and ${conditions[3]} and ${conditions[4]} and ${conditions[5]} and ${conditions[6]}
      group by m.matter_id, m.overall_status
    ) s
  `,
    sql`
    select *
    from audit_run
    order by started_at desc
    limit 1
  `,
    sql`
    select *
    from (
      select distinct on (coalesce(responsible_attorney_id, ''), responsible_attorney_name)
        *
      from audit_metric_snapshot
      where period_type = 'month'
        and period_start = date_trunc('month', now())::date
      order by coalesce(responsible_attorney_id, ''), responsible_attorney_name, created_at desc, snapshot_id desc
    ) current_month
    order by responsible_attorney_name
  `,
    sql<WorkspaceAuditItem[]>`
    select
      m.matter_id,
      m.matter_number,
      m.client_first_name,
      m.client_last_name,
      m.matter_created_at,
      m.responsible_attorney_id,
      m.responsible_attorney_name,
      i.step_code,
      ${normalizedItemStatus} as item_status,
      i.deadline_at,
      i.evidence_at,
      i.evidence_source,
      i.evidence_ref_id,
      i.evidence_url,
      i.audit_version,
      r.review_decision,
      r.review_note,
      r.case_manager_name,
      r.proof_type,
      r.proof_reference,
      r.next_step,
      r.report_summary,
      r.internal_notes,
      r.include_in_report,
      r.reviewed_by,
      r.review_completed_at,
      r.updated_at as review_updated_at,
      coalesce(mex.active, false) as metric_excluded,
      mex.requested_by as metric_exclusion_requested_by,
      mex.request_reason as metric_exclusion_reason,
      mex.updated_at as metric_exclusion_updated_at,
      coalesce((
        select json_agg(
          json_build_object(
            'historyId', h.history_id,
            'updatedAt', h.updated_at,
            'updatedBy', h.updated_by,
            'previousDecision', h.previous_decision,
            'decision', h.review_decision,
            'resultsDetails', h.results_details,
            'caseManagerName', h.case_manager_name,
            'proofType', h.proof_type,
            'proofReference', h.proof_reference,
            'nextStep', h.next_step,
            'reportSummary', h.report_summary
          )
          order by h.updated_at desc, h.history_id desc
        )
        from audit_review_history h
        where h.matter_id = i.matter_id and h.step_code = i.step_code
      ), '[]'::json) as review_history,
      ${normalizedReasonCode} as reason_code
    from audit_matter m
    join audit_item i on i.matter_id = m.matter_id
    left join audit_review r on r.matter_id = i.matter_id and r.step_code = i.step_code
    left join audit_metric_exclusion mex on mex.matter_id = m.matter_id
    where ${conditions[0]} and ${conditions[1]} and ${conditions[2]} and ${workspaceDateCondition} and ${conditions[5]} and ${conditions[6]}
    order by
      m.responsible_attorney_name,
      case
        when i.status = 'Missing' then 1
        when i.status = 'Unknown' then 2
        when i.status = 'Late' then 3
        when i.status = 'Pending' then 4
        when i.status = 'On Time' then 5
        else 6
      end,
      m.client_last_name,
      m.client_first_name,
      i.step_code
    limit 1000
  `,
    sql`
    select count(*)::int as matter_total
    from audit_matter m
    where ${conditions[0]} and ${conditions[1]} and ${conditions[2]} and ${conditions[3]} and ${conditions[4]} and ${conditions[5]} and ${conditions[6]}
      and exists (
        select 1
        from audit_item visible_item
        where visible_item.matter_id = m.matter_id
      )
  `,
  ]);

  return {
    matters,
    attorneys,
    summary: summary[0] ?? { total: 0, unchecked: 0, pass: 0, pending: 0, late: 0, flag: 0, review: 0, missing_items: 0, late_items: 0, unknown_items: 0 },
    lastRun: lastRun[0] ?? null,
    metrics,
    workspaceItems,
    matterTotal: matterCount[0]?.matter_total ?? 0,
  };
}

export async function dashboardCsv(filters: DashboardFilters = {}): Promise<string> {
  const { matters } = await getDashboardData({ ...filters, page: 1, pageSize: EXPORT_MATTER_PAGE_SIZE });
  const headers = [
    "Client Name",
    "Matter Number",
    "Responsible Attorney",
    "Overall Status",
    "Welcome Letter",
    "Attorney Call",
    "Court Date Added",
    "Client Contact",
    "Appearance Filed",
    "Court Results",
    "Post-Court Call",
    "Court Reminder Email",
    "Client Follow-Up",
    "Weekly Client Check-In",
    "Matter Created Date",
    "Last Court Date",
    "Problem Details",
    "Evidence Links",
  ];
  const rows = matters.map((m) => {
    const items = m.items as Array<{ stepCode: string; status: string; evidenceSource?: string; evidenceRefId?: string; evidenceUrl?: string; reasonCode?: string }>;
    const labels = (status: string) => items.filter((i) => i.status === status).map((i) => i.stepCode).join(", ");
    const getWithReason = (step: string) => {
      const item = items.find((i) => i.stepCode === step);
      return item ? `${item.status}${item.reasonCode ? ` (${item.reasonCode})` : ""}` : "";
    };
    return [
      `${m.client_first_name} ${m.client_last_name}`.trim(),
      m.matter_number,
      m.responsible_attorney_name,
      m.display_overall_status ?? m.overall_status,
      getWithReason("SETUP_WELCOME"),
      getWithReason("SETUP_ATTY_CALL"),
      getWithReason("SETUP_COURT_DATE"),
      getWithReason("CLIENT_CONTACT"),
      getWithReason("APPEARANCE_FILING"),
      getWithReason("COURT_RESULTS"),
      getWithReason("POST_COURT_CALL"),
      getWithReason("COURT_REMINDER_CALL"),
      getWithReason("CLIENT_FOLLOWUP"),
      getWithReason("WEEKLY_CLIENT_CHECKIN"),
      m.matter_created_at,
      m.last_court_date,
      `Late: ${labels("Late")}; Missing: ${labels("Missing")}; Unknown: ${labels("Unknown")}`,
      items
        .filter((i) => i.evidenceRefId)
        .map((i) => `${i.stepCode}: ${i.evidenceSource ?? "Evidence"} #${i.evidenceRefId}`)
        .join("; "),
    ];
  });
  return [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

async function getActionRows(filters: DashboardFilters = {}): Promise<ActionCsvRow[]> {
  await initDb();
  const sql = db();
  const overallCondition =
    filters.overall === "Unchecked"
      ? sql`false`
      : filters.overall
        ? sql`m.overall_status = ${filters.overall}`
        : sql`true`;
  const normalizedItemStatus = sql`
    case
      when i.deadline_at is not null
        and now() <= i.deadline_at
        and i.step_code in ('APPEARANCE_FILING', 'COURT_RESULTS', 'POST_COURT_CALL')
        and i.status in ('Missing', 'Unknown', 'Needs Review', 'Needs Recheck')
        then 'Pending'
      when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
        then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
      when i.step_code = 'APPEARANCE_FILING'
        and i.status = 'Unknown'
        and i.reason_code = 'EVIDENCE_NOT_CONFIRMED'
        then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
      else i.status
    end
  `;
  const normalizedReasonCode = sql`
    case
      when i.deadline_at is not null
        and now() <= i.deadline_at
        and i.step_code in ('APPEARANCE_FILING', 'COURT_RESULTS', 'POST_COURT_CALL')
        and i.status in ('Missing', 'Unknown', 'Needs Review', 'Needs Recheck')
        then null
      when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
        then case when i.deadline_at is not null and now() <= i.deadline_at then null else 'NOT_FOUND' end
      when i.step_code = 'APPEARANCE_FILING'
        and i.status = 'Unknown'
        and i.reason_code = 'EVIDENCE_NOT_CONFIRMED'
        then case when i.deadline_at is not null and now() <= i.deadline_at then null else 'NOT_FOUND' end
      else i.reason_code
    end
  `;
  const rows = await sql<ActionCsvRow[]>`
    select *
    from (
      select
        m.matter_id,
        m.matter_number,
        m.client_first_name,
        m.client_last_name,
        m.responsible_attorney_name,
        m.matter_created_at,
        m.overall_status,
        i.step_code,
        ${normalizedItemStatus} as item_status,
        i.deadline_at,
        i.evidence_at,
        i.evidence_source,
        i.evidence_ref_id,
        i.audit_version,
        r.review_decision,
        r.review_note,
        r.case_manager_name,
        r.proof_type,
        r.proof_reference,
        r.next_step,
        r.report_summary,
        r.internal_notes,
        r.include_in_report,
        r.reviewed_by,
        r.review_completed_at,
        r.updated_at as review_updated_at,
        coalesce((
          select json_agg(
            json_build_object(
              'historyId', h.history_id,
              'updatedAt', h.updated_at,
              'updatedBy', h.updated_by,
              'previousDecision', h.previous_decision,
              'decision', h.review_decision,
              'resultsDetails', h.results_details,
              'caseManagerName', h.case_manager_name,
              'proofType', h.proof_type,
              'proofReference', h.proof_reference,
              'nextStep', h.next_step,
              'reportSummary', h.report_summary
            )
            order by h.updated_at desc, h.history_id desc
          )
          from audit_review_history h
          where h.matter_id = i.matter_id and h.step_code = i.step_code
        ), '[]'::json) as review_history,
        ${normalizedReasonCode} as reason_code
      from audit_matter m
      join audit_item i on i.matter_id = m.matter_id
      left join audit_review r on r.matter_id = i.matter_id and r.step_code = i.step_code
      where lower(coalesce(m.matter_status, '')) <> 'closed'
        and ${filters.attorney ? sql`m.responsible_attorney_id = ${filters.attorney}` : sql`true`}
        and ${overallCondition}
        and ${filters.from ? sql`m.matter_created_at >= ${new Date(filters.from)}` : sql`true`}
        and ${filters.to ? sql`m.matter_created_at < ${new Date(`${filters.to}T23:59:59`)}` : sql`true`}
        and not (
          i.status = 'Unknown'
          and coalesce(i.reason_code, '') in ('API_ERROR', 'MATTER_ERROR: API_ERROR')
        )
        and coalesce(i.reason_code, '') not like 'NOTES_400:%'
    ) action_rows
    where item_status in ('Missing', 'Late', 'Unknown')
    order by
      responsible_attorney_name,
      case item_status when 'Missing' then 1 when 'Unknown' then 2 when 'Late' then 3 else 4 end,
      client_last_name,
      client_first_name,
      step_code
  `;
  return rows;
}

export async function actionItemsCsv(filters: DashboardFilters = {}, origin = ""): Promise<string> {
  const rows = await getActionRows(filters);
  const headers = [
    "Attorney",
    "Case Manager",
    "Priority",
    "Client",
    "Matter",
    "Overall",
    "Improvement Area",
    "Status",
    "Human Review Status",
    "Human Review Note",
    "Review Proof Or Reference",
    "What The Case Manager Should Do In Clio",
    "Timeliness Goal",
    "Due",
    "Found",
    "Open Matter In Clio",
    "Proof Saved In Auditor",
    "Evidence Found",
    "Matter Created",
    "Why This Was Flagged",
  ];

  const csvRows = rows.map((row) => {
    const status = String(row.item_status ?? "");
    const evidence =
      row.evidence_source && row.evidence_ref_id
        ? `${row.evidence_source} #${row.evidence_ref_id}`
        : "";
    return [
      row.responsible_attorney_name || "Unassigned",
      row.case_manager_name || "",
      priorityFor(status),
      `${row.client_first_name ?? ""} ${row.client_last_name ?? ""}`.trim(),
      row.matter_number,
      row.overall_status,
      workflowLabel(row.step_code),
      humanStatus(status),
      row.review_decision || "Pending",
      row.review_note || "",
      row.proof_reference || "",
      actionFor(row.step_code, status, row.reason_code),
      timingGoalFor(row.step_code),
      formatCsvDate(row.deadline_at),
      formatCsvDate(row.evidence_at),
      clioMatterLink(String(row.matter_id)),
      proofPath(origin, row.evidence_source, row.evidence_ref_id),
      evidence,
      formatCsvDate(row.matter_created_at),
      whyFlagged(row.step_code, status, row.reason_code),
    ];
  });

  return [headers, ...csvRows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export async function getLogicIssueRows(filters: DashboardFilters = {}): Promise<LogicIssueRow[]> {
  await initDb();
  const sql = db();
  const overallCondition =
    filters.overall === "Unchecked"
      ? sql`false`
      : filters.overall
        ? sql`m.overall_status = ${filters.overall}`
        : sql`true`;

  return sql<LogicIssueRow[]>`
    select
      m.matter_id,
      m.matter_number,
      m.client_first_name,
      m.client_last_name,
      m.responsible_attorney_name,
      m.matter_status,
      i.step_code,
      i.status as item_status,
      i.operational_state,
      i.deadline_at,
      i.evidence_at,
      i.evidence_source,
      i.evidence_ref_id,
      i.reason_code,
      i.audit_version,
      i.last_evaluated_at,
      r.review_decision,
      r.review_note,
      r.reviewed_by,
      r.updated_at as review_updated_at
    from audit_matter m
    join audit_item i on i.matter_id = m.matter_id
    left join audit_review r on r.matter_id = i.matter_id and r.step_code = i.step_code
    where lower(coalesce(m.matter_status, '')) <> 'closed'
      and ${filters.attorney ? sql`m.responsible_attorney_id = ${filters.attorney}` : sql`true`}
      and ${overallCondition}
      and ${filters.from ? sql`m.matter_created_at >= ${new Date(filters.from)}` : sql`true`}
      and ${filters.to ? sql`m.matter_created_at < ${new Date(`${filters.to}T23:59:59`)}` : sql`true`}
      and (
        i.status = 'Unknown'
        or coalesce(i.reason_code, '') like '%_ERROR%'
        or coalesce(i.reason_code, '') like '%ERROR:%'
        or coalesce(i.reason_code, '') like 'NOTES_400:%'
        or coalesce(i.reason_code, '') in ('EVIDENCE_NOT_CONFIRMED', 'DIRECTION_UNCLEAR')
      )
    order by
      case
        when coalesce(i.reason_code, '') like '%_ERROR%' or coalesce(i.reason_code, '') like '%ERROR:%' then 1
        when coalesce(i.reason_code, '') like 'NOTES_400:%' then 2
        when i.reason_code = 'EVIDENCE_NOT_CONFIRMED' then 3
        when i.reason_code = 'DIRECTION_UNCLEAR' then 4
        else 5
      end,
      i.last_evaluated_at desc nulls last,
      m.responsible_attorney_name,
      m.client_last_name,
      m.client_first_name
    limit 1000
  `;
}

export async function auditLogicIssuesCsv(filters: DashboardFilters = {}, origin = ""): Promise<string> {
  const rows = await getLogicIssueRows(filters);
  const headers = [
    "Issue Type",
    "Client",
    "Matter",
    "Attorney",
    "Workflow Area",
    "Audit Status",
    "Reason Code",
    "What Happened",
    "Suggested Debugging Step",
    "Open Matter In Clio",
    "Proof Link",
    "Evidence Found",
    "Last Checked",
    "Audit Version",
    "Human Review Status",
    "Human Review Note",
    "Reviewed By",
    "Review Updated",
  ];

  const csvRows = rows.map((row) => [
    logicIssueType(row),
    `${row.client_first_name ?? ""} ${row.client_last_name ?? ""}`.trim(),
    row.matter_number,
    row.responsible_attorney_name || "Unassigned",
    workflowLabel(row.step_code),
    humanStatus(row.item_status),
    row.reason_code || "",
    logicIssueExplanation(row),
    logicIssueNextStep(row),
    clioMatterLink(String(row.matter_id)),
    proofPath(origin, row.evidence_source, row.evidence_ref_id),
    row.evidence_source && row.evidence_ref_id ? `${row.evidence_source} #${row.evidence_ref_id}` : "",
    formatCsvDate(row.last_evaluated_at),
    row.audit_version || "",
    row.review_decision || "Not reviewed",
    row.review_note || "",
    row.reviewed_by || "",
    formatCsvDate(row.review_updated_at),
  ]);

  return [headers, ...csvRows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function isApprovedException(reviewDecision?: string | null): boolean {
  return reviewDecision === "Approved Exception";
}

function isPendingAdminReview(requestedBy?: string | null, metricExcluded?: boolean | null): boolean {
  return Boolean(requestedBy && !metricExcluded);
}

function isStandardComplete(
  status: string | null | undefined,
  evidenceRefId?: string | null,
  reviewDecision?: string | null,
  metricReviewRequestedBy?: string | null,
  metricExcluded?: boolean | null,
): boolean {
  if (isApprovedException(reviewDecision)) return true;
  if (isPendingAdminReview(metricReviewRequestedBy, metricExcluded)) return true;
  return status === "On Track" || status === "Late" || Boolean(evidenceRefId);
}

function csvDateKey(value: unknown): string {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function csvDisplayDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return `${month}/${day}/${year}`;
}

function eachDateKey(from: string, to: string): string[] {
  const result: string[] = [];
  const start = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return result;
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    result.push(csvDateKey(cursor));
  }
  return result;
}

function lastCompletedWeekRange(baseDate = new Date()): { from: string; to: string } {
  const currentStart = weekStartDateKey(baseDate);
  return {
    from: addDateKeyDays(currentStart, -7),
    to: addDateKeyDays(currentStart, -1),
  };
}

function normalizeOwnerName(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const STANDARD_CASE_MANAGERS = [
  "Svetlana",
  "Jesus",
  "Alessandra",
  "Ivan",
  "Ronald",
  "Camila",
  "Anahi",
  "Lori",
  "Claudia",
  "Nathaly",
] as const;

function canonicalCaseManagerName(value: string | null | undefined): string {
  const normalized = normalizeOwnerName(value);
  if (!normalized) return "";
  if (normalized.includes("alessandra")) return "Alessandra";
  if (normalized.includes("anahi")) return "Anahi";
  if (normalized.includes("camila")) return "Camila";
  if (normalized.includes("claudia")) return "Claudia";
  if (normalized.includes("ivan")) return "Ivan";
  if (normalized.includes("jesus")) return "Jesus";
  if (normalized.includes("lori")) return "Lori";
  if (normalized.includes("nathaly") || normalized.includes("nathalie") || normalized.includes("nataly")) return "Nathaly";
  if (normalized.includes("ronald")) return "Ronald";
  if (normalized.includes("svetlana")) return "Svetlana";
  return "";
}

function isStandardsStep(stepCode: string): boolean {
  return stepCode === "SETUP_WELCOME" || stepCode === "SETUP_ATTY_CALL" || stepCode === "SETUP_COURT_DATE";
}

export type CaseManagerMapItem = Pick<
  WorkspaceAuditItem,
  "responsible_attorney_name" | "case_manager_name" | "matter_number" | "client_first_name" | "client_last_name"
>;

function isParkCityMatter(item: CaseManagerMapItem): boolean {
  const text = normalizeOwnerName(`${item.matter_number} ${item.client_first_name ?? ""} ${item.client_last_name ?? ""}`);
  return text.includes("park city") || text.includes("parkcity");
}

export function standardsCaseManagerFor(item: CaseManagerMapItem): string {
  const attorney = normalizeOwnerName(item.responsible_attorney_name);
  const manualCaseManager = canonicalCaseManagerName(item.case_manager_name);
  if (attorney.includes("andrew hans")) return "Alessandra";
  if (attorney.includes("robert kroeger")) return "Anahi";
  if (attorney.includes("brandon phetsadasack") || attorney.includes("joseph weigel")) return "Camila";
  if (attorney.includes("luiza quental") || attorney.includes("sara bozarth") || attorney.includes("thomas florek")) return "Claudia";
  if (attorney.includes("melanie")) return "Ivan";
  if (attorney.includes("caelyn deeb") || attorney.includes("christine fields") || attorney.includes("dan clifton") || attorney.includes("daniel clifton")) return "Jesus";
  if (attorney.includes("alex") && attorney.includes("blum")) return "Lori";
  if (attorney.includes("elanna myers")) return isParkCityMatter(item) ? "Ronald" : "Lori";
  if (attorney.includes("andrea neumann")) return "Nathaly";
  if (attorney.includes("james b") || attorney.includes("james brzezinski")) return isParkCityMatter(item) ? "Ronald" : "Ronald";
  if ((attorney.includes("michelle") && (attorney.includes("mcclellan") || attorney.includes("mc clellan"))) || attorney.includes("thomas carrasco")) return "Ronald";
  if (attorney.includes("arnold pula")) return "Svetlana";
  return manualCaseManager || "Unassigned";
}

function standardsAssignmentNote(item: WorkspaceAuditItem): string {
  const attorney = normalizeOwnerName(item.responsible_attorney_name);
  if (attorney.includes("james b") || attorney.includes("james brzezinski")) {
    return isParkCityMatter(item) ? "James B. Park City rule" : "James B. assigned to Ronald; Park City location not stored separately";
  }
  if (attorney.includes("elanna myers")) {
    return isParkCityMatter(item) ? "Elanna Myers Park City best-effort match" : "Elanna Myers all other locations";
  }
  return "Attorney assignment map";
}

type StandardsReportRow = {
  owner: string;
  newMatters: number;
  attorneyCall: number;
  welcome: number;
  courtDate: number;
  weeklyCheckIns: number;
  completion: string;
  date: string;
  sortDate: string;
};

const STANDARDS_HEADERS = [
  "Case Manager",
  "Date",
  "ATC / new matters #",
  "Initial Meeting set - Phone call",
  "Welcome letters sent",
  "Court date event made",
  "Weekly check-ins completed",
  "Workflow completion %",
];

export const STANDARDS_SHEET_HEADERS = STANDARDS_HEADERS;

function standardsOwnerSort(a: string, b: string): number {
  const aIndex = STANDARD_CASE_MANAGERS.indexOf(a as (typeof STANDARD_CASE_MANAGERS)[number]);
  const bIndex = STANDARD_CASE_MANAGERS.indexOf(b as (typeof STANDARD_CASE_MANAGERS)[number]);
  if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
  if (aIndex === -1) return 1;
  if (bIndex === -1) return -1;
  return aIndex - bIndex;
}

/** The workbook's daily grid, plus what the grid could not hold. `standardsCaseManagerFor` maps an
 *  attorney to a case manager from a table in this file, and a matter whose attorney is missing from
 *  that table reaches no tab at all. Counting the loss here, next to the filter that causes it, is
 *  the only place the two can never drift apart. */
export type StandardsReport = {
  rows: StandardsReportRow[];
  unmappedMatters: number;
  unmappedAttorneys: string[];
};

export async function standardsReport(filters: DashboardFilters = {}): Promise<StandardsReport> {
  await initDb();
  const sql = db();
  const defaultRange = lastCompletedWeekRange();
  const from = filters.from || defaultRange.from;
  const to = filters.to || defaultRange.to;
  const dates = eachDateKey(from, to);
  const dateSet = new Set(dates);
  const rangeStart = new Date(`${from}T00:00:00`);
  const rangeEnd = new Date(`${to}T23:59:59`);
  const workspaceItems = await sql<WorkspaceAuditItem[]>`
    select
      m.matter_id,
      m.matter_number,
      m.client_first_name,
      m.client_last_name,
      m.matter_created_at,
      m.responsible_attorney_id,
      m.responsible_attorney_name,
      i.step_code,
      case
        when i.step_code = 'WEEKLY_CLIENT_CHECKIN'
          then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else i.status end
        else i.status
      end as item_status,
      i.deadline_at,
      i.evidence_at,
      i.evidence_source,
      i.evidence_ref_id,
      i.evidence_url,
      i.audit_version,
      case
        when i.step_code = 'WEEKLY_CLIENT_CHECKIN'
          then case when i.deadline_at is not null and now() <= i.deadline_at then null else i.reason_code end
        else i.reason_code
      end as reason_code,
      r.review_decision,
      r.review_note,
      r.case_manager_name,
      r.proof_type,
      r.proof_reference,
      r.next_step,
      r.report_summary,
      r.internal_notes,
      r.include_in_report,
      r.reviewed_by,
      r.review_completed_at,
      r.updated_at as review_updated_at,
      coalesce(mex.active, false) as metric_excluded,
      mex.requested_by as metric_exclusion_requested_by,
      mex.request_reason as metric_exclusion_reason,
      mex.updated_at as metric_exclusion_updated_at,
      '[]'::json as review_history
    from audit_matter m
    join audit_item i on i.matter_id = m.matter_id
    left join audit_review r on r.matter_id = i.matter_id and r.step_code = i.step_code
    left join audit_metric_exclusion mex on mex.matter_id = m.matter_id
    where lower(coalesce(m.matter_status, '')) <> 'closed'
      and (
        (
          i.step_code in ('SETUP_WELCOME', 'SETUP_ATTY_CALL', 'SETUP_COURT_DATE')
          and m.matter_created_at >= ${rangeStart}
          and m.matter_created_at <= ${rangeEnd}
        )
        or (
          i.step_code = 'WEEKLY_CLIENT_CHECKIN'
          and coalesce(i.deadline_at, i.evidence_at, m.matter_created_at) >= ${rangeStart}
          and coalesce(i.deadline_at, i.evidence_at, m.matter_created_at) <= ${rangeEnd}
        )
      )
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
    order by m.matter_created_at, m.responsible_attorney_name, m.client_last_name, m.client_first_name, i.step_code
  `;
  const rowsByOwnerDate = new Map<string, {
    owner: string;
    date: string;
    assignedAttorneys: Set<string>;
    assignmentNotes: Set<string>;
    newMatters: Set<string>;
    expectedStandards: number;
    completedStandards: number;
    onTimeStandards: number;
    lateStandards: number;
    needsFollowUp: number;
    attorneyCall: number;
    attorneyCallLate: number;
    welcome: number;
    welcomeLate: number;
    courtDate: number;
    courtDateLate: number;
    weeklyCheckIns: number;
    weeklyCheckInsLate: number;
  }>();
  const getRow = (owner: string, date: string) => {
    const key = `${owner}__${date}`;
    const current = rowsByOwnerDate.get(key) ?? {
      owner,
      date,
      assignedAttorneys: new Set<string>(),
      assignmentNotes: new Set<string>(),
      newMatters: new Set<string>(),
      expectedStandards: 0,
      completedStandards: 0,
      onTimeStandards: 0,
      lateStandards: 0,
      needsFollowUp: 0,
      attorneyCall: 0,
      attorneyCallLate: 0,
      welcome: 0,
      welcomeLate: 0,
      courtDate: 0,
      courtDateLate: 0,
      weeklyCheckIns: 0,
      weeklyCheckInsLate: 0,
    };
    rowsByOwnerDate.set(key, current);
    return current;
  };

  const isNewMatterItem = (item: WorkspaceAuditItem) => {
    if (item.metric_excluded) return false;
    if (!isStandardsStep(item.step_code)) return false;
    const createdKey = csvDateKey(item.matter_created_at);
    return Boolean(createdKey) && (!dateSet.size || dateSet.has(createdKey));
  };
  const hasCaseManagerTab = (item: WorkspaceAuditItem) =>
    STANDARD_CASE_MANAGERS.includes(standardsCaseManagerFor(item) as (typeof STANDARD_CASE_MANAGERS)[number]);
  const newMatterItems = workspaceItems.filter(isNewMatterItem);
  const standardsItems = newMatterItems.filter(hasCaseManagerTab);
  // A matter counts as missing only when NONE of its items reached a tab. standardsCaseManagerFor
  // falls back to the review row's case_manager_name, which is stored per step, so one matter can
  // resolve both ways across its own items and would otherwise be reported as dropped and shown.
  const mattersOnATab = new Set(standardsItems.map((item) => String(item.matter_id)));
  const droppedItems = newMatterItems.filter((item) => !hasCaseManagerTab(item) && !mattersOnATab.has(String(item.matter_id)));
  const unmappedMatters = new Set(droppedItems.map((item) => String(item.matter_id)));
  const unmappedAttorneys = Array.from(
    new Set(droppedItems.map((item) => String(item.responsible_attorney_name ?? "").trim() || "(no responsible attorney)")),
  ).sort((a, b) => a.localeCompare(b, "en-US"));
  const ongoingStandardsItems = workspaceItems.filter((item) => {
    if (item.metric_excluded) return false;
    if (!STANDARD_CASE_MANAGERS.includes(standardsCaseManagerFor(item) as (typeof STANDARD_CASE_MANAGERS)[number])) return false;
    if (item.step_code !== "WEEKLY_CLIENT_CHECKIN") return false;
    const dueKey = csvDateKey(item.deadline_at);
    return Boolean(dueKey) && (!dateSet.size || dateSet.has(dueKey));
  });
  const owners = Array.from(new Set([...standardsItems, ...ongoingStandardsItems].map(standardsCaseManagerFor))).sort(standardsOwnerSort);
  for (const owner of owners) {
    for (const date of dates) getRow(owner, date);
  }

  const countCompletedStandard = (item: WorkspaceAuditItem, row: ReturnType<typeof getRow>) => {
    row.assignedAttorneys.add(item.responsible_attorney_name || "Unassigned");
    row.assignmentNotes.add(standardsAssignmentNote(item));
    row.expectedStandards += 1;
    const approvedException = isApprovedException(item.review_decision);
    const pendingAdminReview = isPendingAdminReview(item.metric_exclusion_requested_by, item.metric_excluded);
    const late = item.item_status === "Late" && !approvedException && !pendingAdminReview;
    const complete = isStandardComplete(item.item_status, item.evidence_ref_id, item.review_decision, item.metric_exclusion_requested_by, item.metric_excluded);
    if (!complete) {
      row.needsFollowUp += 1;
      return false;
    }
    row.completedStandards += 1;
    if (late) row.lateStandards += 1;
    else row.onTimeStandards += 1;
    return true;
  };

  for (const item of standardsItems) {
    const owner = standardsCaseManagerFor(item);
    const createdKey = csvDateKey(item.matter_created_at);
    if (!createdKey) continue;
    const row = getRow(owner, createdKey);
    row.newMatters.add(String(item.matter_id));
    const complete = countCompletedStandard(item, row);
    if (!complete) continue;
    const late = item.item_status === "Late" && !isApprovedException(item.review_decision) && !isPendingAdminReview(item.metric_exclusion_requested_by, item.metric_excluded);
    if (item.step_code === "SETUP_WELCOME") {
      row.welcome += 1;
      if (late) row.welcomeLate += 1;
    }
    if (item.step_code === "SETUP_ATTY_CALL") {
      row.attorneyCall += 1;
      if (late) row.attorneyCallLate += 1;
    }
    if (item.step_code === "SETUP_COURT_DATE") {
      row.courtDate += 1;
      if (late) row.courtDateLate += 1;
    }
  }

  for (const item of ongoingStandardsItems) {
    const owner = standardsCaseManagerFor(item);
    const dueKey = csvDateKey(item.deadline_at);
    if (!dueKey) continue;
    const row = getRow(owner, dueKey);
    const complete = countCompletedStandard(item, row);
    if (!complete) continue;
    const late = item.item_status === "Late" && !isApprovedException(item.review_decision) && !isPendingAdminReview(item.metric_exclusion_requested_by, item.metric_excluded);
    if (item.step_code === "WEEKLY_CLIENT_CHECKIN") {
      row.weeklyCheckIns += 1;
      if (late) row.weeklyCheckInsLate += 1;
    }
  }

  const rows = Array.from(rowsByOwnerDate.values())
    .filter((row) => row.newMatters.size > 0 || row.weeklyCheckIns > 0 || row.expectedStandards > 0)
    .sort((a, b) => standardsOwnerSort(a.owner, b.owner) || a.date.localeCompare(b.date))
    .map((row) => {
      const expected = row.expectedStandards;
      const completed = row.attorneyCall + row.welcome + row.courtDate + row.weeklyCheckIns;
      const score = expected ? `${Math.round((completed / expected) * 100)}%` : "0%";
      return {
        owner: row.owner,
        newMatters: row.newMatters.size,
        attorneyCall: row.attorneyCall,
        welcome: row.welcome,
        courtDate: row.courtDate,
        weeklyCheckIns: row.weeklyCheckIns,
        completion: score,
        date: csvDisplayDate(row.date),
        sortDate: row.date,
      };
    });

  return { rows, unmappedMatters: unmappedMatters.size, unmappedAttorneys };
}

export async function standardsReportRows(filters: DashboardFilters = {}): Promise<StandardsReportRow[]> {
  return (await standardsReport(filters)).rows;
}

/** When Clio was last actually walked, which is not when this data was last displayed. A run still in
 *  flight has audited nothing yet, and a failed one left the rows as they were, so only a completed
 *  run counts. */
export async function lastCompletedAuditAt(): Promise<Date | null> {
  await initDb();
  const rows = await db()<Array<{ finished_at: string | Date | null }>>`
    select finished_at
    from audit_run
    where status = 'completed' and finished_at is not null
    order by finished_at desc
    limit 1
  `;
  const finishedAt = rows[0]?.finished_at ?? null;
  if (!finishedAt) return null;
  const parsed = new Date(finishedAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function standardsCsv(filters: DashboardFilters = {}): Promise<string> {
  const rows = await standardsReportRows(filters);
  const csvRows = rows.map((row) => [
    row.owner,
    row.date,
    row.newMatters,
    row.attorneyCall,
    row.welcome,
    row.courtDate,
    row.weeklyCheckIns,
    row.completion,
  ]);

  return [STANDARDS_HEADERS, ...csvRows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlCell(value: unknown, type: "String" | "Number" = "String", style = "", extraAttrs = ""): string {
  const styleAttr = style ? ` ss:StyleID="${style}"` : "";
  const attrs = extraAttrs ? ` ${extraAttrs}` : "";
  return `<Cell${styleAttr}${attrs}><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`;
}

function xmlBlankCell(style = "", extraAttrs = ""): string {
  const styleAttr = style ? ` ss:StyleID="${style}"` : "";
  const attrs = extraAttrs ? ` ${extraAttrs}` : "";
  return `<Cell${styleAttr}${attrs}/>`;
}

function coreStatusStyle(status: string): string {
  if (status === "MET" || status === "TRACKED") return "StatusGood";
  if (status === "REVIEW") return "StatusBad";
  return "StatusNeutral";
}

function worksheetName(name: string): string {
  const cleaned = (name || "Unassigned").replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Unassigned").slice(0, 31);
}

export async function standardsWorkbook(filters: DashboardFilters = {}): Promise<string> {
  const rows = await standardsReportRows(filters);
  const owners = [...STANDARD_CASE_MANAGERS];
  const workbookFrom = filters.from ? csvDisplayDate(filters.from) : "";
  const workbookTo = filters.to ? csvDisplayDate(filters.to) : "";
  const sheets = owners.map((owner) => {
    const ownerRows = rows.filter((row) => row.owner === owner).sort((a, b) => a.sortDate.localeCompare(b.sortDate));
    const scorecard = buildStandardsScorecard(owner, ownerRows, { from: workbookFrom, to: workbookTo });
    const [phoneCall, welcomeLetters, courtDateEvent, weeklyCheckIns] = scorecard.coreStandards;
    const headerRows = [
      `<Row ss:Height="34">${xmlCell("CASE MANAGER STANDARDS SCORECARD", "String", "Title", 'ss:MergeAcross="7"')}</Row>`,
      `<Row ss:Height="24">${xmlCell("At-a-glance review of daily activity", "String", "Subtitle", 'ss:MergeAcross="7"')}</Row>`,
      `<Row ss:Height="8">${xmlBlankCell("Spacer", 'ss:MergeAcross="7"')}</Row>`,
      `<Row ss:Height="22">${[
        xmlCell("CASE MANAGER", "String", "DarkHeader", 'ss:MergeAcross="1"'),
        xmlCell("START DATE", "String", "DarkHeader", 'ss:MergeAcross="1"'),
        xmlCell("END DATE", "String", "DarkHeader", 'ss:MergeAcross="1"'),
        xmlCell("TARGET", "String", "DarkHeader", 'ss:MergeAcross="1"'),
      ].join("")}</Row>`,
      `<Row ss:Height="28">${[
        xmlCell(scorecard.owner, "String", "InputBlue", 'ss:MergeAcross="1"'),
        xmlCell(scorecard.period.from || "Selected range", "String", "InputBlue", 'ss:MergeAcross="1"'),
        xmlCell(scorecard.period.to || "Selected range", "String", "InputBlue", 'ss:MergeAcross="1"'),
        xmlCell(scorecard.targetLabel, "String", "InputBlue", 'ss:MergeAcross="1"'),
      ].join("")}</Row>`,
      `<Row ss:Height="8">${xmlBlankCell("Spacer", 'ss:MergeAcross="7"')}</Row>`,
      `<Row ss:Height="28">${[
        xmlCell("OVERALL COMPLIANCE", "String", "TileBlue", 'ss:MergeAcross="1"'),
        xmlCell("STANDARDS TARGETS MET", "String", "TileTeal", 'ss:MergeAcross="1"'),
        xmlCell("CASES HANDLED", "String", "TileNavy", 'ss:MergeAcross="1"'),
        xmlCell("FOLLOW-UP ITEMS", "String", "TileCopper", 'ss:MergeAcross="1"'),
      ].join("")}</Row>`,
      `<Row ss:Height="54">${[
        xmlCell(scorecard.overallCompliance, "String", "TileBlueBig", 'ss:MergeAcross="1"'),
        xmlCell(scorecard.targetsMet, "String", "TileTealBig", 'ss:MergeAcross="1"'),
        xmlCell(scorecard.casesHandled, "Number", "TileNavyBig", 'ss:MergeAcross="1"'),
        xmlCell(scorecard.followUpItems, "Number", "TileCopperBig", 'ss:MergeAcross="1"'),
      ].join("")}</Row>`,
      `<Row ss:Height="22">${[
        xmlCell(scorecard.verdict, "String", "TileBlueFooter", 'ss:MergeAcross="1"'),
        xmlCell(`Target threshold: ${scorecard.targetLabel}`, "String", "TileTealFooter", 'ss:MergeAcross="1"'),
        xmlCell(`${scorecard.weeklyCheckIns} weekly check-ins`, "String", "TileNavyFooter", 'ss:MergeAcross="1"'),
        xmlCell("Lower is better", "String", "TileCopperFooter", 'ss:MergeAcross="1"'),
      ].join("")}</Row>`,
      `<Row ss:Height="8">${xmlBlankCell("Spacer", 'ss:MergeAcross="7"')}</Row>`,
      `<Row ss:Height="24">${xmlCell("CORE STANDARDS", "String", "Section", 'ss:MergeAcross="4"')}${xmlBlankCell()}${xmlCell("SCORE NOTES", "String", "Section", 'ss:MergeAcross="1"')}</Row>`,
      `<Row ss:Height="24">${[
        xmlCell("STANDARD", "String", "SmallHeader", 'ss:MergeAcross="1"'),
        xmlCell("ACTUAL", "String", "SmallHeader"),
        xmlCell("REQUIRED", "String", "SmallHeader"),
        xmlCell("STATUS", "String", "SmallHeader"),
        xmlBlankCell(),
        xmlCell("PERIOD", "String", "SmallHeader", 'ss:MergeAcross="1"'),
      ].join("")}</Row>`,
      `<Row ss:Height="24">${[
        xmlCell(phoneCall.name, "String", "LinkLike", 'ss:MergeAcross="1"'),
        xmlCell(phoneCall.actual, "Number", "Actual"),
        xmlCell(phoneCall.required, "Number", "Required"),
        xmlCell(phoneCall.status, "String", coreStatusStyle(phoneCall.status)),
        xmlBlankCell(),
        xmlCell(scorecard.periodLabel, "String", "Note", 'ss:MergeAcross="1"'),
      ].join("")}</Row>`,
      `<Row ss:Height="24">${[
        xmlCell(welcomeLetters.name, "String", "LinkLike", 'ss:MergeAcross="1"'),
        xmlCell(welcomeLetters.actual, "Number", "Actual"),
        xmlCell(welcomeLetters.required, "Number", "Required"),
        xmlCell(welcomeLetters.status, "String", coreStatusStyle(welcomeLetters.status)),
        xmlBlankCell(),
        xmlCell("Each new matter should have matching proof.", "String", "Note", 'ss:MergeAcross="1"'),
      ].join("")}</Row>`,
      `<Row ss:Height="24">${[
        xmlCell(courtDateEvent.name, "String", "LinkLike", 'ss:MergeAcross="1"'),
        xmlCell(courtDateEvent.actual, "Number", "Actual"),
        xmlCell(courtDateEvent.required, "Number", "Required"),
        xmlCell(courtDateEvent.status, "String", coreStatusStyle(courtDateEvent.status)),
        xmlBlankCell(),
        xmlCell("Court date means the client court event was made in Clio.", "String", "Note", 'ss:MergeAcross="1"'),
      ].join("")}</Row>`,
      `<Row ss:Height="24">${[
        xmlCell(weeklyCheckIns.name, "String", "LinkLike", 'ss:MergeAcross="1"'),
        xmlCell(weeklyCheckIns.actual, "Number", "Actual"),
        xmlCell(weeklyCheckIns.required, "String", "Required"),
        xmlCell(weeklyCheckIns.status, "String", coreStatusStyle(weeklyCheckIns.status)),
        xmlBlankCell(),
        xmlCell("Ongoing-case check-ins are included when due.", "String", "Note", 'ss:MergeAcross="1"'),
      ].join("")}</Row>`,
      `<Row ss:Height="8">${xmlBlankCell("Spacer", 'ss:MergeAcross="7"')}</Row>`,
      `<Row ss:Height="24">${xmlCell("DAILY ACTIVITY ROWS", "String", "Section", 'ss:MergeAcross="7"')}</Row>`,
    ].join("");
    const tableRows = [
      `<Row ss:Height="24">${STANDARDS_HEADERS.map((header) => xmlCell(header, "String", "SmallHeader")).join("")}</Row>`,
      ...ownerRows.map((row) =>
        `<Row ss:Height="22">${[
          xmlCell(row.owner, "String", "TableCell"),
          xmlCell(row.date, "String", "TableCell"),
          xmlCell(row.newMatters, "Number", "TableNumber"),
          xmlCell(row.attorneyCall, "Number", "TableNumber"),
          xmlCell(row.welcome, "Number", "TableNumber"),
          xmlCell(row.courtDate, "Number", "TableNumber"),
          xmlCell(row.weeklyCheckIns, "Number", "TableNumber"),
          xmlCell(row.completion, "String", row.completion === "100%" ? "PercentGood" : "PercentReview"),
        ].join("")}</Row>`,
      ),
      ownerRows.length ? "" : `<Row ss:Height="22">${xmlCell(owner, "String", "TableCell")}${xmlCell("No activity", "String", "TableCell", 'ss:MergeAcross="6"')}</Row>`,
    ].join("");
    return `
      <Worksheet ss:Name="${xmlEscape(worksheetName(owner))}">
        <Table ss:DefaultRowHeight="20">
          <Column ss:Width="120"/>
          <Column ss:Width="100"/>
          <Column ss:Width="150"/>
          <Column ss:Width="180"/>
          <Column ss:Width="160"/>
          <Column ss:Width="170"/>
          <Column ss:Width="180"/>
          <Column ss:Width="160"/>
          ${headerRows}
          ${tableRows}
        </Table>
        <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
          <FreezePanes/>
          <FrozenNoSplit/>
          <SplitHorizontal>21</SplitHorizontal>
          <TopRowBottomPane>21</TopRowBottomPane>
          <ActivePane>2</ActivePane>
          <Panes>
            <Pane><Number>3</Number></Pane>
            <Pane><Number>2</Number></Pane>
          </Panes>
        </WorksheetOptions>
      </Worksheet>`;
  }).join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal">
      <Alignment ss:Vertical="Center"/>
      <Font ss:FontName="Arial" ss:Size="10"/>
    </Style>
    <Style ss:ID="Title">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Font ss:FontName="Arial" ss:Size="20" ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#082344" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="Subtitle">
      <Alignment ss:Vertical="Center"/>
      <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Italic="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#255D89" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="DarkHeader">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#082344" ss:Pattern="Solid"/>
      <Borders><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D8E5F4"/></Borders>
    </Style>
    <Style ss:ID="InputBlue">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Font ss:FontName="Arial" ss:Size="11" ss:Bold="1" ss:Color="#0000FF"/>
      <Interior ss:Color="#E8F1FA" ss:Pattern="Solid"/>
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#2A5B84"/></Borders>
    </Style>
    <Style ss:ID="Section">
      <Alignment ss:Vertical="Center"/>
      <Font ss:FontName="Arial" ss:Size="12" ss:Bold="1" ss:Color="#FFFFFF"/>
      <Interior ss:Color="#082344" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="SmallHeader">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#123E63"/>
      <Interior ss:Color="#E3EDF6" ss:Pattern="Solid"/>
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#C9D5E2"/></Borders>
    </Style>
    <Style ss:ID="TileBlue"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#255D89" ss:Pattern="Solid"/></Style>
    <Style ss:ID="TileBlueBig"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="24" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#255D89" ss:Pattern="Solid"/></Style>
    <Style ss:ID="TileBlueFooter"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="9" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#255D89" ss:Pattern="Solid"/></Style>
    <Style ss:ID="TileTeal"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#247A84" ss:Pattern="Solid"/></Style>
    <Style ss:ID="TileTealBig"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="24" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#247A84" ss:Pattern="Solid"/></Style>
    <Style ss:ID="TileTealFooter"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="9" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#247A84" ss:Pattern="Solid"/></Style>
    <Style ss:ID="TileNavy"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#082344" ss:Pattern="Solid"/></Style>
    <Style ss:ID="TileNavyBig"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="24" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#082344" ss:Pattern="Solid"/></Style>
    <Style ss:ID="TileNavyFooter"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="9" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#082344" ss:Pattern="Solid"/></Style>
    <Style ss:ID="TileCopper"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#CF5A12" ss:Pattern="Solid"/></Style>
    <Style ss:ID="TileCopperBig"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="24" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#CF5A12" ss:Pattern="Solid"/></Style>
    <Style ss:ID="TileCopperFooter"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="9" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#CF5A12" ss:Pattern="Solid"/></Style>
    <Style ss:ID="LinkLike"><Font ss:FontName="Arial" ss:Size="10" ss:Color="#0A4A7A" ss:Underline="Single"/><Interior ss:Color="#F7FAFC" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Actual"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1"/><Interior ss:Color="#E5F3E6" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Required"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Arial" ss:Size="10"/><Interior ss:Color="#F7FAFC" ss:Pattern="Solid"/></Style>
    <Style ss:ID="Note"><Font ss:FontName="Arial" ss:Size="9" ss:Color="#123E63"/><Interior ss:Color="#F7FAFC" ss:Pattern="Solid"/></Style>
    <Style ss:ID="StatusGood"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#0F5132"/><Interior ss:Color="#DDF4E7" ss:Pattern="Solid"/></Style>
    <Style ss:ID="StatusBad"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#B42318"/><Interior ss:Color="#FDE7E4" ss:Pattern="Solid"/></Style>
    <Style ss:ID="StatusNeutral"><Alignment ss:Horizontal="Center"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#1F2937"/><Interior ss:Color="#EDF2F7" ss:Pattern="Solid"/></Style>
    <Style ss:ID="TableCell"><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#0F172A"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7E2EE"/></Borders></Style>
    <Style ss:ID="TableNumber"><Alignment ss:Horizontal="Right"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#0F172A"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7E2EE"/></Borders></Style>
    <Style ss:ID="PercentGood"><Alignment ss:Horizontal="Right"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#047857"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7E2EE"/></Borders></Style>
    <Style ss:ID="PercentReview"><Alignment ss:Horizontal="Right"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1" ss:Color="#B42318"/><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D7E2EE"/></Borders></Style>
    <Style ss:ID="Spacer"><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/></Style>
  </Styles>
  ${sheets}
</Workbook>`;
}

export type WeeklyComplianceComparisonRow = {
  caseManager: string;
  category: string;
  previousWeek: number;
  currentWeek: number;
  change: number;
};

export type WeeklyComplianceComparisonSection = {
  caseManager: string;
  currentWeekLabel: string;
  previousWeekLabel: string;
  rows: WeeklyComplianceComparisonRow[];
};

type WeeklyComplianceCategory = {
  id: string;
  label: string;
  stepCodes?: string[];
  reasonCodes?: string[];
  excludeReasonCodes?: string[];
  uniqueMatters?: boolean;
};

export const WEEKLY_COMPLIANCE_CATEGORIES: WeeklyComplianceCategory[] = [
  { id: "welcome", label: "Welcome letters missing", stepCodes: ["SETUP_WELCOME"] },
  { id: "attorney_call", label: "Attorney phone calls for new Clio matters not scheduled", stepCodes: ["SETUP_ATTY_CALL"] },
  { id: "appearance", label: "Court Appearance Filed template emails missing", stepCodes: ["APPEARANCE_FILING"] },
  { id: "weekly_checkin", label: "Weekly client check-ins not completed", stepCodes: ["WEEKLY_CLIENT_CHECKIN"] },
  { id: "results_calls", label: "Results calls not completed", stepCodes: ["POST_COURT_CALL"] },
  { id: "court_results", label: "Court Results template emails missing", stepCodes: ["COURT_RESULTS"] },
  {
    id: "court_reminder_template",
    label: "Court reminder template emails missing",
    stepCodes: ["COURT_REMINDER_CALL"],
    reasonCodes: ["REMINDER_TEMPLATE_NOT_FOUND_PRE_COURT"],
  },
];

function weekStartDateKey(baseDate: Date): string {
  const localKey = csvDateKey(baseDate);
  const localNoon = new Date(`${localKey}T12:00:00`);
  const day = localNoon.getDay();
  localNoon.setDate(localNoon.getDate() - ((day + 6) % 7));
  return csvDateKey(localNoon);
}

function addDateKeyDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return csvDateKey(date);
}

function comparisonWeekLabel(start: string, end: string): string {
  return `${csvDisplayDate(start)} - ${csvDisplayDate(end)}`;
}

function comparisonDateKey(item: WorkspaceAuditItem): string {
  return csvDateKey(item.deadline_at || item.matter_created_at);
}

function isClearedByHumanReview(item: WorkspaceAuditItem): boolean {
  const result = reviewResult(item.review_decision);
  return result === "Resolved" || result === "Approved Exception";
}

function isIncompleteForWeeklyComparison(item: WorkspaceAuditItem): boolean {
  if (item.metric_excluded || isClearedByHumanReview(item)) return false;
  if (item.deadline_at) {
    const deadline = item.deadline_at instanceof Date ? item.deadline_at : new Date(item.deadline_at);
    if (Number.isFinite(deadline.getTime()) && deadline >= new Date()) return false;
  }
  if (["WEEKLY_CLIENT_CHECKIN", "COURT_REMINDER_CALL"].includes(item.step_code)) {
    if (item.reason_code === "NOT_FOUND") return false;
    if (item.audit_version && item.audit_version !== APP_VERSION) return false;
  }
  return ["Missing", "Unknown", "Needs Review", "Needs Recheck"].includes(item.item_status);
}

function countWeeklyCategory(
  items: WorkspaceAuditItem[],
  caseManager: string,
  category: WeeklyComplianceCategory,
  from: string,
  to: string,
): number {
  const matching = items.filter((item) => {
    if (standardsCaseManagerFor(item) !== caseManager) return false;
    if (!isIncompleteForWeeklyComparison(item)) return false;
    const dateKey = comparisonDateKey(item);
    if (!dateKey || dateKey < from || dateKey > to) return false;
    if (category.stepCodes?.length && !category.stepCodes.includes(item.step_code)) return false;
    if (category.reasonCodes?.length && !category.reasonCodes.includes(item.reason_code ?? "")) return false;
    if (category.excludeReasonCodes?.length && category.excludeReasonCodes.includes(item.reason_code ?? "")) return false;
    return true;
  });

  if (!category.uniqueMatters) return matching.length;
  return new Set(matching.map((item) => item.matter_id)).size;
}

export function weeklyComplianceComparisonRows(
  items: WorkspaceAuditItem[],
  baseDate: Date = new Date(),
  useLastCompletedWeek = true,
): WeeklyComplianceComparisonSection[] {
  const anchorStart = weekStartDateKey(baseDate);
  const currentStart = useLastCompletedWeek ? addDateKeyDays(anchorStart, -7) : anchorStart;
  const currentEnd = addDateKeyDays(currentStart, 6);
  const previousStart = addDateKeyDays(currentStart, -7);
  const previousEnd = addDateKeyDays(currentStart, -1);
  const owners = Array.from(new Set([...STANDARD_CASE_MANAGERS, ...items.map(standardsCaseManagerFor)]))
    .filter(Boolean)
    .sort(standardsOwnerSort);

  return owners.map((caseManager) => ({
    caseManager,
    currentWeekLabel: comparisonWeekLabel(currentStart, currentEnd),
    previousWeekLabel: comparisonWeekLabel(previousStart, previousEnd),
    rows: WEEKLY_COMPLIANCE_CATEGORIES.map((category) => {
      const previousWeek = countWeeklyCategory(items, caseManager, category, previousStart, previousEnd);
      const currentWeek = countWeeklyCategory(items, caseManager, category, currentStart, currentEnd);
      return {
        caseManager,
        category: category.label,
        previousWeek,
        currentWeek,
        change: currentWeek - previousWeek,
      };
    }),
  }));
}

export async function weeklyComplianceComparisonCsv(filters: DashboardFilters = {}): Promise<string> {
  const { workspaceItems } = await getDashboardData({});
  const baseDate = filters.to ? new Date(`${filters.to}T12:00:00`) : new Date();
  const sections = weeklyComplianceComparisonRows(workspaceItems, baseDate, !filters.to);
  const rows = sections.flatMap((section) => [
    [section.caseManager, "", "", "", ""],
    ["Compliance Category", `Previous Week (${section.previousWeekLabel})`, `Current Week (${section.currentWeekLabel})`, "Change", "Meaning"],
    ...section.rows.map((row) => [
      row.category,
      row.previousWeek,
      row.currentWeek,
      row.change > 0 ? `+${row.change}` : String(row.change),
      row.change < 0 ? "Improved" : row.change > 0 ? "Needs attention" : "No change",
    ]),
    ["", "", "", "", ""],
  ]);

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function textLine(label: string, value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text ? `${label}: ${text}` : "";
}

function clientMatterName(row: ActionCsvRow): string {
  return `${row.client_first_name ?? ""} ${row.client_last_name ?? ""}`.trim() || row.matter_number;
}

function reportDateRange(filters: DashboardFilters): string {
  if (filters.from && filters.to) return `${filters.from} through ${filters.to}`;
  if (filters.from) return `${filters.from} and later`;
  if (filters.to) return `through ${filters.to}`;
  return "all open audited matters";
}

function matterMissingItemLabel(stepCode: string, attorneyName?: string | null): string {
  if (!attorneyName) return "Responsible attorney missing/needs update";
  switch (stepCode) {
    case "SETUP_ATTY_CALL":
      return "Calendar event missing";
    case "SETUP_WELCOME":
      return "Welcome letter not found";
    case "APPEARANCE_FILING":
      return "Appearance filing follow-up needed";
    case "COURT_RESULTS":
      return "Court results not sent/recorded";
    case "SETUP_COURT_DATE":
      return "Court/hearing calendar event missing";
    case "CLIENT_CONTACT":
      return "Client contact proof missing";
    case "POST_COURT_CALL":
      return "Post-court call missing";
    case "CLIENT_FOLLOWUP":
      return "Client follow-up review needed";
    case "WEEKLY_CLIENT_CHECKIN":
      return "Weekly client check-in call proof needed";
    default:
      return `${workflowLabel(stepCode)} follow-up needed`;
  }
}

function matterActionItem(stepCode: string): string {
  switch (stepCode) {
    case "SETUP_ATTY_CALL":
      return "Add the required calendar event";
    case "SETUP_WELCOME":
      return "Send the welcome letter if not already sent";
    case "APPEARANCE_FILING":
      return "Confirm/file the appearance";
    case "COURT_RESULTS":
      return "Send court results to the client and add them to matter notes";
    case "SETUP_COURT_DATE":
      return "Add or verify that the court/hearing event is on the matter";
    case "CLIENT_CONTACT":
      return "Check whether client contact was completed and logged";
    case "POST_COURT_CALL":
      return "Schedule or verify the post-court attorney call";
    case "CLIENT_FOLLOWUP":
      return "Review the message thread and respond or coach as needed";
    case "WEEKLY_CLIENT_CHECKIN":
      return "Verify the weekly check-in event and confirm the client call by the court-based due date";
    default:
      return actionFor(stepCode, "Missing");
  }
}

function alertDescription(row: ActionCsvRow): string {
  const status = String(row.item_status ?? "");
  const area = workflowLabel(row.step_code);
  if (status === "Late") return `Timing Review: ${area} was completed after the expected timeframe.`;
  if (status === "Unknown") return `Flagged Matter: ${area} could not be confirmed from the available Clio proof.`;
  return `Alert: ${area} was not completed within the required timeframe.`;
}

function whatHappened(row: ActionCsvRow): string {
  const status = String(row.item_status ?? "");
  const area = workflowLabel(row.step_code);
  if (status === "Late") {
    return `${area} proof was found in Clio, but it appears to have happened after the target time.`;
  }
  if (status === "Unknown") {
    return `${area} needs review because CWCA could not clearly confirm the proof from Clio.`;
  }
  return `${area} is still flagged because CWCA did not find matching proof in Clio.`;
}

function whatTeamDid(row: ActionCsvRow, origin: string): string {
  const reviewNote = row.review_note?.trim();
  const reviewProof = row.proof_reference?.trim();
  if (reviewNote || reviewProof) {
    return [
      reviewNote ? `Reviewer note: ${reviewNote}` : "",
      reviewProof ? `Proof/reference: ${reviewProof}` : "",
    ].filter(Boolean).join(" ");
  }
  const proof = proofPath(origin, row.evidence_source, row.evidence_ref_id);
  if (row.evidence_at) {
    const found = formatCsvDate(row.evidence_at);
    return proof
      ? `Proof was found on ${found}. Proof saved in auditor: ${proof}`
      : `Proof was found on ${found}.`;
  }
  if (String(row.item_status ?? "") === "Unknown") {
    return "No clear proof of completion is available yet. The team should verify the item in Clio.";
  }
  return "No proof of completion has been found yet.";
}

function currentStatus(row: ActionCsvRow): "Complete" | "Pending" | "Still Needs Action" | "In Progress" {
  if (row.review_decision) {
    const result = reviewResult(row.review_decision);
    if (result === "Resolved") return "Complete";
    if (result === "In Progress") return "In Progress";
    if (row.review_decision === "Still Needs Action") return "Still Needs Action";
    return "Pending";
  }
  const status = String(row.item_status ?? "");
  if (row.evidence_at || status === "Late") return "Complete";
  if (status === "Unknown") return "Pending";
  return "Still Needs Action";
}

function priorityRank(row: ActionCsvRow): number {
  const status = String(row.item_status ?? "");
  if (status === "Missing") return 1;
  if (status === "Unknown") return 2;
  if (status === "Late") return 3;
  return 4;
}

export async function caseManagerTodoText(filters: DashboardFilters = {}, origin = ""): Promise<string> {
  const rows = await getActionRows(filters);
  const generated = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
  const lines = [
    "End-of-Week Clio Case Manager Audit Report",
    `Generated: ${generated}`,
    `Date Range: ${reportDateRange(filters)}`,
    "Use this report for internal workflow follow-up. Open Clio, verify the item, and keep case details in Clio.",
    "",
  ];

  if (!rows.length) {
    lines.push("Priority Summary");
    lines.push("* No alerts, flagged matters, or needs-action items were found for this report range.");
    return lines.join("\r\n");
  }

  const matters = new Map<string, ActionCsvRow[]>();
  for (const row of rows) {
    const key = `${row.responsible_attorney_name || "Unassigned"}::${row.matter_id}::${row.matter_number}`;
    matters.set(key, [...(matters.get(key) ?? []), row]);
  }

  const sortedMatterGroups = Array.from(matters.values()).sort((a, b) => {
    const aRank = Math.min(...a.map(priorityRank));
    const bRank = Math.min(...b.map(priorityRank));
    return aRank - bRank || clientMatterName(a[0]).localeCompare(clientMatterName(b[0]));
  });
  const allItems = rows.slice().sort((a, b) => priorityRank(a) - priorityRank(b));
  const completedItems = allItems.filter((row) => currentStatus(row) === "Complete");
  const openItems = allItems.filter((row) => currentStatus(row) !== "Complete");

  lines.push("Priority Summary");
  lines.push(`* Flagged matters reviewed: ${matters.size}`);
  lines.push(`* Items still needing action: ${openItems.length}`);
  lines.push(`* Completed late/resolved items: ${completedItems.length}`);
  const topItems = openItems.slice(0, 5);
  if (topItems.length) {
    lines.push("* Highest-priority follow-up:");
    for (const row of topItems) {
      lines.push(`  - ${clientMatterName(row)}: ${alertDescription(row)}`);
    }
  }
  lines.push("");
  lines.push("Flagged Matters");
  lines.push("");

  let reportIndex = 0;
  for (const matterRows of sortedMatterGroups) {
    reportIndex += 1;
    const first = matterRows[0];
    const attorney = first.responsible_attorney_name || "Unassigned";
    const caseManager = first.case_manager_name || "Not entered";
    lines.push(`${reportIndex}. Matter: ${clientMatterName(first)}`);
    lines.push(`   Attorney: ${attorney}`);
    lines.push(`   Case Manager: ${caseManager}`);
    lines.push(`   Matter Number: ${first.matter_number}`);
    lines.push(`   Clio Link: ${clioMatterLink(String(first.matter_id))}`);
    lines.push("");
    for (const row of matterRows.sort((a, b) => priorityRank(a) - priorityRank(b))) {
      lines.push(`   Alert / Flag: ${alertDescription(row)}`);
      lines.push("");
      lines.push("   Flagged Matter & What Happened:");
      lines.push(`   ${whatHappened(row)}`);
      lines.push("");
      lines.push("   What the Team Did:");
      lines.push(`   ${whatTeamDid(row, origin)}`);
      lines.push("");
      lines.push("   Current Status:");
      lines.push(`   ${currentStatus(row)}`);
      lines.push("");
      lines.push("   Next Step:");
      lines.push(`   ${matterActionItem(row.step_code)}`);
      if (row.deadline_at) lines.push(`   Due: ${formatCsvDate(row.deadline_at)}`);
      lines.push("");
    }
  }

  lines.push("Completed Items");
  if (!completedItems.length) {
    lines.push("* No completed flagged items were found in this report range.");
  } else {
    for (const row of completedItems) {
      lines.push(`* ${clientMatterName(row)} - ${workflowLabel(row.step_code)}: Complete`);
    }
  }
  lines.push("");
  lines.push("Items Still Needing Action");
  if (!openItems.length) {
    lines.push("* No items still need action.");
  } else {
    for (const row of openItems) {
      lines.push(`* ${clientMatterName(row)} - ${workflowLabel(row.step_code)}: ${currentStatus(row)}. Next step: ${matterActionItem(row.step_code)}`);
    }
  }

  return lines.join("\r\n");
}

