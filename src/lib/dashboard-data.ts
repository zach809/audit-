import { APP_TZ } from "./config";
import { initDb, db } from "./db";
import { workflowLabel } from "./workflow-rules";
import { actionFor, displayAuditStatus, priorityFor, timingGoalFor, whyFlagged } from "./audit-display";

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
};

export type WorkspaceAuditItem = {
  matter_id: string;
  matter_number: string;
  client_first_name: string | null;
  client_last_name: string | null;
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

export async function getDashboardData(filters: DashboardFilters = {}) {
  await initDb();
  const sql = db();
  const overallCondition =
    filters.overall === "Unchecked"
      ? sql`not exists (select 1 from audit_item filter_item where filter_item.matter_id = m.matter_id)`
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

  const matters = await sql`
    select
      m.*,
      case
        when count(i.*) = 0 then 'Unchecked'
        when count(*) filter (where (
          case
            when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
              then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
            else i.status
          end
        ) = 'Unknown') > 0 then 'Review'
        when count(*) filter (where (
          case
            when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
              then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
            else i.status
          end
        ) = 'Missing') > 0 then 'Flag'
        when count(*) filter (where (
          case
            when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
              then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
            else i.status
          end
        ) = 'Late') > 0 then 'Late'
        when count(*) filter (where (
          case
            when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
              then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
            else i.status
          end
        ) = 'Pending') > 0 then 'Pending'
        else m.overall_status
      end as display_overall_status,
      coalesce(json_agg(
        json_build_object(
          'stepCode', i.step_code,
          'status',
            case
              when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
                then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
              else i.status
            end,
          'operationalState',
            case
              when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
                then case when i.deadline_at is not null and now() <= i.deadline_at then 'Needs Court Results' else 'Overdue' end
              else i.operational_state
            end,
          'deadlineAt', i.deadline_at,
          'evidenceAt', i.evidence_at,
          'evidenceSource', i.evidence_source,
          'evidenceRefId', i.evidence_ref_id,
          'evidenceUrl', i.evidence_url,
          'reasonCode',
            case
              when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
                then case when i.deadline_at is not null and now() <= i.deadline_at then null else 'NOT_FOUND' end
              else i.reason_code
            end
        )
        order by i.step_code
      ) filter (where i.step_code is not null), '[]') as items
    from audit_matter m
    left join audit_item i on i.matter_id = m.matter_id
    where ${conditions[0]} and ${conditions[1]} and ${conditions[2]} and ${conditions[3]} and ${conditions[4]} and ${conditions[5]} and ${conditions[6]}
      and exists (
        select 1
        from audit_item visible_item
        where visible_item.matter_id = m.matter_id
      )
    group by m.matter_id
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
          when count(i.*) = 0 then 'Unchecked'
          when count(*) filter (where (
            case
              when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
                then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
              else i.status
            end
          ) = 'Unknown') > 0 then 'Review'
          when count(*) filter (where (
            case
              when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
                then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
              else i.status
            end
          ) = 'Missing') > 0 then 'Flag'
          when count(*) filter (where (
            case
              when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
                then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
              else i.status
            end
          ) = 'Late') > 0 then 'Late'
          when count(*) filter (where (
            case
              when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
                then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
              else i.status
            end
          ) = 'Pending') > 0 then 'Pending'
          else m.overall_status
        end as display_overall_status,
        count(i.*) filter (where (
          case
            when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
              then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
            else i.status
          end
        ) = 'Missing')::int as missing_items,
        count(i.*) filter (where (
          case
            when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
              then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
            else i.status
          end
        ) = 'Late')::int as late_items,
        count(i.*) filter (where (
          case
            when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
              then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
            else i.status
          end
        ) = 'Unknown')::int as unknown_items
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
      m.responsible_attorney_id,
      m.responsible_attorney_name,
      i.step_code,
      case
        when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
          then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
        else i.status
      end as item_status,
      i.deadline_at,
      i.evidence_at,
      i.evidence_source,
      i.evidence_ref_id,
      i.evidence_url,
      case
        when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
          then case when i.deadline_at is not null and now() <= i.deadline_at then null else 'NOT_FOUND' end
        else i.reason_code
      end as reason_code
    from audit_matter m
    join audit_item i on i.matter_id = m.matter_id
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
    "Welcome Packet",
    "Attorney Call",
    "Court Date Added",
    "Client Contact",
    "Appearance Filed",
    "Court Results",
    "Post-Court Call",
    "Client Follow-Up",
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
        case
          when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
            then case when i.deadline_at is not null and now() <= i.deadline_at then 'Pending' else 'Missing' end
          else i.status
        end as item_status,
        i.deadline_at,
        i.evidence_at,
        i.evidence_source,
        i.evidence_ref_id,
        case
          when i.step_code = 'COURT_RESULTS' and i.reason_code like 'NOTES_400:%'
            then case when i.deadline_at is not null and now() <= i.deadline_at then null else 'NOT_FOUND' end
          else i.reason_code
        end as reason_code
      from audit_matter m
      join audit_item i on i.matter_id = m.matter_id
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
    "Priority",
    "Client",
    "Matter",
    "Overall",
    "Improvement Area",
    "Status",
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
      priorityFor(status),
      `${row.client_first_name ?? ""} ${row.client_last_name ?? ""}`.trim(),
      row.matter_number,
      row.overall_status,
      workflowLabel(row.step_code),
      humanStatus(status),
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
      return "Welcome packet not found";
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
    default:
      return `${workflowLabel(stepCode)} follow-up needed`;
  }
}

function matterActionItem(stepCode: string): string {
  switch (stepCode) {
    case "SETUP_ATTY_CALL":
      return "Add the required calendar event";
    case "SETUP_WELCOME":
      return "Send the welcome packet if not already sent";
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
    default:
      return actionFor(stepCode, "Missing");
  }
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
    "Case Manager Audit - Missing Items Review",
    `Generated: ${generated}`,
    `Date Range: ${reportDateRange(filters)}`,
    "Please review the matters below and complete all missing items in Clio.",
    "",
  ];

  if (!rows.length) {
    lines.push("No open-matter missing, late, or review items were found for this report.");
    return lines.join("\r\n");
  }

  const matters = new Map<string, ActionCsvRow[]>();
  for (const row of rows) {
    const key = `${row.responsible_attorney_name || "Unassigned"}::${row.matter_id}::${row.matter_number}`;
    matters.set(key, [...(matters.get(key) ?? []), row]);
  }

  let reportIndex = 0;
  for (const matterRows of matters.values()) {
    reportIndex += 1;
    const first = matterRows[0];
    const attorney = first.responsible_attorney_name || "Unassigned";
    const missingItems = Array.from(new Set(matterRows.map((row) => matterMissingItemLabel(row.step_code, row.responsible_attorney_name))));
    const actions = Array.from(new Set(matterRows.map((row) => matterActionItem(row.step_code))));
    const proofLines = matterRows.map((row) => {
      const parts = [
        workflowLabel(row.step_code),
        humanStatus(String(row.item_status ?? "")),
        whyFlagged(row.step_code, String(row.item_status ?? ""), row.reason_code),
        textLine("Due", formatCsvDate(row.deadline_at)),
        textLine("Found", formatCsvDate(row.evidence_at)),
        textLine("Proof", proofPath(origin, row.evidence_source, row.evidence_ref_id)),
      ].filter(Boolean);
      return `* ${parts.join(" | ")}`;
    });

    lines.push(`${reportIndex}. Attorney: ${attorney}`);
    lines.push(`   Client/Matter: ${clientMatterName(first)}`);
    lines.push(`   Matter Number: ${first.matter_number}`);
    lines.push(`   Clio Link: ${clioMatterLink(String(first.matter_id))}`);
    lines.push("");
    lines.push("Missing Item(s):");
    for (const item of missingItems) lines.push(`* ${item}`);
    lines.push("");
    lines.push("Action Needed:");
    for (const item of actions) lines.push(`* ${item}`);
    lines.push("");
    lines.push("Proof of Completion Required:");
    lines.push("Please reply in this thread for each matter once completed. Include:");
    lines.push("* Client/matter name");
    lines.push("* What was completed");
    lines.push("* Proof of completion, such as a screenshot, confirmation note, or Clio update confirmation");
    lines.push("");
    lines.push("CWCA Audit Notes:");
    for (const item of proofLines) lines.push(item);
    lines.push("");
  }

  lines.push("Audit Areas to Fine-Tune in the App Report:");
  lines.push("");
  lines.push("1. Welcome Packet");
  lines.push("Requirement: Send within 2 business hours of a new matter being created.");
  lines.push("If flagged: Check or send the Welcome Letter / Carta de Bienvenida template.");
  lines.push("");
  lines.push("2. Court Date Added");
  lines.push("Requirement: Add within 2 business hours.");
  lines.push("If flagged: Add or verify that the court/hearing/plea/status/continuance calendar event is added to the matter.");
  lines.push("");
  lines.push("3. Client Contact");
  lines.push("Requirement: Complete by the next business day at 5:00 PM.");
  lines.push("If flagged: Check whether an email was sent or communication was logged with the client.");
  lines.push("Clarification: There should be proof that the client was contacted, either through an email, phone call log, or communication note.");
  lines.push("");
  lines.push("4. Post-Court Call");
  lines.push("Requirement: Schedule or complete within 24 hours after court results are received, if the case continues.");
  lines.push("Clarification: There should be a calendar event showing that a post-court phone call with the attorney exists.");
  lines.push("If flagged: Schedule or verify the post-court attorney call after court results are received, if the case continues.");

  return lines.join("\r\n");
}
