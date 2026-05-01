import { initDb, db } from "./db";

export type DashboardFilters = {
  attorney?: string;
  overall?: string;
  from?: string;
  to?: string;
};

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function getDashboardData(filters: DashboardFilters = {}) {
  await initDb();
  const sql = db();
  const conditions = [
    sql`true`,
    filters.attorney ? sql`m.responsible_attorney_id = ${filters.attorney}` : sql`true`,
    filters.overall ? sql`m.overall_status = ${filters.overall}` : sql`true`,
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
        when count(i.*) = 0 then 'Pending'
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
    group by m.matter_id
    order by
      case m.overall_status when 'Review' then 1 when 'Flag' then 2 when 'Late' then 3 when 'Pending' then 4 else 5 end,
      m.matter_created_at desc
    limit 150
  `;

  const attorneys = await sql`
    select responsible_attorney_id as id, responsible_attorney_name as name, count(*)::int as count
    from audit_matter m
    where ${conditions[5]} and ${conditions[6]}
    group by responsible_attorney_id, responsible_attorney_name
    order by responsible_attorney_name
  `;

  const summary = await sql`
    select
      count(*)::int as total,
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
          when count(i.*) = 0 then 'Pending'
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
    from audit_metric_snapshot
    where period_type = 'month'
    order by created_at desc, responsible_attorney_name
    limit 50
  `;

  return {
    matters,
    attorneys,
    summary: summary[0] ?? { total: 0, pass: 0, pending: 0, late: 0, flag: 0, review: 0, missing_items: 0, late_items: 0, unknown_items: 0 },
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
