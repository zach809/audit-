import { redirect } from "next/navigation";
import { getDashboardData, type WorkspaceAuditItem } from "@/lib/dashboard-data";
import { hasDashboardSession } from "@/lib/session";
import { hasClioConnection } from "@/lib/token-store";
import { formatLocal } from "@/lib/business-time";
import { APP_VERSION } from "@/lib/version";
import { APP_TZ } from "@/lib/config";
import { WORKFLOW_COLUMNS, WORKFLOW_RULES, workflowLabel } from "@/lib/workflow-rules";

export const dynamic = "force-dynamic";

function badge(value: string | null | undefined) {
  const label = value || "";
  const cls = label.replace(/\s+/g, "-").replace("/", "A");
  return <span className={`badge ${cls}`}>{label || "N/A"}</span>;
}

type DashboardItem = {
  stepCode: string;
  status: string;
  operationalState?: string;
  reasonCode?: string;
  deadlineAt?: string | null;
  evidenceAt?: string | null;
  evidenceSource?: string;
  evidenceRefId?: string;
  evidenceUrl?: string;
};

function evidencePath(item: DashboardItem): string {
  if (item.evidenceRefId && item.evidenceSource === "Communication") return `/evidence/communications/${item.evidenceRefId}`;
  if (item.evidenceRefId && item.evidenceSource === "Calendar") return `/evidence/calendar_entries/${item.evidenceRefId}`;
  return item.evidenceUrl ?? "";
}

function clioMatterPath(matterId: string): string {
  const baseUrl = process.env.CLIO_BASE_URL || "https://app.clio.com";
  return `${baseUrl.replace(/\/$/, "")}/nc/#/matters/${encodeURIComponent(matterId)}`;
}

function evidenceLabel(item: DashboardItem): string {
  return item.evidenceSource && item.evidenceRefId ? `${item.evidenceSource} #${item.evidenceRefId}` : "Evidence";
}

function stepLabel(code: string): string {
  return workflowLabel(code);
}

function isInternalPlaceholder(reason?: string | null): boolean {
  return !reason || reason === "NOT_FOUND" || reason === "UNKNOWN";
}

function isGenericApiError(reason?: string | null): boolean {
  return reason === "API_ERROR" || reason === "MATTER_ERROR: API_ERROR" || Boolean(reason?.startsWith("NOTES_400:"));
}

function needsMatterRefresh(items: DashboardItem[]): boolean {
  const genericApiProblems = items.filter((item) => item.status === "Unknown" && isGenericApiError(item.reasonCode));
  return genericApiProblems.length >= Math.max(3, items.length - 1);
}

function stepDetail(item: DashboardItem | undefined, status: string): string {
  if (!item) return status === "Pending" ? "Waiting for audit" : "";
  if (status === "Pending") {
    if (item.operationalState && item.operationalState !== "Pending") return item.operationalState;
    if (item.deadlineAt) return `Due: ${formatLocal(item.deadlineAt)}`;
    return "Not due yet";
  }
  if (status === "Missing") {
    return "";
  }
  if (status === "Unknown") {
    return isGenericApiError(item.reasonCode) ? "Click Recheck Matter" : isInternalPlaceholder(item.reasonCode) ? "" : item.reasonCode ?? "";
  }
  if (status === "Late") {
    return isInternalPlaceholder(item.reasonCode) ? "" : item.reasonCode ?? "";
  }
  return "";
}

function stepCell(items: DashboardItem[], code: string) {
  const item = items.find((i) => i.stepCode === code);
  if (!item) {
    return (
      <div className="step-cell">
        {badge("Not Checked")}
        <div className="detail">Queued for next batch</div>
      </div>
    );
  }
  const status = item?.status ?? "Pending";
  const displayStatus = status === "Unknown" && isGenericApiError(item?.reasonCode) ? "Needs Recheck" : status;
  const detail = stepDetail(item, status);
  const href = item ? evidencePath(item) : "";
  return (
    <div className="step-cell">
      {badge(displayStatus)}
      {detail && detail !== displayStatus ? <div className="detail">{detail}</div> : null}
      {href ? <a className="evidence-link" href={href}>{evidenceLabel(item!)}</a> : null}
    </div>
  );
}

