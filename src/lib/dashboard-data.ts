import { APP_TZ } from "./config";
import { initDb, db } from "./db";

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

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

const STEP_ACTIONS: Record<string, { label: string; goal: string; missing: string; late: string; unknown: string }> = {
  SETUP_WELCOME: {
    label: "Welcome Packet",
    goal: "Send within 1 business hour of a new matter being created.",
    missing: "Please send or verify the Welcome Letter / Carta de bienvenida template in Clio.",
    late: "Welcome packet was found, but after the 1-business-hour setup goal. Please review intake handoff timing.",
    unknown: "Please recheck this matter before coaching. The app could not confirm the welcome packet from Clio.",
  },
  SETUP_ATTY_CALL: {
    label: "Attorney Call",
    goal: "Schedule within 1 business hour of a new matter being created.",
    missing: "Please add or verify the attorney/client phone call calendar event on the matter.",
    late: "Attorney/client call was scheduled, but after the 1-business-hour setup goal. Please review setup timing and scheduling habits.",
    unknown: "Please recheck this matter before coaching. The app could not confirm the attorney call from Clio.",
  },
  SETUP_COURT_DATE: {
    label: "Court Date Added",
    goal: "Add within 1 business hour when the court date is known.",
    missing: "Please add or verify the court/hearing/plea/status/continuance calendar event on the matter.",
    late: "Court date was added, but after the 1-business-hour setup goal. Please confirm why it was delayed and improve setup timing.",
    unknown: "Please recheck this matter before coaching. The app could not confirm the court date from Clio.",
  },
  CLIENT_CONTACT: {
    label: "Client Contact",
    goal: "Complete by next business day at 5:00 PM.",
    missing: "Please send or log outgoing client contact communication on the matter.",
    late: "Client contact was found, but after the deadline. Please improve next-business-day follow-up timing.",
    unknown: "Please recheck this matter before coaching. The app could not confirm client contact from Clio.",
  },
  APPEARANCE_FILING: {
    label: "Appearance Filed",
    goal: "Complete by the second business day at 5:00 PM.",
    missing: "Please send or verify the appearance filing notification/template in Clio.",
    late: "Appearance filing communication was found, but after the deadline. Please review the filing workflow timing.",
    unknown: "Please recheck this matter before coaching. The app could not confirm appearance filing from Clio.",
  },
  COURT_RESULTS: {
    label: "Court Results",
    goal: "Complete by next business day at 5:00 PM after court.",
    missing: "Please send or verify the Court Result / Resultado communication after the last court date.",
    late: "Court result communication was found, but after the deadline. Please improve post-court communication timing.",
    unknown: "Please recheck this matter before coaching. The app could not confirm court results from Clio.",
  },
  POST_COURT_CALL: {
    label: "Post-Court Call",
    goal: "Schedule by next business day at 5:00 PM after court when the case continues.",
    missing: "Please schedule or verify the post-court attorney/client call if the case continues.",
    late: "Post-court call was scheduled, but after the deadline. Please improve post-court follow-up timing.",
    unknown: "Please recheck this matter before coaching. The app could not confirm the post-court call from Clio.",
  },
  CLIENT_FOLLOWUP: {
    label: "Client Follow-Up",
    goal: "Respond before 2 inbound client messages accumulate without a firm response.",
    missing: "Please review the communication thread and respond or coach on unanswered client follow-up.",
    late: "Client follow-up was handled late. Please review response timing and prevent repeat delays.",
    unknown: "Please recheck this matter before coaching. The app could not confirm follow-up risk from Clio.",
  },
};

function stepLabel(stepCode: string): string {
  return STEP_ACTIONS[stepCode]?.label ?? stepCode.replaceAll("_", " ");
}

function actionFor(stepCode: string, status: string, reasonCode?: string | null): string {
  const info = STEP_ACTIONS[stepCode];
  if (status === "Missing") return info?.missing ?? "Complete or verify this missing workflow step in Clio.";
  if (status === "Late") return info?.late ?? "Review timing. Evidence was found after the deadline.";
  if (status === "Unknown") {
    if (reasonCode?.includes("API") || reasonCode?.startsWith("NOTES_400:")) {
      return "Recheck the matter before coaching. This is an audit visibility issue, not proof that work was missed.";
    }
    return info?.unknown ?? "Review this item in Clio. The app could not verify it from API-visible evidence.";
  }
  return "Review this item in Clio.";
}

