import { APP_TZ } from "./config";
import { initDb, db } from "./db";
import { workflowLabel } from "./workflow-rules";
import { actionFor, displayAuditStatus, priorityFor, timingGoalFor, whyFlagged } from "./audit-display";
import { reviewResult } from "./review-shared";

export type DashboardFilters = {
  attorney?: string;
  overall?: string;
  from?: string;
  to?: string;
};

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
    filters.attorney ? sql`m.responsible_attorney_id = ${filters.attorney}` : sql`true`,
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
  const normalizedItemStatus = sql`
    case
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
      when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
        then case when i.deadline_at is not null and now() <= i.deadline_at then null else 'NOT_FOUND' end
      when i.step_code = 'APPEARANCE_FILING'
        and i.status = 'Unknown'
        and i.reason_code = 'EVIDENCE_NOT_CONFIRMED'
        then case when i.deadline_at is not null and now() <= i.deadline_at then null else 'NOT_FOUND' end
      else i.reason_code
    end
  `;

  const matters = await sql`
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
          'reviewHistory', coalesce((
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
          ), '[]'::json),
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
    order by
      case m.overall_status when 'Review' then 1 when 'Flag' then 2 when 'Late' then 3 when 'Pending' then 4 else 5 end,
      m.matter_created_at desc
    limit 150
  `;

  const attorneys = await sql`
    select responsible_attorney_id as id, responsible_attorney_name as name, count(*)::int as count
    from audit_matter m
    where ${conditions[0]} and ${conditions[5]} and ${conditions[6]}
    group by responsible_attorney_id, responsible_attorney_name
    order by responsible_attorney_name
  `;

  const summary = await sql`
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
  `;

  const lastRun = await sql`
    select *
    from audit_run
    order by started_at desc
    limit 1
  `;

  const metrics = await sql`
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
  `;

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
    where ${conditions[0]} and ${conditions[1]} and ${conditions[2]} and ${conditions[3]} and ${conditions[4]} and ${conditions[5]} and ${conditions[6]}
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
  `;

  return {
    matters,
    attorneys,
    summary: summary[0] ?? { total: 0, unchecked: 0, pass: 0, pending: 0, late: 0, flag: 0, review: 0, missing_items: 0, late_items: 0, unknown_items: 0 },
    lastRun: lastRun[0] ?? null,
    metrics,
    workspaceItems,
  };
}

export async function dashboardCsv(filters: DashboardFilters = {}): Promise<string> {
  const { matters } = await getDashboardData(filters);
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

function isStandardComplete(status: string | null | undefined, evidenceRefId?: string | null): boolean {
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
  return `${month}/${day}/${String(year).slice(-2)}`;
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

function normalizeOwnerName(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const STANDARD_CASE_MANAGERS = [
  "Alessandra",
  "Anahi",
  "Camila",
  "Claudia",
  "Ivan",
  "Jesus",
  "Lori",
  "Nathaly",
  "Ronald",
  "Svetlana",
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

function isParkCityMatter(item: WorkspaceAuditItem): boolean {
  const text = normalizeOwnerName(`${item.matter_number} ${item.client_first_name ?? ""} ${item.client_last_name ?? ""}`);
  return text.includes("park city") || text.includes("parkcity");
}

export function standardsCaseManagerFor(item: WorkspaceAuditItem): string {
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
  completion: string;
  date: string;
  sortDate: string;
};

const STANDARDS_HEADERS = [
  "Case Manager",
  "Cases / new matters #",
  "Initial Meeting set - Phone call",
  "Welcome letters sent",
  "Court date event made",
  "Workflow completion %",
  "Date",
];

function standardsOwnerSort(a: string, b: string): number {
  const aIndex = STANDARD_CASE_MANAGERS.indexOf(a as (typeof STANDARD_CASE_MANAGERS)[number]);
  const bIndex = STANDARD_CASE_MANAGERS.indexOf(b as (typeof STANDARD_CASE_MANAGERS)[number]);
  if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
  if (aIndex === -1) return 1;
  if (bIndex === -1) return -1;
  return aIndex - bIndex;
}

async function standardsReportRows(filters: DashboardFilters = {}): Promise<StandardsReportRow[]> {
  const { workspaceItems } = await getDashboardData(filters);
  const today = csvDateKey(new Date());
  const from = filters.from || today;
  const to = filters.to || today;
  const dates = eachDateKey(from, to);
  const dateSet = new Set(dates);
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
    };
    rowsByOwnerDate.set(key, current);
    return current;
  };

  const standardsItems = workspaceItems.filter((item) => {
    if (item.metric_excluded) return false;
    if (!isStandardsStep(item.step_code)) return false;
    const createdKey = csvDateKey(item.matter_created_at);
    return Boolean(createdKey) && (!dateSet.size || dateSet.has(createdKey));
  });
  const owners = Array.from(new Set(standardsItems.map(standardsCaseManagerFor))).sort(standardsOwnerSort);
  for (const owner of owners) {
    for (const date of dates) getRow(owner, date);
  }

  for (const item of standardsItems) {
    const owner = standardsCaseManagerFor(item);
    const createdKey = csvDateKey(item.matter_created_at);
    if (!createdKey) continue;
    const row = getRow(owner, createdKey);
    row.assignedAttorneys.add(item.responsible_attorney_name || "Unassigned");
    row.assignmentNotes.add(standardsAssignmentNote(item));
    row.newMatters.add(String(item.matter_id));
    row.expectedStandards += 1;
    const late = item.item_status === "Late";
    const complete = isStandardComplete(item.item_status, item.evidence_ref_id);
    if (!complete) {
      row.needsFollowUp += 1;
      continue;
    }
    row.completedStandards += 1;
    if (late) row.lateStandards += 1;
    else row.onTimeStandards += 1;
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

  return Array.from(rowsByOwnerDate.values())
    .filter((row) => row.newMatters.size > 0)
    .sort((a, b) => standardsOwnerSort(a.owner, b.owner) || a.date.localeCompare(b.date))
    .map((row) => {
      const expected = row.newMatters.size * 3;
      const completed = row.attorneyCall + row.welcome + row.courtDate;
      const score = expected ? `${Math.round((completed / expected) * 100)}%` : "0%";
      return {
        owner: row.owner,
        newMatters: row.newMatters.size,
        attorneyCall: row.attorneyCall,
        welcome: row.welcome,
        courtDate: row.courtDate,
        completion: score,
        date: csvDisplayDate(row.date),
        sortDate: row.date,
      };
    });
}

export async function standardsCsv(filters: DashboardFilters = {}): Promise<string> {
  const rows = await standardsReportRows(filters);
  const csvRows = rows.map((row) => [
    row.owner,
    row.newMatters,
    row.attorneyCall,
    row.welcome,
    row.courtDate,
    row.completion,
    row.date,
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

function xmlCell(value: unknown, type: "String" | "Number" = "String", style = ""): string {
  const styleAttr = style ? ` ss:StyleID="${style}"` : "";
  return `<Cell${styleAttr}><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`;
}

function worksheetName(name: string): string {
  const cleaned = (name || "Unassigned").replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Unassigned").slice(0, 31);
}

export async function standardsWorkbook(filters: DashboardFilters = {}): Promise<string> {
  const rows = await standardsReportRows(filters);
  const ownersWithRows = new Set(rows.map((row) => row.owner));
  const owners = [
    ...STANDARD_CASE_MANAGERS,
    ...Array.from(ownersWithRows).filter((owner) => !STANDARD_CASE_MANAGERS.includes(owner as (typeof STANDARD_CASE_MANAGERS)[number])).sort(),
  ];
  const sheets = owners.map((owner) => {
    const ownerRows = rows.filter((row) => row.owner === owner).sort((a, b) => a.sortDate.localeCompare(b.sortDate));
    const tableRows = [
      `<Row>${STANDARDS_HEADERS.map((header) => xmlCell(header, "String", "Header")).join("")}</Row>`,
      ...ownerRows.map((row) =>
        `<Row>${[
          xmlCell(row.owner),
          xmlCell(row.newMatters, "Number"),
          xmlCell(row.attorneyCall, "Number"),
          xmlCell(row.welcome, "Number"),
          xmlCell(row.courtDate, "Number"),
          xmlCell(row.completion),
          xmlCell(row.date),
        ].join("")}</Row>`,
      ),
    ].join("");
    return `
      <Worksheet ss:Name="${xmlEscape(worksheetName(owner))}">
        <Table>
          <Column ss:Width="110"/>
          <Column ss:Width="130"/>
          <Column ss:Width="160"/>
          <Column ss:Width="140"/>
          <Column ss:Width="140"/>
          <Column ss:Width="135"/>
          <Column ss:Width="90"/>
          ${tableRows}
        </Table>
      </Worksheet>`;
  }).join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#DCEBFF" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  ${sheets}
</Workbook>`;
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
      return "Verify the weekly check-in calendar event and confirm the same-day client call";
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