function problemText(item: DashboardItem): string {
  const info = WORKFLOW_RULES[item.stepCode] ?? {
    label: stepLabel(item.stepCode),
    missing: "Required evidence was not found.",
    action: "Review this item in Clio.",
    late: "Evidence was found late.",
  };
  if (item.status === "Missing") return `${info.missing} ${info.action}`;
  if (item.status === "Late") return info.late;
  if (item.status === "Unknown") {
    if (isGenericApiError(item.reasonCode)) {
      return "This row came from an older incomplete audit result. Refresh this matter so the app can re-check the Clio communication and calendar evidence.";
    }
    const reason = !isInternalPlaceholder(item.reasonCode) ? ` ${item.reasonCode}` : "";
    return `Could not verify this from the Clio API.${reason}`;
  }
  return "";
}

function problemList(items: DashboardItem[]) {
  if (!items.length) {
    return <p>Not checked yet. Click Recheck Matter for this one case, or Run Audit Batch to continue safely through the queue.</p>;
  }
  const problems = items.filter((i) => ["Missing", "Late", "Unknown"].includes(i.status));
  if (!problems.length) {
    const pending = items.some((i) => i.status === "Pending");
    return pending ? (
      <p>No problem yet. These steps are still pending because the deadline has not passed or the matter has not needed that step yet.</p>
    ) : (
      <p>No problems found for this matter.</p>
    );
  }

  const refreshNeeded = needsMatterRefresh(items);
  const visibleProblems = refreshNeeded
    ? problems.filter((item) => !(item.status === "Unknown" && isGenericApiError(item.reasonCode)))
    : problems;

  return (
    <div className="problem-list">
      {refreshNeeded ? (
        <div className="problem-item Unknown">
          <div className="problem-title">
            {badge("Review")}
            <strong>Fresh check needed</strong>
          </div>
          <p>This matter still has an older incomplete result saved. Use Recheck Matter, or keep pressing Run Audit Batch and the app will work through these first.</p>
        </div>
      ) : null}
      {visibleProblems.map((item) => {
        const href = evidencePath(item);
        return (
          <div className={`problem-item ${item.status.replace(/\s+/g, "-")}`} key={`${item.stepCode}-${item.status}`}>
            <div className="problem-title">
              {badge(item.status)}
              <strong>{stepLabel(item.stepCode)}</strong>
            </div>
            <p>{problemText(item)}</p>
            <div className="problem-meta">
              {item.deadlineAt ? <span>Due: {formatLocal(item.deadlineAt)}</span> : null}
              {item.evidenceAt ? <span>Found: {formatLocal(item.evidenceAt)}</span> : null}
              {href ? <a href={href}>{evidenceLabel(item)}</a> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function dateInput(date: Date): string {
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

function monthStartInput(date: Date): string {
  const today = dateInput(date);
  return `${today.slice(0, 8)}01`;
}

function filterLink(filters: Record<string, string>, next: Record<string, string>) {
  const params = new URLSearchParams({ ...filters, ...next });
  for (const [key, value] of Array.from(params.entries())) {
    if (!value) params.delete(key);
  }
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

type MetricRow = {
  matters_checked?: number | string;
  pass_count?: number | string;
  flag_count?: number | string;
  review_count?: number | string;
  missing_item_count?: number | string;
  late_item_count?: number | string;
  unknown_item_count?: number | string;
};

function num(value: number | string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(part: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}

function metricHealth(row: MetricRow): string {
  const checked = num(row.matters_checked);
  const passRate = checked ? num(row.pass_count) / checked : 0;
  const problemMatters = num(row.flag_count) + num(row.review_count);
  if (!checked) return "No Data";
  if (problemMatters === 0) return "Strong";
  if (passRate >= 0.75) return "Watch";
  return "Needs Focus";
}

function metricFocus(row: MetricRow): { area: string; action: string } {
  const missing = num(row.missing_item_count);
  const late = num(row.late_item_count);
  const unknown = num(row.unknown_item_count);
  const flag = num(row.flag_count);
  const review = num(row.review_count);

  if (missing === 0 && late === 0 && unknown === 0 && flag === 0 && review === 0) {
    return { area: "Maintain", action: "Keep using the current Clio workflow and evidence habits." };
  }
  if (unknown >= missing && unknown >= late && unknown > 0) {
    return { area: "Audit visibility", action: "Recheck matters and confirm emails/events are linked to the matter." };
  }
  if (missing >= late && missing > 0) {
    return { area: "Missing evidence", action: "Focus on completing or logging required workflow steps in Clio." };
  }
  if (late > 0) {
    return { area: "Timeliness", action: "Review intake handoff timing and same-day setup deadlines." };
  }
  return { area: "Review", action: "Open the flagged matters and verify the proof links." };
}

function auditItemPriority(status: string): number {
  if (status === "Missing") return 1;
  if (status === "Unknown" || status === "Needs Recheck") return 2;
  if (status === "Late") return 3;
  if (status === "Pending") return 4;
  if (status === "On Time" || status === "On Track") return 5;
  return 6;
}

function workspaceStatus(item: DashboardItem): string {
  if (item.status === "Unknown" && isGenericApiError(item.reasonCode)) return "Needs Recheck";
  if (item.status === "On Time") return "On Track";
  return item.status;
}

type DashboardTab = "overview" | "workspace" | "matters" | "reports" | "compliance";

const DASHBOARD_TABS: Array<{ id: DashboardTab; label: string; description: string }> = [
  { id: "overview", label: "Overview", description: "Executive summary and audit progress" },
  { id: "workspace", label: "Attorney Workspace", description: "Grouped audit items by attorney" },
  { id: "matters", label: "Matters", description: "Detailed matter cards and proof links" },
  { id: "reports", label: "Reports", description: "Case manager and audit exports" },
  { id: "compliance", label: "Compliance", description: "Read-only and data-handling rules" },
];

function dashboardTab(value?: string): DashboardTab {
  return DASHBOARD_TABS.some((tab) => tab.id === value) ? (value as DashboardTab) : "overview";
}

function tabLink(filters: Record<string, string>, tab: DashboardTab): string {
  const params = new URLSearchParams({ ...filters, tab });
  for (const [key, value] of Array.from(params.entries())) {
    if (!value) params.delete(key);
  }
  return `/?${params.toString()}`;
}

export default async function Dashboard({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!hasDashboardSession()) redirect("/login");
  const connected = await hasClioConnection().catch(() => false);
  const activeTab = dashboardTab(searchParams.tab);
  const filters = {
    attorney: searchParams.attorney ?? "",
    overall: searchParams.overall ?? "",
    from: searchParams.from ?? "",
    to: searchParams.to ?? "",
  };
  const today = dateInput(new Date());
  const monthStart = monthStartInput(new Date());
  const hasFilters = Boolean(filters.attorney || filters.overall || filters.from || filters.to);
  const data = await getDashboardData(filters);
  const auditBatchSize = Math.max(1, Number(process.env.AUDIT_BATCH_SIZE ?? "5") || 5);
  const totalCount = num(data.summary.total);
  const uncheckedCount = num(data.summary.unchecked);
  const checkedCount = Math.max(0, totalCount - uncheckedCount);
  const needsFollowUpCount = num(data.summary.flag) + num(data.summary.late) + num(data.summary.review);
  const batchesLeft = Math.ceil(uncheckedCount / auditBatchSize);
  const progressPct = totalCount ? Math.round((checkedCount / totalCount) * 100) : 0;
  const nextBatchCount = Math.min(auditBatchSize, uncheckedCount);
  const waitingLabel = uncheckedCount === 1 ? "matter" : "matters";
  const batchLabel = batchesLeft === 1 ? "click" : "clicks";
  const nextBatchLabel = nextBatchCount === 1 ? "matter" : "matters";
  const exportParams = new URLSearchParams(filters).toString();
  const actionExportParams = new URLSearchParams(filters);
  actionExportParams.set("type", "actions");
  const lastRunText = data.lastRun
    ? `${data.lastRun.status} at ${formatLocal(data.lastRun.finished_at ?? data.lastRun.started_at)}`
    : "No audit has run yet";
  const workspaceGroups = new Map<string, Array<{
    matterId: string;
    matterNumber: string;
    clientName: string;
    stepCode: string;
    status: string;
    deadlineAt?: string | null;
    evidenceAt?: string | null;
    evidenceSource?: string;
    evidenceRefId?: string;
    evidenceUrl?: string;
  }>>();
  for (const item of data.workspaceItems as WorkspaceAuditItem[]) {
    const attorney = item.responsible_attorney_name || "Unassigned";
    const clientName = `${item.client_first_name ?? ""} ${item.client_last_name ?? ""}`.trim() || "Unnamed Client";
    const rows = workspaceGroups.get(attorney) ?? [];
    rows.push({
      matterId: item.matter_id,
      matterNumber: item.matter_number,
      clientName,
      stepCode: item.step_code,
      status: workspaceStatus({
        stepCode: item.step_code,
        status: item.item_status,
        reasonCode: item.reason_code ?? undefined,
      }),
      deadlineAt: item.deadline_at ? String(item.deadline_at) : null,
      evidenceAt: item.evidence_at ? String(item.evidence_at) : null,
      evidenceSource: item.evidence_source ?? undefined,
      evidenceRefId: item.evidence_ref_id ?? undefined,
      evidenceUrl: item.evidence_url ?? undefined,
    });
    workspaceGroups.set(attorney, rows);
  }
  const workspaceSections = Array.from(workspaceGroups.entries())
    .map(([attorney, rows]) => ({
      attorney,
      rows: rows.sort((a, b) => auditItemPriority(a.status) - auditItemPriority(b.status) || a.clientName.localeCompare(b.clientName)),
      needsFollowUp: rows.filter((row) => ["Missing", "Late", "Unknown", "Needs Recheck"].includes(row.status)).length,
    }))
    .sort((a, b) => b.needsFollowUp - a.needsFollowUp || a.attorney.localeCompare(b.attorney));
  const statusChart = [
    { label: "Needs Follow-Up", value: needsFollowUpCount, className: "followup" },
    { label: "On Track", value: num(data.summary.pass), className: "ontrack" },
    { label: "Not Due Yet", value: num(data.summary.pending), className: "pending" },
    { label: "Still To Audit", value: uncheckedCount, className: "unchecked" },
  ];
  const statusChartTotal = Math.max(1, statusChart.reduce((sum, item) => sum + item.value, 0));
  const topAttorneyChart = workspaceSections.filter((section) => section.needsFollowUp > 0).slice(0, 8);
  const maxAttorneyFollowUp = Math.max(1, ...topAttorneyChart.map((section) => section.needsFollowUp));
  const notice =
    searchParams.audit === "ran"
      ? searchParams.message || "Audit run completed."
      : searchParams.audit === "failed"
        ? searchParams.message || "Audit run failed."
        : searchParams.clio === "connected"
          ? "Clio connected successfully."
          : searchParams.clio === "failed"
            ? `Clio connection failed${searchParams.reason ? `: ${searchParams.reason}` : "."}`
            : "";

  return (
    <main className="shell">
      <div className="topbar app-header">
        <div className="title">
          <div className="eyebrow-row">
            <span className="eyebrow">Internal Workflow Coaching</span>
            <span className="badge Pass">Read-Only Clio</span>
          </div>
          <h1>Clio Workflow Compliance Auditor</h1>
          <p>Open-matter workflow checks, proof links, and case-manager follow-up in one place, using Illinois business time.</p>
          <div className="header-meta">
            <span>Last run: {lastRunText}</span>
            <span>Version: {APP_VERSION}</span>
          </div>
        </div>
        <div className="actions header-actions">
          {connected ? (
            <span className="badge Pass">Clio Connected</span>
          ) : (
            <a className="button primary" href="/api/auth/clio/start">Connect Clio</a>
          )}
          <form action="/api/audit/run" method="post">
            <input type="hidden" name="attorney" value={filters.attorney} />
            <input type="hidden" name="overall" value={filters.overall} />
            <input type="hidden" name="from" value={filters.from} />
            <input type="hidden" name="to" value={filters.to} />
            <input type="hidden" name="tab" value={activeTab} />
            <button className="primary" type="submit">Run Audit Batch</button>
          </form>
          <form action="/logout" method="post">
            <button type="submit">Log Out</button>
          </form>
        </div>
      </div>

      {notice ? (
        <section className={searchParams.audit === "failed" || searchParams.clio === "failed" ? "notice danger" : "notice"}>
          {notice}
        </section>
      ) : null}

      <nav className="dashboard-tabs" aria-label="Dashboard sections">
        {DASHBOARD_TABS.map((tab) => (
          <a
            className={activeTab === tab.id ? "dashboard-tab active" : "dashboard-tab"}
            href={tabLink(filters, tab.id)}
            key={tab.id}
          >
            <strong>{tab.label}</strong>
            <span>{tab.description}</span>
          </a>
        ))}
      </nav>

      {activeTab === "overview" ? (
        <>
      <section className="queue-panel overview-panel">
        <div className="queue-copy">
          <span className="label">Audit Progress</span>
          <strong>{checkedCount} of {totalCount} matters audited</strong>
          <p>
            {uncheckedCount > 0
              ? `${uncheckedCount} ${waitingLabel} still need checking. Click Run Audit Batch to audit the next ${nextBatchCount} ${nextBatchLabel}.`
              : "Everything discovered in this view has been checked."}
          </p>
          <p className="muted small">Matter cards below only show audited results. Waiting matters stay hidden until their batch finishes.</p>
        </div>
        <div className="queue-meter" aria-label={`${progressPct}% audited`}>
          <div className="queue-meter-bar" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="queue-next">
          <span>{progressPct}% done</span>
          <strong>{batchesLeft}</strong>
          <span>{batchLabel} left</span>
        </div>
      </section>

      <section className="grid">
        <div className="stat focus-stat"><span>Needs Follow-Up</span><strong>{needsFollowUpCount}</strong><p>Missing, late, or review items.</p></div>
        <div className="stat"><span>On Track</span><strong>{data.summary.pass}</strong><p>No current workflow problems found.</p></div>
        <div className="stat"><span>Not Due Yet</span><strong>{data.summary.pending}</strong><p>Waiting on a future deadline.</p></div>
        <div className="stat"><span>Needs Review</span><strong>{data.summary.review}</strong><p>Check visibility before coaching.</p></div>
        <div className="stat"><span>Late Timing</span><strong>{data.summary.late}</strong><p>Evidence was found after the goal.</p></div>
        <div className="stat"><span>Still To Audit</span><strong>{uncheckedCount}</strong><p>{batchesLeft} safe {batchLabel} left.</p></div>
      </section>

      <section className="overview-visuals">
        <div className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Status Mix</h2>
              <p className="muted small">Simple breakdown of the current audit view.</p>
            </div>
          </div>
          <div className="stacked-chart" aria-label="Status mix">
            {statusChart.map((item) => (
              <span
                className={`stacked-segment ${item.className}`}
                key={item.label}
                style={{ width: `${Math.max(4, Math.round((item.value / statusChartTotal) * 100))}%` }}
                title={`${item.label}: ${item.value}`}
              />
            ))}
          </div>
          <div className="chart-legend">
            {statusChart.map((item) => (
              <div className="legend-item" key={item.label}>
                <span className={`legend-dot ${item.className}`} />
                <strong>{item.value}</strong>
                <small>{item.label}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Top Follow-Up By Attorney</h2>
              <p className="muted small">Attorneys with the most open follow-up items.</p>
            </div>
          </div>
          {topAttorneyChart.length ? (
            <div className="bar-chart">
              {topAttorneyChart.map((section) => (
                <div className="bar-row" key={section.attorney}>
                  <span>{section.attorney}</span>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${Math.round((section.needsFollowUp / maxAttorneyFollowUp) * 100)}%` }} />
                  </div>
                  <strong>{section.needsFollowUp}</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="chart-empty">
              <strong>No follow-up items found.</strong>
              <p>When items need attention, they will appear here by attorney.</p>
            </div>
          )}
        </div>
      </section>
        </>
      ) : null}

      {activeTab === "compliance" ? (
      <section className="panel compliance-panel">
        <div className="panel-heading">
          <div>
            <h2>Compliance And Data Handling</h2>
            <p className="muted small">Built for internal workflow coaching with read-only Clio access, minimal local storage, and less-strict business-time deadlines.</p>
          </div>
          <span className="badge Pass">Read-Only Only</span>
        </div>
        <div className="compliance-grid">
          <div>
            <h3>What This Stores</h3>
            <p>Matter IDs and numbers, client names, responsible attorney, timestamps, workflow statuses, evidence IDs or links, audit-run history, and encrypted OAuth tokens.</p>
          </div>
          <div>
            <h3>What This Does Not Store</h3>
            <p>No communication bodies, note text, document contents, billing data, payment data, or Clio write actions are saved here.</p>
          </div>
          <div>
            <h3>Retention</h3>
            <p>By default, audit runs are kept 90 days, monthly snapshots 365 days, and closed-matter audit rows 30 days. Expired stored access tokens are cleared.</p>
          </div>
        </div>
        <div className="guardrail-list">
          <span>Internal use only.</span>
          <span>Limit dashboard access to approved staff.</span>
          <span>Use MFA for Clio, Vercel, and database access.</span>
          <span>Review vendors and hosting settings.</span>
          <span>Rotate secrets on a schedule and after staff changes.</span>
          <span>This is workflow coaching, not legal advice.</span>
        </div>
      </section>
      ) : null}

      {activeTab === "reports" ? (
      <section className="panel report-panel">
        <div className="panel-heading">
          <div>
            <h2>Reports</h2>
            <p className="muted small">Download clean follow-up lists without changing anything in Clio.</p>
          </div>
        </div>
        <div className="report-grid">
          <form className="report-card" action="/api/export.csv?type=case-manager-text" method="post">
            <div>
              <span className="label">For Case Managers</span>
              <strong>Notepad To-Do List</strong>
              <p>Plain text list grouped by attorney, ready to send for follow-up.</p>
            </div>
            <button className="primary" type="submit">Download List</button>
          </form>
          <form className="report-card" action={`/api/export.csv?${actionExportParams.toString()}`} method="post">
            <div>
              <span className="label">For Tracking</span>
              <strong>Case Manager CSV</strong>
              <p>Filtered action report with Clio links, proof links, and timing goals.</p>
            </div>
            <button type="submit">Download CSV</button>
          </form>
          <form className="report-card" action={`/api/export.csv?${exportParams}`} method="post">
            <div>
              <span className="label">Full Detail</span>
              <strong>Audit CSV</strong>
              <p>Full dashboard export for deeper review or recordkeeping.</p>
            </div>
            <button type="submit">Download Audit</button>
          </form>
        </div>
      </section>
      ) : null}

      {activeTab === "workspace" || activeTab === "matters" ? (
      <section className="panel filter-panel">
        <div className="panel-heading">
          <div>
            <h2>Review Matters</h2>
            <p className="muted small">Filter the active dashboard view by attorney, status, or created date.</p>
          </div>
        </div>
        <form className="filters">
          <input type="hidden" name="tab" value={activeTab} />
          <label>
            Responsible Attorney
            <select name="attorney" defaultValue={filters.attorney}>
              <option value="">All</option>
              {data.attorneys.map((a) => (
                <option key={a.id ?? "none"} value={a.id ?? ""}>{a.name || "Unassigned"} ({a.count})</option>
              ))}
            </select>
          </label>
          <label>
            Overall Status
            <select name="overall" defaultValue={filters.overall}>
              <option value="">All</option>
              <option>Pass</option>
              <option>Pending</option>
              <option>Late</option>
              <option>Flag</option>
              <option>Review</option>
            </select>
          </label>
          <label>
            Created From
            <input name="from" type="date" defaultValue={filters.from} />
          </label>
          <label>
            Created To
            <input name="to" type="date" defaultValue={filters.to} />
          </label>
          <button type="submit">Apply</button>
          <a className="button" href="/">Clear</a>
        </form>
        <div className="quick-filters">
          <a className="button" href={filterLink({ ...filters, tab: activeTab }, { from: today, to: today })}>Today</a>
          <a className="button" href={filterLink({ ...filters, tab: activeTab }, { from: monthStart, to: today })}>This Month</a>
          <a className="button" href={filterLink({ ...filters, tab: activeTab }, { from: "", to: "" })}>All Dates</a>
        </div>
        {hasFilters ? (
          <p className="filter-alert">
            Filtered view is on. The totals and table now match these filters.
          </p>
        ) : null}
        <p className="muted small">
          Run Audit Batch checks up to {auditBatchSize} matters at a time and returns after about 25 seconds if Clio is slow. {uncheckedCount > 0 ? `${uncheckedCount} ${waitingLabel} left, about ${batchesLeft} ${batchLabel} to finish this view.` : "Everything discovered has been checked."}
        </p>
        {data.lastRun?.message ? <p className="muted small">Last run note: {data.lastRun.message}</p> : null}
        <p className="muted small">Showing the first 150 matching matters. Use filters or CSV export for broader review.</p>
      </section>
      ) : null}

      {activeTab === "workspace" ? (
      <section className="panel workspace-panel">
        <div className="panel-heading">
          <div>
            <h2>Attorney Audit Workspace</h2>
            <p className="muted small">A clean grouped view of audit items by attorney. Use filters above to narrow the workspace.</p>
          </div>
          <span className="badge Unchecked">{workspaceSections.length} groups</span>
        </div>
        {workspaceSections.length ? (
          <div className="workspace-board">
            {workspaceSections.map((section) => (
              <article className="workspace-group" key={section.attorney}>
                <div className="workspace-group-head">
                  <div>
                    <span className="label">Attorney</span>
                    <h3>{section.attorney}</h3>
                  </div>
                  <div className="workspace-counts">
                    <strong>{section.needsFollowUp}</strong>
                    <span>Needs Follow-Up</span>
                  </div>
                </div>
                <div className="workspace-table">
                  <div className="workspace-row workspace-row-head">
                    <span>Client / Matter</span>
                    <span>Audit Item</span>
                    <span>Status</span>
                    <span>Timing</span>
                    <span>Links</span>
                  </div>
                  {section.rows.map((row) => {
                    const href = evidencePath(row as DashboardItem);
                    return (
                      <div className="workspace-row" key={`${section.attorney}-${row.matterId}-${row.stepCode}`}>
                        <span>
                          <strong>{row.clientName}</strong>
                          <small>{row.matterNumber}</small>
                        </span>
                        <span>{stepLabel(row.stepCode)}</span>
                        <span>{badge(row.status)}</span>
                        <span>
                          {row.deadlineAt ? <small>Due: {formatLocal(row.deadlineAt)}</small> : null}
                          {row.evidenceAt ? <small>Found: {formatLocal(row.evidenceAt)}</small> : null}
                          {!row.deadlineAt && !row.evidenceAt ? <small>No timing note</small> : null}
                        </span>
                        <span className="workspace-links">
                          <a href={clioMatterPath(row.matterId)} target="_blank" rel="noreferrer">Clio</a>
                          {href ? <a href={href}>Proof</a> : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="workspace-empty">
            <strong>No audit items in this view yet.</strong>
            <p>Run Audit Batch, or clear filters, to populate the workspace.</p>
          </div>
        )}
      </section>
      ) : null}

      {activeTab === "matters" ? (
      <section className="matter-list">
        {data.matters.length ? data.matters.map((m) => {
          const items = m.items as DashboardItem[];
          const evidenceItems = items.filter((i) => evidencePath(i));
          const refreshNeeded = needsMatterRefresh(items);
          return (
            <article className="matter-card" key={m.matter_id}>
              <div className="matter-head">
                <div>
                  <h3>{`${m.client_first_name} ${m.client_last_name}`.trim() || "Unnamed Client"}</h3>
                  <p>{m.matter_number}</p>
                </div>
                <div>
                  <span className="label">Attorney</span>
                  <strong>{m.responsible_attorney_name || "Unassigned"}</strong>
                </div>
                <div>
                  <span className="label">Created</span>
                  <strong>{formatLocal(m.matter_created_at)}</strong>
                </div>
                <div>
                  <span className="label">Last Court</span>
                  <strong>{formatLocal(m.last_court_date) || "None"}</strong>
                </div>
                <div className="matter-actions">
                  {badge(m.display_overall_status ?? m.overall_status)}
                  <a className="button compact" href={clioMatterPath(m.matter_id)} target="_blank" rel="noreferrer">Open in Clio</a>
                  <form action="/api/audit/run" method="post">
                    <input type="hidden" name="matter_id" value={m.matter_id} />
                    <input type="hidden" name="attorney" value={filters.attorney} />
                    <input type="hidden" name="overall" value={filters.overall} />
                    <input type="hidden" name="from" value={filters.from} />
                    <input type="hidden" name="to" value={filters.to} />
                    <button type="submit">Recheck Matter</button>
                  </form>
                </div>
              </div>

              {refreshNeeded ? (
                <div className="refresh-needed">
                  <strong>This matter needs one fresh Clio check.</strong>
                  <span>The saved result is from an older failed API run, so it is not evidence of missing work yet.</span>
                </div>
              ) : (
                <div className="step-grid">
                  {WORKFLOW_COLUMNS.map(([code, label]) => (
                    <div className="step-block" key={code}>
                      <span className="step-label">{label}</span>
                      {stepCell(items, code)}
                    </div>
                  ))}
                </div>
              )}

              <div className="matter-foot">
                <div>
                  <span className="label">Problems</span>
                  {problemList(items)}
                </div>
                <div>
                  <span className="label">Evidence</span>
                  <p className="evidence-links">
                    <span>Matter: {m.matter_number}</span>
                    <a href={clioMatterPath(m.matter_id)} target="_blank" rel="noreferrer">Open Matter in Clio</a>
                  </p>
                  {evidenceItems.length ? (
                    evidenceItems.map((i) => (
                      <p className="evidence-links" key={`${i.stepCode}-${i.evidenceRefId ?? i.evidenceUrl}`}>
                        <span>{i.stepCode.replaceAll("_", " ")}: {evidenceLabel(i)}</span>
                        <a href={evidencePath(i)}>Proof Details</a>
                      </p>
                    ))
                  ) : (
                    <p>None yet</p>
                  )}
                </div>
              </div>
            </article>
          );
        }) : (
          <section className="panel empty-state">
            <strong>No checked matter cards match this view yet.</strong>
            <p>{uncheckedCount > 0 ? "Click Run Audit Batch to pull the next safe batch from Clio." : "Try clearing filters or running a fresh batch."}</p>
          </section>
        )}
      </section>
      ) : null}

      {activeTab === "overview" ? (
      <section className="panel coaching-panel">
        <div className="panel-heading">
          <div>
            <h2>Current Month Attorney Coaching Summary</h2>
            <p className="muted small">Monthly coaching areas based only on Clio-visible workflow evidence.</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Attorney</th>
                <th>Checked</th>
                <th>Health</th>
                <th>Pass Rate</th>
                <th>Needs Action</th>
                <th>Needs Review</th>
                <th>Missing Steps</th>
                <th>Late Steps</th>
                <th>Unknown Checks</th>
                <th>Main Area</th>
                <th>Suggested Coaching</th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((m) => {
                const focus = metricFocus(m);
                const checked = num(m.matters_checked);
                const pass = num(m.pass_count);
                const action = num(m.flag_count);
                const review = num(m.review_count);
                const missing = num(m.missing_item_count);
                const late = num(m.late_item_count);
                const unknown = num(m.unknown_item_count);
                return (
                  <tr key={m.snapshot_id}>
                    <td><strong>{m.responsible_attorney_name || "Unassigned"}</strong></td>
                    <td>{checked}</td>
                    <td>{badge(metricHealth(m))}</td>
                    <td><strong>{pct(pass, checked)}</strong> <span className="muted small">({pass}/{checked})</span></td>
                    <td>{action}</td>
                    <td>{review}</td>
                    <td>{missing}</td>
                    <td>{late}</td>
                    <td>{unknown}</td>
                    <td><strong>{focus.area}</strong></td>
                    <td>{focus.action}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      ) : null}
    </main>
  );
}