function humanStatus(status: string): string {
  if (status === "Unknown") return "Needs Review";
  return status;
}

function priorityFor(status: string): string {
  if (status === "Missing") return "Action Needed";
  if (status === "Late") return "Timing Improvement";
  if (status === "Unknown") return "Review First";
  return "Review";
}

function whyFlagged(stepCode: string, status: string, reasonCode?: string | null): string {
  if (status === "Missing") return `${stepLabel(stepCode)} was not found from the allowed read-only Clio evidence.`;
  if (status === "Late") return `${stepLabel(stepCode)} was found, but after the expected timeliness goal.`;
  if (status === "Unknown") {
    if (reasonCode && reasonCode !== "NOT_FOUND") return `The auditor could not confirm this item from Clio: ${reasonCode}`;
    return "The auditor could not confirm this item from Clio-visible evidence.";
  }
  return "";
}

function timingGoalFor(stepCode: string): string {
  return STEP_ACTIONS[stepCode]?.goal ?? "Review the expected workflow timing.";
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

  return {
    matters,
    attorneys,
    summary: summary[0] ?? { total: 0, unchecked: 0, pass: 0, pending: 0, late: 0, flag: 0, review: 0, missing_items: 0, late_items: 0, unknown_items: 0 },
    lastRun: lastRun[0] ?? null,
    metrics,
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
      stepLabel(row.step_code),
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
  const grouped = new Map<string, ActionCsvRow[]>();
  for (const row of rows) {
    const key = row.responsible_attorney_name || "Unassigned";
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  const lines = [
    "CWCA Case Manager To-Do List",
    `Generated: ${generated}`,
    "Use this for internal workflow follow-up only. Open Clio, complete or verify the item, and keep any case details in Clio.",
    "",
  ];

  if (!rows.length) {
    lines.push("No open-matter missing, late, or review items were found for the case manager list.");
    lines.push("If the dashboard still shows older monthly coaching counts, click Run Audit Batch once and export again so the to-do list uses the latest open-matter checks.");
    return lines.join("\r\n");
  }

  for (const [attorney, items] of grouped) {
    lines.push("============================================================");
    lines.push(`Attorney: ${attorney}`);
    lines.push(`Items: ${items.length}`);
    lines.push("============================================================");
    lines.push("");

    items.forEach((row, index) => {
      const status = String(row.item_status ?? "");
      const evidence =
        row.evidence_source && row.evidence_ref_id
          ? `${row.evidence_source} #${row.evidence_ref_id}`
          : "";
      const proof = proofPath(origin, row.evidence_source, row.evidence_ref_id);
      const details = [
        textLine("Priority", priorityFor(status)),
        textLine("Client", `${row.client_first_name ?? ""} ${row.client_last_name ?? ""}`.trim()),
        textLine("Matter", row.matter_number),
        textLine("Overall", row.overall_status),
        textLine("Improvement Area", stepLabel(row.step_code)),
        textLine("Status", humanStatus(status)),
        textLine("What The Case Manager Should Do In Clio", actionFor(row.step_code, status, row.reason_code)),
        textLine("Timeliness Goal", timingGoalFor(row.step_code)),
        textLine("Due", formatCsvDate(row.deadline_at)),
        textLine("Found", formatCsvDate(row.evidence_at)),
        textLine("Open Matter In Clio", clioMatterLink(String(row.matter_id))),
        textLine("Proof Saved In Auditor", proof),
        textLine("Evidence Found", evidence),
        textLine("Matter Created", formatCsvDate(row.matter_created_at)),
        textLine("Why This Was Flagged", whyFlagged(row.step_code, status, row.reason_code)),
      ].filter(Boolean);

      lines.push(`${index + 1}. ${stepLabel(row.step_code)} - ${humanStatus(status)}`);
      lines.push(...details.map((detail) => `   ${detail}`));
      lines.push("");
    });
  }

  return lines.join("\r\n");
}
