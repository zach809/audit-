import { redirect } from "next/navigation";
import { getDashboardData, type WorkspaceAuditItem } from "@/lib/dashboard-data";
import { hasDashboardSession } from "@/lib/session";
import { hasClioConnection } from "@/lib/token-store";
import { formatLocal } from "@/lib/business-time";
import { APP_VERSION } from "@/lib/version";
import { APP_TZ } from "@/lib/config";
import { WORKFLOW_COLUMNS, WORKFLOW_RULES, workflowLabel } from "@/lib/workflow-rules";
import { ThemeToggle } from "./theme-toggle";
import {
  auditItemPriority,
  displayAuditStatus,
  isFollowUpStatus,
  isGenericApiError,
  isInternalPlaceholder,
  statusClass,
  workspaceFilterMatches,
  workspaceStatus,
  REVIEW_STATUSES,
} from "@/lib/audit-display";

export const dynamic = "force-dynamic";

function badge(value: string | null | undefined) {
  const label = value || "";
  const cls = statusClass(label);
  return <span className={`badge ${cls}`}>{displayAuditStatus(label) || "N/A"}</span>;
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

type WorkspaceRow = {
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
  const displayStatus = displayAuditStatus(status, item?.reasonCode);
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
    label: workflowLabel(item.stepCode),
    missing: "This workflow step needs follow-up.",
    action: "Review this item in Clio.",
    late: "Evidence was found late.",
  };
  if (item.status === "Missing") return `${info.missing} ${info.action}`;
  if (item.status === "Late") return info.late;
  if (item.status === "Unknown") {
    if (isGenericApiError(item.reasonCode)) {
      return "This row came from an older incomplete audit result. Refresh this matter so the app can re-check the Clio communication and calendar evidence.";
    }
    if (item.reasonCode === "EVIDENCE_NOT_CONFIRMED") {
      return "CWCA could not confidently confirm this proof from read-only Clio evidence. Review the matter before treating it as missed work.";
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
              <strong>{workflowLabel(item.stepCode)}</strong>
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
    return { area: "Needs follow-up", action: "Focus on completing or logging required workflow steps in Clio." };
  }
  if (late > 0) {
    return { area: "Timeliness", action: "Some required steps were completed after the target time. Review the matter handoff and coach the team to complete setup items sooner." };
  }
  return { area: "Review", action: "Open the flagged matters and verify the proof links." };
}

type DashboardTab = "workspace" | "matters" | "reports" | "guide" | "compliance";

const DASHBOARD_TABS: Array<{ id: DashboardTab; label: string; description: string }> = [
  { id: "workspace", label: "Attorney Workspace", description: "Grouped audit items by attorney" },
  { id: "matters", label: "Matters", description: "Detailed matter cards and proof links" },
  { id: "reports", label: "Reports", description: "Case manager and audit exports" },
  { id: "guide", label: "Guide", description: "How to read the results" },
  { id: "compliance", label: "Compliance", description: "Read-only and data-handling rules" },
];

const WORKSPACE_STATUS_FILTERS = [
  { id: "followup", label: "Needs Follow-Up" },
  { id: "missing", label: "Needs Action" },
  { id: "review", label: "Needs Review" },
  { id: "late", label: "Late" },
  { id: "pending", label: "Pending" },
  { id: "all", label: "All Items" },
];

const WORKSPACE_FOCUS_FILTERS = [
  { id: "all", label: "All Areas" },
  { id: "initial-client-setup", label: "Initial Client Setup" },
  { id: "court-follow-up", label: "Court Follow-Up" },
  { id: "client-follow-up", label: "Client Follow-Up" },
];

const WORKSPACE_FOCUS_STEPS: Record<string, string[]> = {
  "initial-client-setup": ["SETUP_WELCOME", "SETUP_ATTY_CALL", "SETUP_COURT_DATE", "CLIENT_CONTACT", "APPEARANCE_FILING"],
  "court-follow-up": ["COURT_RESULTS", "POST_COURT_CALL"],
  "client-follow-up": ["CLIENT_FOLLOWUP"],
};

const GUIDE_STATUS_CARDS = [
  {
    color: "red",
    title: "Needs Follow-Up",
    text: "Start here. These are missing, late, or review items that a case manager or attorney should check in Clio.",
  },
  {
    color: "green",
    title: "On Track",
    text: "CWCA found the expected workflow evidence and no current problem is showing for that item.",
  },
  {
    color: "blue",
    title: "Not Due Yet",
    text: "The deadline has not passed. No action is needed unless staff already know the step should be done.",
  },
  {
    color: "purple",
    title: "Needs Review",
    text: "CWCA could not confirm the answer from Clio. Recheck the matter before coaching anyone.",
  },
  {
    color: "amber",
    title: "Late Timing",
    text: "Evidence was found, but it appears after the workflow goal. Use this for timing coaching, not blame.",
  },
  {
    color: "slate",
    title: "Still To Audit",
    text: "These matters are waiting for a safe audit batch. Click Run Audit Batch until the queue is complete.",
  },
];

function dashboardTab(value?: string): DashboardTab {
  return DASHBOARD_TABS.some((tab) => tab.id === value) ? (value as DashboardTab) : "workspace";
}

function tabLink(filters: Record<string, string>, tab: DashboardTab): string {
  return filterLink(filters, { tab });
}

function workspaceFocusMatches(stepCode: string, focus: string): boolean {
  const steps = WORKSPACE_FOCUS_STEPS[focus];
  return !steps || steps.includes(stepCode);
}

function workspaceFocusLabel(focus: string): string {
  return WORKSPACE_FOCUS_FILTERS.find((filter) => filter.id === focus)?.label ?? "All Areas";
}

function DashboardUnavailable({ message, connected }: { message: string; connected: boolean }) {
  return (
    <main className="shell">
      <section className="app-header topbar">
        <div className="title">
          <div className="eyebrow-row">
            <span className="eyebrow">Internal Workflow Coaching</span>
            <span className="badge Pass">Read-Only Clio</span>
          </div>
          <h1>Workflow Auditor</h1>
          <p>Open matters, proof links, and follow-up in one focused workspace.</p>
          <div className="header-meta">
            <span>Version: {APP_VERSION}</span>
          </div>
        </div>
        <div className="actions header-actions">
          <ThemeToggle />
          {connected ? <span className="badge Pass">Clio Connected</span> : <a className="button primary" href="/api/auth/clio/start">Connect Clio</a>}
          <a className="button" href="/logout">Log Out</a>
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Dashboard Temporarily Unavailable</h2>
            <p>{message}</p>
          </div>
          <a className="button primary" href="/">Try Again</a>
        </div>
      </section>
    </main>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!hasDashboardSession()) redirect("/login");
  const connected = await hasClioConnection().catch(() => false);
  const activeTab = dashboardTab(searchParams.tab);
  const workspaceStatusFilter = searchParams.wstatus ?? "followup";
  const workspaceFocusFilter = searchParams.wfocus ?? "all";
  const filters = {
    attorney: searchParams.attorney ?? "",
    overall: searchParams.overall ?? "",
    from: searchParams.from ?? "",
    to: searchParams.to ?? "",
  };
  const today = dateInput(new Date());
  const monthStart = monthStartInput(new Date());
  const hasFilters = Boolean(filters.attorney || filters.overall || filters.from || filters.to);
  let data: Awaited<ReturnType<typeof getDashboardData>> | null = null;
  try {
    data = await getDashboardData(filters);
  } catch {
    data = null;
  }
  if (!data) {
    return (
      <DashboardUnavailable
        connected={connected}
        message="The dashboard could not reach the database. Check DATABASE_URL in Vercel and make sure the database is awake and accepting connections."
      />
    );
  }
  const dashboardData = data;
  const auditBatchSize = Math.max(1, Number(process.env.AUDIT_BATCH_SIZE ?? "5") || 5);
  const totalCount = num(dashboardData.summary.total);
  const uncheckedCount = num(dashboardData.summary.unchecked);
  const checkedCount = Math.max(0, totalCount - uncheckedCount);
  const needsFollowUpCount = num(dashboardData.summary.flag) + num(dashboardData.summary.late) + num(dashboardData.summary.review);
  const batchesLeft = Math.ceil(uncheckedCount / auditBatchSize);
  const progressPct = totalCount ? Math.round((checkedCount / totalCount) * 100) : 0;
  const nextBatchCount = Math.min(auditBatchSize, uncheckedCount);
  const waitingLabel = uncheckedCount === 1 ? "matter" : "matters";
  const batchLabel = batchesLeft === 1 ? "click" : "clicks";
  const nextBatchLabel = nextBatchCount === 1 ? "matter" : "matters";
  const exportParams = new URLSearchParams(filters).toString();
  const actionExportParams = new URLSearchParams(filters);
  actionExportParams.set("type", "actions");
  const lastRunText = dashboardData.lastRun
    ? `${dashboardData.lastRun.status} at ${formatLocal(dashboardData.lastRun.finished_at ?? dashboardData.lastRun.started_at)}`
    : "No audit has run yet";
  const allWorkspaceRows = (dashboardData.workspaceItems as WorkspaceAuditItem[]).map((item) => ({
    attorney: item.responsible_attorney_name || "Unassigned",
    row: {
      matterId: item.matter_id,
      matterNumber: item.matter_number,
      clientName: `${item.client_first_name ?? ""} ${item.client_last_name ?? ""}`.trim() || "Unnamed Client",
      stepCode: item.step_code,
      status: workspaceStatus(item.item_status, item.reason_code),
      deadlineAt: item.deadline_at ? String(item.deadline_at) : null,
      evidenceAt: item.evidence_at ? String(item.evidence_at) : null,
      evidenceSource: item.evidence_source ?? undefined,
      evidenceRefId: item.evidence_ref_id ?? undefined,
      evidenceUrl: item.evidence_url ?? undefined,
    } satisfies WorkspaceRow,
  }));
  const focusedWorkspaceRows = allWorkspaceRows.filter((item) => workspaceFocusMatches(item.row.stepCode, workspaceFocusFilter));
  const workspaceGroups = new Map<string, WorkspaceRow[]>();
  for (const item of focusedWorkspaceRows.filter((item) => workspaceFilterMatches(item.row.status, workspaceStatusFilter))) {
    const rows = workspaceGroups.get(item.attorney) ?? [];
    rows.push(item.row);
    workspaceGroups.set(item.attorney, rows);
  }
  const allWorkspaceGroups = new Map<string, WorkspaceRow[]>();
  for (const item of focusedWorkspaceRows) {
    const rows = allWorkspaceGroups.get(item.attorney) ?? [];
    rows.push(item.row);
    allWorkspaceGroups.set(item.attorney, rows);
  }
  const workspaceSections = Array.from(workspaceGroups.entries())
    .map(([attorney, rows]) => ({
      attorney,
      rows: rows.sort((a, b) => auditItemPriority(a.status) - auditItemPriority(b.status) || a.clientName.localeCompare(b.clientName)),
      needsFollowUp: rows.filter((row) => isFollowUpStatus(row.status)).length,
    }))
    .sort((a, b) => b.needsFollowUp - a.needsFollowUp || a.attorney.localeCompare(b.attorney));
  const attorneyHealth = Array.from(allWorkspaceGroups.entries())
    .map(([attorney, rows]) => {
      const checked = rows.length;
      const followUp = rows.filter((row) => isFollowUpStatus(row.status)).length;
      const onTrack = rows.filter((row) => row.status === "On Track").length;
      const missing = rows.filter((row) => row.status === "Missing").length;
      const late = rows.filter((row) => row.status === "Late").length;
      const review = rows.filter((row) => REVIEW_STATUSES.has(row.status)).length;
      const mainArea = review >= missing && review >= late && review > 0 ? "Review" : missing >= late && missing > 0 ? "Needs follow-up" : late > 0 ? "Late" : "On Track";
      return { attorney, checked, followUp, onTrack, missing, late, review, mainArea };
    })
    .sort((a, b) => b.followUp - a.followUp || a.attorney.localeCompare(b.attorney))
    .slice(0, 12);
  const todaysPriorities = allWorkspaceRows
    .filter((item) => isFollowUpStatus(item.row.status))
    .sort((a, b) => auditItemPriority(a.row.status) - auditItemPriority(b.row.status) || a.attorney.localeCompare(b.attorney) || a.row.clientName.localeCompare(b.row.clientName))
    .slice(0, 8);
  const initialClientSetupRows = allWorkspaceRows.filter((item) => workspaceFocusMatches(item.row.stepCode, "initial-client-setup"));
  const initialClientSetupFollowUp = initialClientSetupRows.filter((item) => isFollowUpStatus(item.row.status)).length;
  const initialClientSetupTotal = initialClientSetupRows.length;
  const courtFollowUpRows = allWorkspaceRows.filter((item) => workspaceFocusMatches(item.row.stepCode, "court-follow-up"));
  const courtFollowUpCount = courtFollowUpRows.filter((item) => isFollowUpStatus(item.row.status)).length;
  const clientFollowUpRows = allWorkspaceRows.filter((item) => workspaceFocusMatches(item.row.stepCode, "client-follow-up"));
  const clientFollowUpCount = clientFollowUpRows.filter((item) => isFollowUpStatus(item.row.status)).length;
  const activeWorkspaceFocusLabel = workspaceFocusLabel(workspaceFocusFilter);
  const statusChart = [
    { label: "Needs Follow-Up", value: needsFollowUpCount, className: "followup" },
    { label: "On Track", value: num(dashboardData.summary.pass), className: "ontrack" },
    { label: "Not Due Yet", value: num(dashboardData.summary.pending), className: "pending" },
    { label: "Still To Audit", value: uncheckedCount, className: "unchecked" },
  ];
  const statusChartRawTotal = statusChart.reduce((sum, item) => sum + item.value, 0);
  const statusChartTotal = Math.max(1, statusChartRawTotal);
  const topAttorneyChart = workspaceSections.filter((section) => section.needsFollowUp > 0).slice(0, 8);
  const maxAttorneyFollowUp = Math.max(1, ...topAttorneyChart.map((section) => section.needsFollowUp));
  const healthPct = totalCount ? Math.round((num(dashboardData.summary.pass) / totalCount) * 100) : 0;
  const donutSegments = [
    { color: "#b42318", value: needsFollowUpCount },
    { color: "#067647", value: num(dashboardData.summary.pass) },
    { color: "#175cd3", value: num(dashboardData.summary.pending) },
    { color: "#98a2b3", value: uncheckedCount },
  ];
  let donutCursor = 0;
  const donutGradient = statusChartRawTotal
    ? donutSegments
        .map((segment) => {
          const start = donutCursor;
          donutCursor += Math.round((segment.value / statusChartTotal) * 100);
          return `${segment.color} ${start}% ${donutCursor}%`;
        })
        .join(", ")
    : "#98a2b3 0% 100%";
  const issueBreakdown = [
    { label: "Needs Action", value: num(dashboardData.summary.missing_items), className: "red" },
    { label: "Late Timing", value: num(dashboardData.summary.late_items), className: "amber" },
    { label: "Needs Review", value: num(dashboardData.summary.unknown_items), className: "purple" },
    { label: "Client Follow-Up Risk", value: clientFollowUpCount, className: "blue" },
  ];
  const maxIssueCount = Math.max(1, ...issueBreakdown.map((item) => item.value));
  const workflowAreaBreakdown = WORKFLOW_COLUMNS.map(([code, label]) => ({
    code,
    label,
    followUp: allWorkspaceRows.filter((item) => item.row.stepCode === code && isFollowUpStatus(item.row.status)).length,
    checked: allWorkspaceRows.filter((item) => item.row.stepCode === code).length,
  }));
  const maxWorkflowCount = Math.max(1, ...workflowAreaBreakdown.map((item) => item.followUp));
  const setupSnapshot = WORKFLOW_COLUMNS
    .filter(([code]) => workspaceFocusMatches(code, "initial-client-setup"))
    .map(([code, label]) => {
      const rows = initialClientSetupRows.filter((item) => item.row.stepCode === code);
      const followUp = rows.filter((item) => isFollowUpStatus(item.row.status)).length;
      return { code, label, followUp, checked: rows.length, clear: Math.max(0, rows.length - followUp) };
    });
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
          <h1>Workflow Auditor</h1>
          <p>Open matters, proof links, and follow-up in one focused workspace.</p>
          <div className="header-meta">
            <span>Last run: {lastRunText}</span>
            <span>Version: {APP_VERSION}</span>
          </div>
        </div>
        <div className="actions header-actions">
          <ThemeToggle />
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
          <input type="hidden" name="wstatus" value={workspaceStatusFilter} />
          <input type="hidden" name="wfocus" value={workspaceFocusFilter} />
          <button className="primary" type="submit">Run Audit Batch</button>
          </form>
          <form action="/logout" method="post">
            <button type="submit">Log Out</button>
          </form>
        </div>
      </div>

      <section className="deployment-proof sr-only">
        <div>
          <span className="label">Deployment Proof</span>
          <strong>Updated court audit logic is active</strong>
          <p>Version {APP_VERSION}: court results use the 48-hour window, post-court calls wait for court results, and vague matter-linked calendar entries can count as possible court events.</p>
        </div>
        <a className="button compact" href="/api/health" target="_blank" rel="noreferrer">Check Version</a>
      </section>

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

      {false ? (
        <>
      <section className="panel court-rules-panel">
        <div className="panel-heading">
          <div>
            <h2>Court Workflow Rules In Use</h2>
            <p className="muted small">These are the current court audit rules. Recheck older matters after deploying so saved results refresh.</p>
          </div>
          <a className="button compact" href={filterLink({ ...filters, tab: "workspace", wstatus: "followup", wfocus: "court-follow-up" }, {})}>Open Court Follow-Up</a>
        </div>
        <div className="court-rule-grid">
          <div className="court-rule-card">
            <span className="label">Before Court</span>
            <strong>Appearance Hold</strong>
            <p>Future court dates keep Court Results and Post-Court Call as not due yet.</p>
          </div>
          <div className="court-rule-card">
            <span className="label">After Court Ends</span>
            <strong>48-Hour Results Window</strong>
            <p>Court Results are due within 48 hours after the court event ends.</p>
          </div>
          <div className="court-rule-card">
            <span className="label">After Results Found</span>
            <strong>24-Hour Call Window</strong>
            <p>Post-Court Call starts only after Court Results are found and the case continues.</p>
          </div>
          <div className="court-rule-card">
            <span className="label">Calendar Matching</span>
            <strong>Flexible Detection</strong>
            <p>Client name, case number, plea/status/hearing, and vague linked court entries can count when they are not obvious non-court events.</p>
          </div>
        </div>
      </section>

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
        <div className="stat focus-stat stat-red"><span>Needs Follow-Up</span><strong>{needsFollowUpCount}</strong><p>Items that need action, timing review, or verification.</p></div>
        <div className="stat stat-green"><span>On Track</span><strong>{dashboardData.summary.pass}</strong><p>No current workflow problems found.</p></div>
        <div className="stat stat-blue"><span>Not Due Yet</span><strong>{dashboardData.summary.pending}</strong><p>Waiting on a future deadline.</p></div>
        <div className="stat stat-purple"><span>Needs Review</span><strong>{dashboardData.summary.review}</strong><p>Check visibility before coaching.</p></div>
        <div className="stat stat-amber"><span>Late Timing</span><strong>{dashboardData.summary.late}</strong><p>Evidence was found after the goal.</p></div>
        <div className="stat stat-slate"><span>Still To Audit</span><strong>{uncheckedCount}</strong><p>{batchesLeft} safe {batchLabel} left.</p></div>
      </section>

      <section className="panel workspace-presets-panel">
        <div className="panel-heading">
          <div>
            <h2>Quick Workspace Views</h2>
            <p className="muted small">Jump straight into the grouped attorney workspace by the kind of follow-up your team is doing.</p>
          </div>
        </div>
        <div className="workspace-presets">
          <a className="workspace-preset primary-preset" href={filterLink({ ...filters, tab: "workspace", wstatus: "followup", wfocus: "initial-client-setup" }, {})}>
            <span className="label">Start Here</span>
            <strong>Initial Client Setup</strong>
            <p>Welcome packet, attorney call, court date, client contact, and appearance filing.</p>
            <b>{initialClientSetupFollowUp}</b>
            <small>needs follow-up</small>
          </a>
          <a className="workspace-preset" href={filterLink({ ...filters, tab: "workspace", wstatus: "followup", wfocus: "court-follow-up" }, {})}>
            <span className="label">After Court</span>
            <strong>Court Follow-Up</strong>
            <p>Court results and post-court call items.</p>
            <b>{courtFollowUpCount}</b>
            <small>needs follow-up</small>
          </a>
          <a className="workspace-preset" href={filterLink({ ...filters, tab: "workspace", wstatus: "followup", wfocus: "client-follow-up" }, {})}>
            <span className="label">Client Replies</span>
            <strong>Client Follow-Up</strong>
            <p>Matters where inbound client messages may be building up.</p>
            <b>{clientFollowUpCount}</b>
            <small>needs follow-up</small>
          </a>
        </div>
      </section>

      <section className="metrics-dashboard">
        <div className="panel metric-card health-card">
          <div className="panel-heading">
            <div>
              <h2>Workflow Health</h2>
              <p className="muted small">Boss-level view of the current open-matter audit.</p>
            </div>
          </div>
          <div className="donut-layout">
            <div className="donut-chart" style={{ background: `conic-gradient(${donutGradient})` }}>
              <div>
                <strong>{healthPct}%</strong>
                <span>on track</span>
              </div>
            </div>
            <div className="metric-list">
              {statusChart.map((item) => (
                <div className="metric-list-row" key={item.label}>
                  <span className={`legend-dot ${item.className}`} />
                  <strong>{item.value}</strong>
                  <small>{item.label}</small>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="panel metric-card">
          <div className="panel-heading">
            <div>
              <h2>Issue Type Breakdown</h2>
              <p className="muted small">What kind of follow-up is showing up most.</p>
            </div>
          </div>
          <div className="issue-bars">
            {issueBreakdown.map((item) => (
              <div className="issue-row" key={item.label}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.value}</span>
                </div>
                <div className="issue-track">
                  <span className={`issue-fill ${item.className}`} style={{ width: item.value ? `${Math.max(3, Math.round((item.value / maxIssueCount) * 100))}%` : "0%" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel metric-card setup-card">
          <div className="panel-heading">
            <div>
              <h2>Initial Client Setup</h2>
              <p className="muted small">Opening workflow snapshot across new setup steps.</p>
            </div>
            <a className="button compact" href={filterLink({ ...filters, tab: "workspace", wstatus: "followup", wfocus: "initial-client-setup" }, {})}>Open</a>
          </div>
          <div className="setup-score">
            <strong>{initialClientSetupFollowUp}</strong>
            <span>of {initialClientSetupTotal} setup items need follow-up</span>
          </div>
          <div className="setup-steps">
            {setupSnapshot.map((item) => (
              <div className="setup-step" key={item.code}>
                <span>{item.label}</span>
                <b>{item.followUp}</b>
                <small>{item.clear} clear</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel workflow-area-panel">
        <div className="panel-heading">
          <div>
            <h2>Workflow Area Breakdown</h2>
            <p className="muted small">Which workflow checks are creating the most follow-up.</p>
          </div>
        </div>
        <div className="workflow-area-bars">
          {workflowAreaBreakdown.map((item) => (
            <div className="workflow-area-row" key={item.code}>
              <div>
                <strong>{item.label}</strong>
                <small>{item.followUp} follow-up / {item.checked} checked</small>
              </div>
              <div className="workflow-track">
                <span style={{ width: item.followUp ? `${Math.max(3, Math.round((item.followUp / maxWorkflowCount) * 100))}%` : "0%" }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel priority-panel">
        <div className="panel-heading">
          <div>
            <h2>Today's Priorities</h2>
            <p className="muted small">Start here: highest-priority follow-up items from open matters.</p>
          </div>
          <a className="button compact" href={tabLink(filters, "workspace")}>Open Workspace</a>
        </div>
        {todaysPriorities.length ? (
          <div className="priority-list">
            {todaysPriorities.map((item) => {
              const href = evidencePath(item.row as DashboardItem);
              return (
                <div className={`priority-row status-row-${statusClass(item.row.status)}`} key={`${item.attorney}-${item.row.matterId}-${item.row.stepCode}`}>
                  <span>{badge(item.row.status)}</span>
                  <div>
                    <strong>{item.row.clientName}</strong>
                    <small>{item.attorney} - {item.row.matterNumber} - {workflowLabel(item.row.stepCode)}</small>
                  </div>
                  <div className="priority-links">
                    <a href={clioMatterPath(item.row.matterId)} target="_blank" rel="noreferrer">Clio</a>
                    {href ? <a href={href}>Proof</a> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="chart-empty">
            <strong>No priority follow-up items found.</strong>
            <p>When missing, late, or review items appear, the top priorities will show here.</p>
          </div>
        )}
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

      {activeTab === "guide" ? (
      <section className="guide-layout">
        <section className="panel guide-panel">
          <div className="panel-heading">
            <div>
              <h2>How To Read CWCA</h2>
              <p className="muted small">Use this as an internal workflow coaching guide. CWCA points you to items that may need follow-up; Clio remains the official source.</p>
            </div>
            <span className="badge Pass">Plain-English Guide</span>
          </div>
          <div className="guide-grid">
            {GUIDE_STATUS_CARDS.map((card) => (
              <div className={`guide-card guide-${card.color}`} key={card.title}>
                <span className="guide-kicker">{card.color === "slate" ? "Gray" : card.color}</span>
                <h3>{card.title}</h3>
                <p>{card.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="panel guide-panel">
          <div className="panel-heading">
            <div>
              <h2>What Each Area Checks</h2>
              <p className="muted small">These are the workflow areas CWCA checks on open matters.</p>
            </div>
          </div>
          <div className="rule-list">
            {Object.entries(WORKFLOW_RULES).map(([code, rule]) => (
              <div className="rule-row" key={code}>
                <div>
                  <span className="label">Audit Area</span>
                  <strong>{rule.label}</strong>
                </div>
                <p>{rule.goal}</p>
                <p><b>If flagged:</b> {rule.action}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="panel guide-panel">
          <div className="panel-heading">
            <div>
              <h2>Best Way To Use It</h2>
              <p className="muted small">A simple daily rhythm for interpreting the dashboard.</p>
            </div>
          </div>
          <div className="playbook-list">
            <div><strong>1. Start with Attorney Workspace.</strong><span>Use the grouped attorney view to see what actually needs follow-up.</span></div>
            <div><strong>2. Verify in Clio.</strong><span>Open the Clio link and proof link before deciding whether coaching is needed.</span></div>
            <div><strong>3. Set the report range.</strong><span>Use Reports to choose the exact dates you want covered before downloading.</span></div>
            <div><strong>4. Send the case-manager list.</strong><span>Download the missing-items review when you need a clean follow-up handoff.</span></div>
            <div><strong>5. Keep it coaching-focused.</strong><span>Use CWCA as a visibility tool, not as discipline by itself.</span></div>
          </div>
        </section>
      </section>
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
          </div>
        </div>
        <div className="report-grid">
          <form className="report-card report-card-wide" action="/api/export.csv?type=case-manager-text" method="post">
            <div>
              <span className="label">Main Report</span>
              <strong>End-of-Week Case Manager Audit Report</strong>
              <p>Plain text report with alerts, flagged matters, current status, and next steps.</p>
              <div className="report-date-row">
                <label>
                  Report From
                  <input name="from" type="date" defaultValue={filters.from} />
                </label>
                <label>
                  Report To
                  <input name="to" type="date" defaultValue={filters.to} />
                </label>
              </div>
              <input type="hidden" name="attorney" value={filters.attorney} />
              <input type="hidden" name="overall" value={filters.overall} />
            </div>
            <button className="primary" type="submit">Download Review</button>
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
        <div className="report-preview">
          <span className="label">Report Format Preview</span>
          <pre>{`End-of-Week Clio Case Manager Audit Report

Priority Summary
* Flagged matters reviewed: 3
* Items still needing action: 2
* Completed late/resolved items: 1

Flagged Matters

1. Matter: [Client Name]
   Attorney: [Attorney Name]
   Matter Number: [Matter Number]
   Clio Link: [Insert Clio Matter Link]

   Alert / Flag: Alert: Welcome packet was not completed within the required timeframe.

   Flagged Matter & What Happened:
   Welcome Packet is still flagged because CWCA did not find matching proof in Clio.

   What the Team Did:
   No proof of completion has been found yet.

   Current Status:
   Still Needs Action

   Next Step:
   Send the welcome packet if not already sent

Completed Items
* [Client Name] - Attorney Call: Complete

Items Still Needing Action
* [Client Name] - Welcome Packet: Still Needs Action.`}</pre>
        </div>
      </section>
      ) : null}

      {activeTab === "workspace" || activeTab === "matters" ? (
      <section className="panel filter-panel">
        <div className="panel-heading">
          <div>
            <h2>Review Matters</h2>
          </div>
        </div>
        <form className="filters">
          <input type="hidden" name="tab" value={activeTab} />
          <input type="hidden" name="wstatus" value={workspaceStatusFilter} />
          <input type="hidden" name="wfocus" value={workspaceFocusFilter} />
          <label>
            Responsible Attorney
            <select name="attorney" defaultValue={filters.attorney}>
              <option value="">All</option>
              {dashboardData.attorneys.map((a) => (
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
          <a className="button" href={filterLink({ ...filters, tab: activeTab, wstatus: workspaceStatusFilter, wfocus: workspaceFocusFilter }, { from: today, to: today })}>Today</a>
          <a className="button" href={filterLink({ ...filters, tab: activeTab, wstatus: workspaceStatusFilter, wfocus: workspaceFocusFilter }, { from: monthStart, to: today })}>This Month</a>
          <a className="button" href={filterLink({ ...filters, tab: activeTab, wstatus: workspaceStatusFilter, wfocus: workspaceFocusFilter }, { from: "", to: "" })}>All Dates</a>
        </div>
        {hasFilters ? (
          <p className="filter-alert">
            Filtered view is on.
          </p>
        ) : null}
        <div className="filter-summary">
          <span>{checkedCount} of {totalCount} audited</span>
          <span>{uncheckedCount > 0 ? `${uncheckedCount} ${waitingLabel} left` : "All discovered matters checked"}</span>
          {dashboardData.lastRun?.message ? <span>{dashboardData.lastRun.message}</span> : null}
        </div>
      </section>
      ) : null}

      {activeTab === "workspace" ? (
      <section className="panel workspace-panel">
        <div className="panel-heading">
          <div>
            <h2>Attorney Audit Workspace</h2>
          </div>
          <div className="workspace-heading-badges">
            <span className="badge Pending">{activeWorkspaceFocusLabel}</span>
            <span className="badge Unchecked">{workspaceSections.length} groups</span>
          </div>
        </div>
        <div className="workspace-filter-block">
          <span className="label">Status</span>
          <div className="workspace-filter-tabs">
          {WORKSPACE_STATUS_FILTERS.map((filter) => (
            <a
              className={workspaceStatusFilter === filter.id ? "workspace-filter active" : "workspace-filter"}
              href={filterLink({ ...filters, tab: "workspace", wstatus: filter.id, wfocus: workspaceFocusFilter }, {})}
              key={filter.id}
            >
              {filter.label}
            </a>
          ))}
          </div>
        </div>
        <div className="workspace-filter-block">
          <span className="label">Focus Area</span>
          <div className="workspace-focus-tabs">
          {WORKSPACE_FOCUS_FILTERS.map((filter) => (
            <a
              className={workspaceFocusFilter === filter.id ? "workspace-focus active" : "workspace-focus"}
              href={filterLink({ ...filters, tab: "workspace", wstatus: workspaceStatusFilter, wfocus: filter.id }, {})}
              key={filter.id}
            >
              {filter.label}
            </a>
          ))}
          </div>
        </div>
        <div className="attorney-health-grid">
          {attorneyHealth.map((attorney) => (
            <div className="attorney-health-card" key={attorney.attorney}>
              <span className="label">Attorney Health</span>
              <strong>{attorney.attorney}</strong>
              <div className="health-stats">
                <span><b>{attorney.followUp}</b> follow-up</span>
                <span><b>{attorney.onTrack}</b> on track</span>
                <span><b>{attorney.checked}</b> items</span>
              </div>
              <p>Main area: {attorney.mainArea}</p>
            </div>
          ))}
        </div>
        {workspaceSections.length ? (
          <div className="workspace-board">
            {workspaceSections.map((section) => (
              <details className="workspace-group" key={section.attorney} open={section.needsFollowUp > 0}>
                <summary className="workspace-group-head">
                  <div>
                    <span className="label">Attorney</span>
                    <h3>{section.attorney}</h3>
                  </div>
                  <div className="workspace-counts">
                    <strong>{section.needsFollowUp}</strong>
                    <span>Needs Follow-Up</span>
                  </div>
                </summary>
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
                      <div className={`workspace-row status-row-${statusClass(row.status)}`} key={`${section.attorney}-${row.matterId}-${row.stepCode}`}>
                        <span>
                          <strong>{row.clientName}</strong>
                          <small>{row.matterNumber}</small>
                        </span>
                        <span>{workflowLabel(row.stepCode)}</span>
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
              </details>
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
        {dashboardData.matters.length ? dashboardData.matters.map((m) => {
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
                    <input type="hidden" name="tab" value={activeTab} />
                    <input type="hidden" name="wstatus" value={workspaceStatusFilter} />
                    <input type="hidden" name="wfocus" value={workspaceFocusFilter} />
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

      {false ? (
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
                <th>Follow-Up Steps</th>
                <th>Late Steps</th>
                <th>Unknown Checks</th>
                <th>Main Area</th>
                <th>Suggested Coaching</th>
              </tr>
            </thead>
            <tbody>
              {dashboardData.metrics.map((m) => {
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
