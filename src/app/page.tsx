import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { getDashboardData, standardsCaseManagerFor, type WorkspaceAuditItem } from "@/lib/dashboard-data";
import { hasDashboardSession } from "@/lib/session";
import { hasClioConnection } from "@/lib/token-store";
import { formatLocal } from "@/lib/business-time";
import { APP_VERSION } from "@/lib/version";
import { APP_TZ } from "@/lib/config";
import {
  getPostClosureData,
  POST_CLOSURE_CONTACT_METHODS,
  POST_CLOSURE_ISSUE_TYPES,
  POST_CLOSURE_REVIEW_STATUSES,
  POST_CLOSURE_TOUCHPOINTS,
} from "@/lib/post-closure";
import { WORKFLOW_COLUMNS, WORKFLOW_RULES, workflowLabel } from "@/lib/workflow-rules";
import { ReviewBuilder, type ReviewBuilderItem } from "./review-builder";
import { MatterReviewControls } from "./matter-review-controls";
import { CopyTextButton } from "./copy-text-button";
import { MatterAiHelp } from "./matter-ai-help";
import {
  actionFor,
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
import type { PostClosureFollowUpRow } from "@/lib/post-closure";

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
  auditVersion?: string | null;
  lastEvaluatedAt?: string | null;
  reviewDecision?: string | null;
  reviewNote?: string | null;
  caseManagerName?: string | null;
  proofType?: string | null;
  reviewProofReference?: string | null;
  nextStep?: string | null;
  reportSummary?: string | null;
  internalNotes?: string | null;
  includeInReport?: boolean | null;
  reviewedBy?: string | null;
  reviewCompletedAt?: string | null;
  reviewUpdatedAt?: string | null;
  reviewHistory?: unknown;
};

type WorkspaceRow = {
  matterId: string;
  matterNumber: string;
  clientName: string;
  matterCreatedAt?: string | null;
  stepCode: string;
  status: string;
  reasonCode?: string | null;
  deadlineAt?: string | null;
  evidenceAt?: string | null;
  evidenceSource?: string;
  evidenceRefId?: string;
  evidenceUrl?: string;
  auditVersion?: string | null;
  reviewDecision?: string | null;
  reviewNote?: string | null;
  caseManagerName?: string | null;
  proofType?: string | null;
  reviewProofReference?: string | null;
  nextStep?: string | null;
  reportSummary?: string | null;
  internalNotes?: string | null;
  includeInReport?: boolean | null;
  reviewedBy?: string | null;
  reviewCompletedAt?: string | null;
  reviewUpdatedAt?: string | null;
  reviewHistory?: unknown;
};

type CaseManagerTask = {
  attorney: string;
  row: WorkspaceRow;
};

function evidencePath(item: DashboardItem, directToClio = false): string {
  const suffix = directToClio ? "?open=clio" : "";
  if (item.evidenceRefId && item.evidenceSource === "Communication") return `/evidence/communications/${item.evidenceRefId}${suffix}`;
  if (item.evidenceRefId && item.evidenceSource === "Calendar") return `/evidence/calendar_entries/${item.evidenceRefId}${suffix}`;
  return item.evidenceUrl ?? "";
}

function clioMatterPath(matterId: string): string {
  const baseUrl = process.env.CLIO_BASE_URL || "https://app.clio.com";
  return `${baseUrl.replace(/\/$/, "")}/nc/#/matters/${encodeURIComponent(matterId)}`;
}

function clioMatterSectionPath(matterId: string, section: "communications" | "calendar"): string {
  return `${clioMatterPath(matterId)}/${section}`;
}

function problemClioLinks(matterId: string, stepCode: string): Array<{ href: string; label: string }> {
  const communications = { href: clioMatterSectionPath(matterId, "communications"), label: "Open Communications" };
  const calendar = { href: clioMatterSectionPath(matterId, "calendar"), label: "Open Calendar" };

  if (
    stepCode === "SETUP_WELCOME" ||
    stepCode === "CLIENT_CONTACT" ||
    stepCode === "APPEARANCE_FILING" ||
    stepCode === "COURT_RESULTS" ||
    stepCode === "CLIENT_FOLLOWUP"
  ) {
    return [communications];
  }

  if (
    stepCode === "SETUP_ATTY_CALL" ||
    stepCode === "SETUP_COURT_DATE" ||
    stepCode === "POST_COURT_CALL"
  ) {
    return [calendar];
  }

  if (stepCode === "WEEKLY_CLIENT_CHECKIN") {
    return [calendar, communications];
  }

  return [{ href: clioMatterPath(matterId), label: "Open Matter" }];
}

function postClosureClientName(row: PostClosureFollowUpRow): string {
  return `${row.client_first_name ?? ""} ${row.client_last_name ?? ""}`.trim() || "Unnamed Client";
}

function isOpenPostClosureStatus(status: string): boolean {
  return ["Due Now", "Overdue", "In Progress", "Issue Found"].includes(status);
}

function postClosureTeamsNote(rows: PostClosureFollowUpRow[], attorneyFilter: string, stageFilter: string, windowFilter: string): string {
  const openRows = rows
    .filter((row) => isOpenPostClosureStatus(row.display_status))
    .sort((a, b) => {
      const attorneyCompare = (a.responsible_attorney_name || "Unassigned").localeCompare(b.responsible_attorney_name || "Unassigned");
      if (attorneyCompare) return attorneyCompare;
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    });
  const stageLabel = POST_CLOSURE_TOUCHPOINTS.find((touchpoint) => String(touchpoint.months) === stageFilter)?.label;
  const titleParts = [
    attorneyFilter ? `Attorney: ${attorneyFilter}` : "All attorneys",
    stageLabel ? `Touchpoint: ${stageLabel}` : "All touchpoints",
    windowFilter === "backlog" ? "Window: Older backlog" : windowFilter === "all" ? "Window: All history" : "Window: Current due window",
  ];
  const lines = [
    "Hey team - these post-closure follow-ups still need outreach or review.",
    titleParts.join(" | "),
    "",
  ];

  if (!openRows.length) {
    lines.push("No open post-closure follow-ups are showing in this filtered view.");
    return lines.join("\n");
  }

  let currentAttorney = "";
  for (const row of openRows) {
    const attorney = row.responsible_attorney_name || "Unassigned";
    if (attorney !== currentAttorney) {
      currentAttorney = attorney;
      lines.push(`${attorney}:`);
    }
    lines.push(
      `- ${postClosureClientName(row)} (${row.matter_number}) - ${row.touchpoint_label} follow-up - ${row.display_status} - due ${formatLocal(row.due_at)} - ${clioMatterPath(row.matter_id)}`,
    );
  }

  lines.push("");
  lines.push("Please call or contact the client, update the follow-up result in CWCA, and note any issue that needs attorney or supervisor attention.");
  return lines.join("\n");
}

function evidenceLabel(item: DashboardItem): string {
  return item.evidenceSource && item.evidenceRefId ? `${item.evidenceSource} #${item.evidenceRefId}` : "Evidence";
}

function needsMatterRefresh(items: DashboardItem[]): boolean {
  const genericApiProblems = items.filter((item) => item.status === "Unknown" && isGenericApiError(item.reasonCode));
  return genericApiProblems.length >= Math.max(3, items.length - 1);
}

function isLegacyWelcomeReview(item: DashboardItem): boolean {
  return item.stepCode === "SETUP_WELCOME" && item.status === "Unknown" && item.reasonCode === "EVIDENCE_NOT_CONFIRMED";
}

function displayItemStatus(item: DashboardItem | WorkspaceRow): string {
  if (item.stepCode === "SETUP_WELCOME" && item.status === "Unknown" && "reasonCode" in item && item.reasonCode === "EVIDENCE_NOT_CONFIRMED") {
    return "Needs Follow-Up";
  }
  return displayAuditStatus(item.status, "reasonCode" in item ? item.reasonCode : undefined);
}

function reviewStatus(item: DashboardItem | WorkspaceRow): string | null {
  if (item.reviewDecision === "Resolved" || item.reviewDecision === "No Action Needed") return "Resolved";
  if (item.reviewDecision === "Approved Exception") return "Approved Exception";
  if (item.reviewDecision === "In Progress") return "In Progress";
  if (item.reviewDecision === "Still Needs Action" || item.reviewDecision === "Unable to Confirm") return "Still Needs Follow-Up";
  if (item.reviewDecision === "Needs Attorney Review") return "Needs Attorney Review";
  return null;
}

function isClosedByReview(item: DashboardItem | WorkspaceRow): boolean {
  return item.reviewDecision === "Resolved" || item.reviewDecision === "No Action Needed" || item.reviewDecision === "Approved Exception";
}

function itemNeedsAttention(item: DashboardItem | WorkspaceRow): boolean {
  if (isClosedByReview(item)) return false;
  return ["Missing", "Late", "Unknown", "Needs Recheck", "Needs Review"].includes(item.status);
}

function currentItemStatus(item: DashboardItem | WorkspaceRow): string {
  return reviewStatus(item) ?? displayItemStatus(item);
}

function matterCardStatus(items: DashboardItem[], fallback: string): string {
  const activeItems = items.filter(itemNeedsAttention);
  if (activeItems.some((item) => item.status === "Missing")) return "Needs Follow-Up";
  if (activeItems.some((item) => item.status === "Unknown")) return "Needs Review";
  if (activeItems.some((item) => item.status === "Late")) return "Timing Review";
  if (items.some(isClosedByReview)) return "Resolved";
  if (items.some((item) => item.status === "Pending")) return "Not Due Yet";
  return displayAuditStatus(fallback);
}

function stepDetail(item: DashboardItem | undefined, status: string): string {
  if (!item) return status === "Pending" ? "Waiting for audit" : "";
  if (status === "Pending") {
    const state = item.operationalState && item.operationalState !== "Pending" ? item.operationalState : "Not due yet";
    if (item.deadlineAt) return `${state}. Escalates after ${formatLocal(item.deadlineAt)}`;
    return "Not due yet";
  }
  if (status === "Missing") {
    return "";
  }
  if (status === "Unknown") {
    return isGenericApiError(item.reasonCode) ? "Click Recheck Matter" : isInternalPlaceholder(item.reasonCode) ? "" : item.reasonCode ?? "";
  }
  if (status === "Late") {
    if (item.evidenceAt) return `Found: ${formatLocal(item.evidenceAt)}`;
    return isInternalPlaceholder(item.reasonCode) ? "Proof found after target time" : item.reasonCode ?? "";
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
  const displayStatus = currentItemStatus(item);
  const detail = stepDetail(item, status);
  const href = item ? evidencePath(item, true) : "";
  return (
    <div className="step-cell">
      {badge(displayStatus)}
      {detail && detail !== displayStatus ? <div className="detail">{detail}</div> : null}
      {href ? <a className="evidence-link" href={href} target="_blank" rel="noreferrer">{evidenceLabel(item!)}</a> : null}
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
  if (item.status === "Late") return `${info.late} Proof exists in Clio; this is a timing review, not a missing-proof task.`;
  if (item.status === "Unknown") {
    if (isLegacyWelcomeReview(item)) {
      return "Welcome letter communication was not confirmed in Clio. Check or send the Welcome Letter / Carta de bienvenida / Welcome to Hirsch Law Group template.";
    }
    if (isGenericApiError(item.reasonCode)) {
      return "This row came from an older incomplete audit result. Refresh this matter so the app can re-check the Clio communication and calendar evidence.";
    }
    if (item.reasonCode === "EVIDENCE_NOT_CONFIRMED") {
      return "CWCA could not confidently confirm this proof from read-only Clio evidence. Check the matter's Communications tab for the matching email subject before coaching the team.";
    }
    const reason = !isInternalPlaceholder(item.reasonCode) ? ` ${item.reasonCode}` : "";
    return `Could not verify this from the Clio API.${reason}`;
  }
  return "";
}

function problemList(context: { matterId: string; matterNumber: string; clientName: string; attorney: string }, items: DashboardItem[]) {
  if (!items.length) {
    return <p>Not checked yet. Click Recheck Matter for this one case, or Run Audit Batch to continue safely through the queue.</p>;
  }
  const problems = items.filter(itemNeedsAttention);
  if (!problems.length) {
    const reviewed = items.some(isClosedByReview);
    const pending = items.some((i) => i.status === "Pending");
    if (reviewed) {
      return <p>The flagged items on this matter have been reviewed in CWCA. No open follow-up is showing on this card right now.</p>;
    }
    if (pending) {
      const nextPending = items
        .filter((item) => item.status === "Pending" && item.deadlineAt)
        .sort((a, b) => new Date(a.deadlineAt!).getTime() - new Date(b.deadlineAt!).getTime())[0];
      return (
        <p>
          No problem yet. Pending items stay quiet until their deadline passes.
          {nextPending ? ` Next escalation: ${workflowLabel(nextPending.stepCode)} after ${formatLocal(nextPending.deadlineAt)}.` : ""}
        </p>
      );
    }
    return (
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
        const href = evidencePath(item, true);
        const clioLinks = problemClioLinks(context.matterId, item.stepCode);
        return (
            <div className={`problem-item ${item.status.replace(/\s+/g, "-")}`} key={`${item.stepCode}-${item.status}`}>
            <div className="problem-title">
              {badge(currentItemStatus(item))}
              <strong>{workflowLabel(item.stepCode)}</strong>
            </div>
            <p>{problemText(item)}</p>
            {item.reviewDecision || item.reviewNote ? (
              <p className="review-note-inline">
                <b>Human review:</b> {item.reviewDecision || "Pending"}{item.reviewNote ? ` - ${item.reviewNote}` : ""}
              </p>
            ) : null}
            <MatterReviewControls
              matterId={context.matterId}
              stepCode={item.stepCode}
              auditItemLabel={workflowLabel(item.stepCode)}
              currentDecision={item.reviewDecision}
              currentNote={item.reviewNote}
              currentNextStep={item.nextStep}
              currentReviewedBy={item.reviewedBy}
              currentCaseManagerName={item.caseManagerName}
              currentProofReference={item.reviewProofReference}
              existingProofUrl={href || null}
            />
            <MatterAiHelp
              matterId={context.matterId}
              matterNumber={context.matterNumber}
              clientName={context.clientName}
              attorney={context.attorney}
              stepCode={item.stepCode}
              auditItemLabel={workflowLabel(item.stepCode)}
              status={currentItemStatus(item)}
              reason={problemText(item)}
              reasonCode={item.reasonCode ?? null}
              operationalState={item.operationalState ?? null}
              due={item.deadlineAt ? formatLocal(item.deadlineAt) : null}
              found={item.evidenceAt ? formatLocal(item.evidenceAt) : null}
              evidenceSource={item.evidenceSource ?? null}
              evidenceRefId={item.evidenceRefId ?? null}
              auditVersion={item.auditVersion ?? null}
              lastEvaluatedAt={item.lastEvaluatedAt ? formatLocal(item.lastEvaluatedAt) : null}
              clioUrl={clioLinks[0]?.href ?? clioMatterPath(context.matterId)}
              proofUrl={href || null}
            />
            <div className="problem-meta">
              {item.deadlineAt ? <span>Due: {formatLocal(item.deadlineAt)}</span> : null}
              {item.evidenceAt ? <span>Found: {formatLocal(item.evidenceAt)}</span> : null}
              {clioLinks.map((link) => (
                <a className="problem-clio-link" href={link.href} target="_blank" rel="noreferrer" key={link.label}>
                  {link.label}
                </a>
              ))}
              {href ? <a href={href} target="_blank" rel="noreferrer">Open Saved Proof</a> : null}
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

function weekStartInput(date: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  const localNoon = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00`);
  const day = localNoon.getDay();
  const daysFromMonday = (day + 6) % 7;
  localNoon.setDate(localNoon.getDate() - daysFromMonday);
  return dateInput(localNoon);
}

function displayShortDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return `${month}/${day}/${String(year).slice(-2)}`;
}

function addDaysInput(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateInput(date);
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

type DashboardTab = "workspace" | "matters" | "case-manager" | "kpi" | "post-closure" | "reports" | "guide" | "compliance";
const KPI_WORKFLOW_CODES = new Set(["SETUP_WELCOME", "SETUP_ATTY_CALL", "SETUP_COURT_DATE"]);

const DASHBOARD_TABS: Array<{ id: DashboardTab; label: string; description: string }> = [
  { id: "matters", label: "Matters", description: "Detailed matter cards and proof links" },
  { id: "kpi", label: "Standards", description: "Weekly CM standards" },
  { id: "post-closure", label: "Post-Closure", description: "Closed-matter client follow-up" },
  { id: "reports", label: "Reports", description: "Case manager and audit exports" },
  { id: "guide", label: "Guide", description: "How to read the results" },
  { id: "compliance", label: "Compliance", description: "Read-only and data-handling rules" },
];

const POST_CLOSURE_STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "due", label: "Needs Outreach" },
  { id: "upcoming", label: "Coming Soon" },
  { id: "issues", label: "Issue Found" },
  { id: "completed", label: "Completed" },
];

const POST_CLOSURE_WINDOW_FILTERS = [
  { id: "current", label: "Current Window" },
  { id: "backlog", label: "Older Backlog" },
  { id: "all", label: "All History" },
];

const WORKSPACE_STATUS_FILTERS = [
  { id: "followup", label: "Needs Follow-Up" },
  { id: "missing", label: "Needs Action" },
  { id: "review", label: "Needs Review" },
  { id: "late", label: "Late" },
  { id: "pending", label: "Not Due Yet" },
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
  "client-follow-up": ["CLIENT_FOLLOWUP", "WEEKLY_CLIENT_CHECKIN"],
};

const GUIDE_STATUS_CARDS = [
  {
    color: "red",
    title: "Needs Follow-Up",
    text: "Start here. These are alerted, late, or review items that a case manager or attorney should check in Clio.",
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
  return DASHBOARD_TABS.some((tab) => tab.id === value) ? (value as DashboardTab) : "matters";
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

function dashboardErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/postgres:\/\/[^@\s]+@/gi, "postgres://***@").slice(0, 260);
  if (message.includes("CONNECT_TIMEOUT") || message.toLowerCase().includes("connection timed out")) {
    return "The dashboard could not reach the database. Check DATABASE_URL in Vercel and make sure the database is awake and accepting connections.";
  }
  if (message.includes("does not exist") || message.includes("column") || message.includes("relation")) {
    return `The database needs one automatic setup pass. Try Again once. If it stays here, open /api/health and check this message: ${message}`;
  }
  return `The dashboard could not load the database data. Open /api/health for details. Message: ${message}`;
}

export default async function Dashboard({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!hasDashboardSession()) redirect("/login");
  const connected = await hasClioConnection().catch(() => false);
  const activeTab = dashboardTab(searchParams.tab);
  const workspaceStatusFilter = searchParams.wstatus ?? "followup";
  const workspaceFocusFilter = searchParams.wfocus ?? "all";
  const closureStatusFilter = searchParams.closure_status ?? "all";
  const closureStageFilter = searchParams.closure_stage ?? "";
  const closureAttorneyFilter = searchParams.closure_attorney ?? "";
  const closureWindowFilter = searchParams.closure_window ?? "current";
  const today = dateInput(new Date());
  const weekStart = weekStartInput(new Date());
  const monthStart = monthStartInput(new Date());
  const defaultToCurrentWeek = activeTab === "matters" || activeTab === "workspace" || activeTab === "kpi";
  const filters = {
    attorney: searchParams.attorney ?? "",
    overall: searchParams.overall ?? "",
    from: searchParams.from ?? (defaultToCurrentWeek ? weekStart : ""),
    to: searchParams.to ?? (defaultToCurrentWeek ? today : ""),
  };
  const hasFilters = Boolean(filters.attorney || filters.overall || filters.from || filters.to);
  let data: Awaited<ReturnType<typeof getDashboardData>> | null = null;
  let postClosure: Awaited<ReturnType<typeof getPostClosureData>> | null = null;
  let dataError = "";
  try {
    [data, postClosure] = await Promise.all([
      getDashboardData(filters),
      getPostClosureData({
        status: closureStatusFilter,
        stage: closureStageFilter,
        attorney: closureAttorneyFilter,
        window: closureWindowFilter,
      }),
    ]);
  } catch (error) {
    data = null;
    postClosure = null;
    dataError = dashboardErrorMessage(error);
  }
  if (!data || !postClosure) {
    return (
      <DashboardUnavailable
        connected={connected}
        message={dataError || "The dashboard could not reach the database. Check DATABASE_URL in Vercel and make sure the database is awake and accepting connections."}
      />
    );
  }
  const dashboardData = data;
  const postClosureData = postClosure;
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
  const logicIssueExportParams = new URLSearchParams(filters);
  logicIssueExportParams.set("type", "logic-issues");
  const lastRunText = dashboardData.lastRun
    ? `${dashboardData.lastRun.status} at ${formatLocal(dashboardData.lastRun.finished_at ?? dashboardData.lastRun.started_at)}`
    : "No audit has run yet";
  const allWorkspaceRows = (dashboardData.workspaceItems as WorkspaceAuditItem[]).map((item) => ({
    attorney: item.responsible_attorney_name || "Unassigned",
    caseManager: standardsCaseManagerFor(item),
    row: {
      matterId: item.matter_id,
      matterNumber: item.matter_number,
      clientName: `${item.client_first_name ?? ""} ${item.client_last_name ?? ""}`.trim() || "Unnamed Client",
      matterCreatedAt: item.matter_created_at ? String(item.matter_created_at) : null,
      stepCode: item.step_code,
      status: workspaceStatus(item.item_status, item.reason_code),
      reasonCode: item.reason_code,
      deadlineAt: item.deadline_at ? String(item.deadline_at) : null,
      evidenceAt: item.evidence_at ? String(item.evidence_at) : null,
      evidenceSource: item.evidence_source ?? undefined,
      evidenceRefId: item.evidence_ref_id ?? undefined,
      evidenceUrl: item.evidence_url ?? undefined,
      auditVersion: item.audit_version,
      reviewDecision: item.review_decision,
      reviewNote: item.review_note,
      caseManagerName: item.case_manager_name,
      proofType: item.proof_type,
      reviewProofReference: item.proof_reference,
      nextStep: item.next_step,
      reportSummary: item.report_summary,
      internalNotes: item.internal_notes,
      includeInReport: item.include_in_report,
      reviewedBy: item.reviewed_by,
      reviewCompletedAt: item.review_completed_at ? String(item.review_completed_at) : null,
      reviewUpdatedAt: item.review_updated_at ? String(item.review_updated_at) : null,
      reviewHistory: item.review_history,
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
  const caseManagerTasks: CaseManagerTask[] = allWorkspaceRows
    .filter((item) => isFollowUpStatus(item.row.status) && !isClosedByReview(item.row))
    .sort((a, b) => auditItemPriority(a.row.status) - auditItemPriority(b.row.status) || a.attorney.localeCompare(b.attorney) || a.row.clientName.localeCompare(b.row.clientName));
  const caseManagerOpen = caseManagerTasks.filter((item) => !item.row.reviewDecision || item.row.reviewDecision === "Needs Review").length;
  const caseManagerInProgress = caseManagerTasks.filter((item) => item.row.reviewDecision === "In Progress").length;
  const caseManagerProofNeeded = caseManagerTasks.filter((item) => !item.row.evidenceRefId && !item.row.reviewProofReference).length;
  const caseManagerTeamsNote = [
    "Hey team - these CWCA items need case-manager follow-up.",
    "Please update the item in Clio first, then paste the Clio proof link in CWCA.",
    "CWCA will not clear resolved tasks from a note alone.",
    "",
    ...caseManagerTasks.slice(0, 40).map((item) => `- ${item.row.clientName} (${item.row.matterNumber}) - ${workflowLabel(item.row.stepCode)} - ${displayAuditStatus(item.row.status)} - ${clioMatterPath(item.row.matterId)}`),
  ].join("\n");
  const initialClientSetupRows = allWorkspaceRows.filter((item) => workspaceFocusMatches(item.row.stepCode, "initial-client-setup"));
  const initialClientSetupFollowUp = initialClientSetupRows.filter((item) => isFollowUpStatus(item.row.status)).length;
  const initialClientSetupTotal = initialClientSetupRows.length;
  const courtFollowUpRows = allWorkspaceRows.filter((item) => workspaceFocusMatches(item.row.stepCode, "court-follow-up"));
  const courtFollowUpCount = courtFollowUpRows.filter((item) => isFollowUpStatus(item.row.status)).length;
  const clientFollowUpRows = allWorkspaceRows.filter((item) => workspaceFocusMatches(item.row.stepCode, "client-follow-up"));
  const clientFollowUpCount = clientFollowUpRows.filter((item) => isFollowUpStatus(item.row.status)).length;
  const activeWorkspaceFocusLabel = workspaceFocusLabel(workspaceFocusFilter);
  const reviewBuilderItems: ReviewBuilderItem[] = allWorkspaceRows
    .filter((item) => isFollowUpStatus(item.row.status))
    .sort((a, b) => auditItemPriority(a.row.status) - auditItemPriority(b.row.status) || a.attorney.localeCompare(b.attorney) || a.row.clientName.localeCompare(b.row.clientName))
    .map((item) => ({
      id: `${item.row.matterId}-${item.row.stepCode}`,
      matterId: item.row.matterId,
      stepCode: item.row.stepCode,
      attorney: item.attorney,
      caseManager: item.row.caseManagerName || null,
      reviewCaseManager: item.row.caseManagerName || null,
      clientName: item.row.clientName,
      matterNumber: item.row.matterNumber,
      auditItem: workflowLabel(item.row.stepCode),
      status: displayAuditStatus(item.row.status),
      why: actionFor(item.row.stepCode, item.row.status),
      due: item.row.deadlineAt ? formatLocal(item.row.deadlineAt) : null,
      found: item.row.evidenceAt ? formatLocal(item.row.evidenceAt) : null,
      clioUrl: clioMatterPath(item.row.matterId),
      proofUrl: evidencePath(item.row as DashboardItem, true) || null,
      auditVersion: item.row.auditVersion,
      reviewDecision: item.row.reviewDecision,
      reviewNote: item.row.reviewNote,
      proofType: item.row.proofType,
      reviewProofReference: item.row.reviewProofReference,
      nextStep: item.row.nextStep,
      reportSummary: item.row.reportSummary,
      internalNotes: item.row.internalNotes,
      includeInReport: item.row.includeInReport,
      reviewedBy: item.row.reviewedBy,
      reviewCompletedAt: item.row.reviewCompletedAt,
      reviewUpdatedAt: item.row.reviewUpdatedAt,
      reviewHistory: item.row.reviewHistory,
    }));
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
  const kpiRows = allWorkspaceRows.filter(
    (item) =>
      KPI_WORKFLOW_CODES.has(item.row.stepCode) &&
      !["Not Due Yet", "Pending", "N/A", "Not Checked"].includes(item.row.status),
  );
  const kpiTotal = kpiRows.length;
  const kpiFollowUp = kpiRows.filter((item) => isFollowUpStatus(item.row.status)).length;
  const kpiClear = Math.max(0, kpiTotal - kpiFollowUp);
  const kpiOnTrack = kpiClear;
  const kpiLate = kpiRows.filter((item) => item.row.status === "Late").length;
  const kpiReview = kpiRows.filter((item) => REVIEW_STATUSES.has(item.row.status)).length;
  const kpiScore = kpiTotal ? Math.max(0, Math.min(100, Math.round((kpiClear / kpiTotal) * 100))) : 0;
  const kpiGrade = kpiScore >= 90 ? "Strong" : kpiScore >= 75 ? "Watch" : "Needs Focus";
  const kpiAttorneyScores = Array.from(
    kpiRows.reduce((map, item) => {
      const rows = map.get(item.attorney) ?? [];
      rows.push(item.row);
      map.set(item.attorney, rows);
      return map;
    }, new Map<string, WorkspaceRow[]>()),
  )
    .map(([attorney, rows]) => {
      const total = rows.length;
      const followUp = rows.filter((row) => isFollowUpStatus(row.status)).length;
      const clear = Math.max(0, total - followUp);
      const score = total ? Math.max(0, Math.min(100, Math.round((clear / total) * 100))) : 0;
      const late = rows.filter((row) => row.status === "Late").length;
      const review = rows.filter((row) => REVIEW_STATUSES.has(row.status)).length;
      const needsAction = rows.filter((row) => row.status === "Missing").length;
      const topArea = needsAction >= late && needsAction >= review && needsAction > 0
        ? "Needs action"
        : review >= late && review > 0
          ? "Needs review"
          : late > 0
            ? "Timing"
            : "On track";
      return { attorney, total, followUp, onTrack: clear, score, late, review, needsAction, topArea };
    })
    .sort((a, b) => b.followUp - a.followUp || a.score - b.score || a.attorney.localeCompare(b.attorney));
  const standardRows = Array.from(
    allWorkspaceRows
      .filter((item) => KPI_WORKFLOW_CODES.has(item.row.stepCode))
      .reduce((map, item) => {
        const current = map.get(item.caseManager) ?? {
          caseManager: item.caseManager,
          matters: new Set<string>(),
          welcome: 0,
          attorneyCall: 0,
          courtDate: 0,
          welcomeLate: 0,
          attorneyCallLate: 0,
          courtDateLate: 0,
        };
        current.matters.add(item.row.matterId);
        const complete = item.row.status === "On Track" || item.row.status === "Late" || isClosedByReview(item.row) || Boolean(item.row.evidenceRefId);
        const late = item.row.status === "Late";
        if (complete && item.row.stepCode === "SETUP_WELCOME") current.welcome += 1;
        if (complete && item.row.stepCode === "SETUP_ATTY_CALL") current.attorneyCall += 1;
        if (complete && item.row.stepCode === "SETUP_COURT_DATE") current.courtDate += 1;
        if (late && item.row.stepCode === "SETUP_WELCOME") current.welcomeLate += 1;
        if (late && item.row.stepCode === "SETUP_ATTY_CALL") current.attorneyCallLate += 1;
        if (late && item.row.stepCode === "SETUP_COURT_DATE") current.courtDateLate += 1;
        map.set(item.caseManager, current);
        return map;
      }, new Map<string, { caseManager: string; matters: Set<string>; welcome: number; attorneyCall: number; courtDate: number; welcomeLate: number; attorneyCallLate: number; courtDateLate: number }>())
      .values(),
  )
    .map((item) => {
      const cases = item.matters.size;
      const completedStandards = item.welcome + item.attorneyCall + item.courtDate;
      const lateStandards = item.welcomeLate + item.attorneyCallLate + item.courtDateLate;
      const onTimeStandards = Math.max(0, completedStandards - lateStandards);
      const totalStandards = cases * 3;
      const scorePoints = onTimeStandards + lateStandards * 0.5;
      return {
        caseManager: item.caseManager,
        cases,
        welcome: item.welcome,
        attorneyCall: item.attorneyCall,
        newMatters: cases,
        courtDate: item.courtDate,
        welcomeLate: item.welcomeLate,
        attorneyCallLate: item.attorneyCallLate,
        courtDateLate: item.courtDateLate,
        lateStandards,
        completedStandards,
        completionRate: totalStandards ? Math.round((scorePoints / totalStandards) * 100) : 0,
      };
    })
    .sort((a, b) => a.caseManager.localeCompare(b.caseManager));
  const standardsDate = filters.to || today;
  const priorStandardWeeks = Array.from({ length: 6 }, (_, index) => {
    const start = addDaysInput(weekStart, -7 * (index + 1));
    const end = addDaysInput(start, 4);
    return { label: `${displayShortDate(start)} - ${displayShortDate(end)}`, from: start, to: end };
  });
  const standardsTotals = standardRows.reduce(
    (totals, row) => ({
      newMatters: totals.newMatters + row.newMatters,
      initialMeeting: totals.initialMeeting + row.attorneyCall,
      welcome: totals.welcome + row.welcome,
      courtDate: totals.courtDate + row.courtDate,
    }),
    { newMatters: 0, initialMeeting: 0, welcome: 0, courtDate: 0 },
  );
  const kpiTopAttention = kpiAttorneyScores.filter((item) => item.followUp > 0).slice(0, 8);
  const kpiWorkflowFocus = [
    ["SETUP_WELCOME", "Welcome Letter"],
    ["SETUP_ATTY_CALL", "Attorney Call"],
    ["SETUP_COURT_DATE", "Court Date Added"],
  ] as const;
  const kpiWorkflowFocusRows = kpiWorkflowFocus
    .map(([code, label]) => ({
      code,
      label,
      followUp: kpiRows.filter((item) => item.row.stepCode === code && isFollowUpStatus(item.row.status)).length,
      checked: kpiRows.filter((item) => item.row.stepCode === code).length,
    }));
  const maxKpiWorkflowCount = Math.max(1, ...kpiWorkflowFocusRows.map((item) => item.followUp));
  const kpiReportLines = [
    `Weekly CWCA Standards Report`,
    `Date range: ${filters.from || weekStart} to ${filters.to || today}`,
    `Standards: Welcome Letter Sent, Initial Meeting Set, Court Date Added To Clio`,
    ``,
    `Overall standards score: ${kpiScore}% (${kpiGrade})`,
    `Checked workflow items: ${kpiTotal}`,
    `Clear items: ${kpiClear}`,
    `Still needs follow-up: ${kpiFollowUp}`,
    `Late timing items: ${kpiLate}`,
    `Needs review items: ${kpiReview}`,
    ``,
    `Attorney focus:`,
    ...(kpiTopAttention.length
      ? kpiTopAttention.map((item) => `- ${item.attorney}: ${item.score}% score, ${item.followUp} follow-up item(s), main area: ${item.topArea}`)
      : ["- No attorney follow-up items in this date range."]),
    ``,
    `Suggested next step:`,
    kpiFollowUp
      ? `Open the Matters tab, filter to Needs Follow-Up, and verify the highest-priority proof links in Clio.`
      : `No current weekly follow-up items are showing in this date range.`,
  ].join("\n");
  const setupSnapshot = WORKFLOW_COLUMNS
    .filter(([code]) => workspaceFocusMatches(code, "initial-client-setup"))
    .map(([code, label]) => {
      const rows = initialClientSetupRows.filter((item) => item.row.stepCode === code);
      const followUp = rows.filter((item) => isFollowUpStatus(item.row.status)).length;
      return { code, label, followUp, checked: rows.length, clear: Math.max(0, rows.length - followUp) };
    });
  const postClosureNeedsOutreach =
    num(postClosureData.summary.due_now) +
    num(postClosureData.summary.overdue) +
    num(postClosureData.summary.in_progress) +
    num(postClosureData.summary.issue_found);
  const teamsNote = postClosureTeamsNote(postClosureData.rows, closureAttorneyFilter, closureStageFilter, closureWindowFilter);
  const touchpointCounts = new Map(postClosureData.touchpoints.map((touchpoint) => [String(touchpoint.touchpoint_months), touchpoint]));
  const notice =
    searchParams.audit === "ran"
      ? searchParams.message || "Audit run completed."
      : searchParams.audit === "failed"
        ? searchParams.message || "Audit run failed."
        : searchParams.postClosure === "synced"
          ? searchParams.message || "Post-closure follow-ups refreshed."
          : searchParams.postClosure === "saved"
            ? searchParams.message || "Post-closure follow-up saved."
            : searchParams.postClosure === "failed"
              ? searchParams.message || "Post-closure follow-up update failed."
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

      <section className="deployment-proof">
        <div>
          <span className="label">Deployment Proof</span>
          <strong>Closed-matter follow-up sync is active</strong>
          <p>Version {APP_VERSION}: Post-Closure refresh now searches Clio by close date and creates the 1, 6, and 12-month internal follow-up queue.</p>
        </div>
        <a className="button compact" href="/api/health" target="_blank" rel="noreferrer">Check Version</a>
      </section>

      {notice ? (
        <section className={searchParams.audit === "failed" || searchParams.clio === "failed" || searchParams.postClosure === "failed" ? "notice danger" : "notice"}>
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
            <p>Client name, case number, plea/status/hearing, email contact entries, and vague linked court entries can count when they are not obvious non-court events.</p>
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
        <div className="stat stat-blue"><span>Not Due Yet</span><strong>{dashboardData.summary.pending}</strong><p>These will escalate automatically after their saved deadline.</p></div>
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
            <p>Welcome letter, attorney call, court date, client contact, and appearance filing.</p>
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
              const href = evidencePath(item.row as DashboardItem, true);
              return (
                <div className={`priority-row status-row-${statusClass(item.row.status)}`} key={`${item.attorney}-${item.row.matterId}-${item.row.stepCode}`}>
                  <span>{badge(item.row.status)}</span>
                  <div>
                    <strong>{item.row.clientName}</strong>
                    <small>{item.attorney} - {item.row.matterNumber} - {workflowLabel(item.row.stepCode)}</small>
                  </div>
                  <div className="priority-links">
                    <a href={clioMatterPath(item.row.matterId)} target="_blank" rel="noreferrer">Clio</a>
                    {href ? <a href={href} target="_blank" rel="noreferrer">Proof</a> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="chart-empty">
            <strong>No priority follow-up items found.</strong>
            <p>When alerted, late, or review items appear, the top priorities will show here.</p>
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
            <div><strong>1. Start with Matters.</strong><span>Use the matter cards to see what needs follow-up and open the proof links.</span></div>
            <div><strong>2. Verify in Clio.</strong><span>Open the Clio link and proof link before deciding whether coaching is needed.</span></div>
            <div><strong>3. Set the report range.</strong><span>Use Reports to choose the exact dates you want covered before downloading.</span></div>
            <div><strong>4. Send the case-manager list.</strong><span>Download the flagged-matters review when you need a clean follow-up handoff.</span></div>
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
            <p>Matter IDs and numbers, client names, responsible attorney, timestamps, workflow statuses, evidence IDs or links, post-closure follow-up notes, audit-run history, and encrypted OAuth tokens.</p>
          </div>
          <div>
            <h3>What This Does Not Store</h3>
            <p>No communication bodies, note text, document contents, billing data, payment data, automatic client messages, or Clio write actions are saved here.</p>
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

      {activeTab === "kpi" ? (
      <section className="kpi-layout">
        <section className="panel kpi-hero">
          <div className="panel-heading">
            <div>
              <span className="label">Weekly Report</span>
              <h2>Standards</h2>
              <p className="muted small">Weekly CM standards for Welcome Letter, Initial Meeting, and Court Date Added.</p>
            </div>
            <span className={`badge ${kpiGrade === "Strong" ? "Pass" : kpiGrade === "Watch" ? "Late" : "Flag"}`}>{kpiGrade}</span>
          </div>
          <form className="kpi-range-form" action="/" method="get">
            <input type="hidden" name="tab" value="kpi" />
            <label>
              From
              <input name="from" type="date" defaultValue={filters.from || weekStart} />
            </label>
            <label>
              To
              <input name="to" type="date" defaultValue={filters.to || today} />
            </label>
            <label>
              Attorney
              <select name="attorney" defaultValue={filters.attorney}>
                <option value="">All attorneys</option>
                {dashboardData.attorneys.map((a) => (
                  <option key={a.id ?? "none"} value={a.id ?? ""}>{a.name || "Unassigned"} ({a.count})</option>
                ))}
              </select>
            </label>
            <button className="primary" type="submit">Update Standards</button>
            <a className="button" href={filterLink({ tab: "kpi" }, { from: weekStart, to: today })}>This Week</a>
          </form>
          <form action="/api/export.csv?type=standards" method="post" className="kpi-download-form">
            <input type="hidden" name="attorney" value={filters.attorney} />
            <input type="hidden" name="overall" value={filters.overall} />
            <input type="hidden" name="from" value={filters.from} />
            <input type="hidden" name="to" value={filters.to} />
            <button className="button primary" type="submit">Download Standards Workbook</button>
          </form>
          <details className="standards-week-links">
            <summary>Past weekly reports</summary>
            <div>
              {priorStandardWeeks.map((week) => (
                <a key={week.from} href={filterLink({ tab: "kpi" }, { from: week.from, to: week.to })}>
                  {week.label}
                </a>
              ))}
            </div>
          </details>
          <div className="kpi-score-row">
            <div className="kpi-score-ring" style={{ "--score": `${kpiScore * 3.6}deg` } as CSSProperties}>
              <span>{kpiScore}%</span>
            </div>
            <div className="kpi-score-copy">
              <strong>{kpiGrade}</strong>
              <p>{kpiFollowUp ? `${kpiFollowUp} workflow item${kpiFollowUp === 1 ? "" : "s"} still need follow-up this week.` : "No current weekly follow-up items are showing."}</p>
            </div>
          </div>
        </section>

        <section className="kpi-cards">
          <div className="kpi-card"><span># New Matters</span><strong>{standardsTotals.newMatters}</strong><p>New matters in this date range.</p></div>
          <div className="kpi-card"><span>Initial Meeting Set</span><strong>{standardsTotals.initialMeeting}</strong><p>Attorney call proof found.</p></div>
          <div className="kpi-card"><span>Welcome Letter Sent</span><strong>{standardsTotals.welcome}</strong><p>Welcome letter proof found.</p></div>
          <div className="kpi-card"><span>Court Date Added To Clio</span><strong>{standardsTotals.courtDate}</strong><p>Court date proof found.</p></div>
        </section>

        <section className="panel kpi-panel standards-graphic">
          <div className="panel-heading">
            <div>
              <h2>Standards By CM</h2>
              <p className="muted small">Quick visual for Welcome Letter, Initial Meeting, and Court Date Added.</p>
            </div>
          </div>
          {standardRows.length ? (
            <div className="standards-attorney-chart">
              {standardRows.map((item) => (
                <article className="standards-attorney-row" key={item.caseManager}>
                  <div className="standards-attorney-name">
                    <strong>{item.caseManager}</strong>
                    <span>{item.cases} case{item.cases === 1 ? "" : "s"}</span>
                    <em>{item.completionRate}% standards score</em>
                  </div>
                  <div className="standards-attorney-bars">
                    <div className="attorney-standard-line welcome">
                      <span>Welcome Letter{item.welcomeLate ? ` - ${item.welcomeLate} late` : ""}</span>
                      <div><b style={{ width: `${item.cases ? Math.max(4, Math.min(100, Math.round((item.welcome / item.cases) * 100))) : 0}%` }} /></div>
                      <strong>{item.welcome}/{item.cases}</strong>
                    </div>
                    <div className="attorney-standard-line meeting">
                      <span>Initial Meeting{item.attorneyCallLate ? ` - ${item.attorneyCallLate} late` : ""}</span>
                      <div><b style={{ width: `${item.cases ? Math.max(4, Math.min(100, Math.round((item.attorneyCall / item.cases) * 100))) : 0}%` }} /></div>
                      <strong>{item.attorneyCall}/{item.cases}</strong>
                    </div>
                    <div className="attorney-standard-line court-date">
                      <span>Court Date{item.courtDateLate ? ` - ${item.courtDateLate} late` : ""}</span>
                      <div><b style={{ width: `${item.cases ? Math.max(4, Math.min(100, Math.round((item.courtDate / item.cases) * 100))) : 0}%` }} /></div>
                      <strong>{item.courtDate}/{item.cases}</strong>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="workspace-empty compact">
              <strong>No Standards data in this range yet.</strong>
              <p>Run an audit batch or choose a date range with audited matters.</p>
            </div>
          )}
        </section>

        <section className="kpi-grid">
          <div className="panel kpi-panel">
            <div className="panel-heading">
              <div>
                <h2>CM Standards Scorecard</h2>
                <p className="muted small">Simple weekly counts by case manager.</p>
              </div>
            </div>
            {standardRows.length ? (
              <div className="standards-list">
                {standardRows.map((item) => (
                  <article className="standards-card" key={item.caseManager}>
                    <div className="standards-card-head">
                      <div>
                        <span className="label">CM</span>
                        <strong>{item.caseManager}</strong>
                      </div>
                      <div>
                        <span className="label">Date</span>
                        <strong>{standardsDate}</strong>
                      </div>
                    </div>
                    <div className="standards-metrics">
                      <div className="standard-metric cases"><span>Cases</span><strong>{item.cases}</strong><em>opened</em></div>
                      <div className="standard-metric welcome"><span>Welcome Letter</span><strong>{item.welcome}</strong><em>sent</em></div>
                      <div className="standard-metric meeting"><span>Initial Meeting</span><strong>{item.attorneyCall}</strong><em>set</em></div>
                      <div className="standard-metric new-matters"><span>New Matters</span><strong>{item.newMatters}</strong><em>added</em></div>
                      <div className="standard-metric court-date"><span>Court Date</span><strong>{item.courtDate}</strong><em>added to Clio</em></div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="workspace-empty">
                <strong>No Standards data in this range yet.</strong>
                <p>Run an audit batch or choose a date range with audited matters.</p>
              </div>
            )}
          </div>

          <div className="panel kpi-panel">
            <div className="panel-heading">
              <div>
                <h2>Standards Focus</h2>
                <p className="muted small">Welcome Letter, Attorney Call, and Court Date Added follow-up.</p>
              </div>
            </div>
            <div className="workflow-area-bars">
              {kpiWorkflowFocusRows.map((item) => (
                <div className="workflow-area-row" key={item.code}>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.followUp} follow-up / {item.checked} checked</small>
                  </div>
                  <div className="workflow-track">
                    <span style={{ width: `${item.followUp ? Math.max(3, Math.round((item.followUp / maxKpiWorkflowCount) * 100)) : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <details className="panel kpi-report-copy">
          <summary>
            <div>
              <span className="label">Copy-Ready</span>
              <h3>Weekly Standards summary for Teams</h3>
              <p className="muted small">Open when you want a short note to paste to the team.</p>
            </div>
            <span className="summary-action">Open Summary</span>
          </summary>
          <div className="post-closure-note-toolbar">
              <CopyTextButton targetId="kpi-weekly-report" label="Copy Standards Report" />
          </div>
          <textarea id="kpi-weekly-report" readOnly rows={Math.min(16, Math.max(8, kpiReportLines.split("\n").length + 1))} defaultValue={kpiReportLines} />
        </details>
      </section>
      ) : null}

      {activeTab === "post-closure" ? (
      <section className="post-closure-layout">
        <section className="panel post-closure-hero">
          <div className="panel-heading">
            <div>
              <span className="label">Closed Matter Follow-Up</span>
              <h2>Post-Closure Client Follow-Up</h2>
              <p className="muted small">Internal reminders for 1-month, 6-month, and 12-month client satisfaction calls after a matter closes. This view only shows matters closed in 2026.</p>
            </div>
            <span className="badge Pending">2026 only</span>
            <form action="/api/post-closure/sync" method="post">
              <button className="primary" type="submit">Refresh Closed Matters</button>
            </form>
          </div>
          <div className="post-closure-summary">
            <div><span>Total Reminders</span><strong>{postClosureData.summary.total}</strong></div>
            <div><span>Needs Outreach</span><strong>{postClosureNeedsOutreach}</strong></div>
            <div><span>Overdue</span><strong>{postClosureData.summary.overdue}</strong></div>
            <div><span>Issue Found</span><strong>{postClosureData.summary.issue_found}</strong></div>
            <div><span>Completed</span><strong>{postClosureData.summary.completed}</strong></div>
          </div>
          <p className="muted small">
            {postClosureData.lastSync ? `Last refreshed: ${formatLocal(postClosureData.lastSync)}` : "No closed-matter refresh has run yet."}
          </p>
        </section>

        <section className="panel post-closure-panel">
          <div className="panel-heading">
            <div>
              <h2>Follow-Up Queue</h2>
              <p className="muted small">Call the client, record what happened, and mark whether any issue needs attention.</p>
            </div>
            <span className="badge Pending">{postClosureData.rows.length} showing</span>
          </div>

          <form className="post-closure-simple-controls" action="/" method="get">
            <input type="hidden" name="tab" value="post-closure" />
            <label>
              <span>Show</span>
              <select name="closure_window" defaultValue={closureWindowFilter}>
                {POST_CLOSURE_WINDOW_FILTERS.map((filter) => (
                  <option value={filter.id} key={filter.id}>{filter.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select name="closure_status" defaultValue={closureStatusFilter}>
                {POST_CLOSURE_STATUS_FILTERS.map((filter) => (
                  <option value={filter.id} key={filter.id}>{filter.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Touchpoint</span>
              <select name="closure_stage" defaultValue={closureStageFilter}>
                <option value="">All touchpoints</option>
                {POST_CLOSURE_TOUCHPOINTS.map((touchpoint) => {
                  const counts = touchpointCounts.get(String(touchpoint.months));
                  return (
                    <option value={String(touchpoint.months)} key={touchpoint.months}>
                      {touchpoint.label}{counts ? ` (${counts.reminder_count})` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              <span>Attorney</span>
              <select name="closure_attorney" defaultValue={closureAttorneyFilter}>
                <option value="">All attorneys</option>
                {closureAttorneyFilter && !postClosureData.attorneys.some((attorney) => attorney.responsible_attorney_name === closureAttorneyFilter) ? (
                  <option value={closureAttorneyFilter}>{closureAttorneyFilter}</option>
                ) : null}
                {postClosureData.attorneys.map((attorney) => (
                  <option value={attorney.responsible_attorney_name} key={attorney.responsible_attorney_name}>
                    {attorney.responsible_attorney_name} ({attorney.open_count} open)
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" type="submit">Show Results</button>
            <a className="button" href="/?tab=post-closure">Reset</a>
            <p>Current Window shows 2026 closed-matter reminders due recently or coming up soon. Use Older Backlog only when you want older 2026 clean-up items.</p>
          </form>

          <details className="post-closure-team-note">
            <summary>
              <div>
                <span className="label">Team Message</span>
                <h3>Copy a follow-up note for Teams</h3>
                <p className="muted small">Open only when you need to send the queue to the team.</p>
              </div>
              <span className="summary-action">Open Note</span>
            </summary>
            <div className="post-closure-note-toolbar">
              <CopyTextButton targetId="post-closure-teams-note" label="Copy Teams Note" />
            </div>
            <textarea id="post-closure-teams-note" readOnly rows={Math.min(14, Math.max(6, teamsNote.split("\n").length + 1))} defaultValue={teamsNote} />
          </details>

          {postClosureData.rows.length ? (
            <div className="post-closure-list">
              {postClosureData.rows.map((row) => {
                const clientName = `${row.client_first_name ?? ""} ${row.client_last_name ?? ""}`.trim() || "Unnamed Client";
                return (
                  <details className={`post-closure-card status-row-${statusClass(row.display_status)}`} key={`${row.matter_id}-${row.touchpoint_months}`}>
                    <summary className="post-closure-card-head">
                      <div>
                        <span className="label">{row.touchpoint_label} Follow-Up</span>
                        <h3>{clientName}</h3>
                        <p>{row.matter_number}</p>
                      </div>
                      <div>
                        <span className="label">Attorney</span>
                        <strong>{row.responsible_attorney_name || "Unassigned"}</strong>
                      </div>
                      <div>
                        <span className="label">Closed</span>
                        <strong>{formatLocal(row.matter_closed_at)}</strong>
                      </div>
                      <div>
                        <span className="label">Due</span>
                        <strong>{formatLocal(row.due_at)}</strong>
                      </div>
                      <div className="post-closure-card-actions">
                        {badge(row.display_status)}
                        <a className="button compact" href={clioMatterPath(row.matter_id)} target="_blank" rel="noreferrer">Open in Clio</a>
                      </div>
                    </summary>
                    <div className="post-closure-card-body">
                      <div className="post-closure-purpose">
                        <strong>Goal</strong>
                        <p>Call or contact the client, record the result, and mark any issue that needs attention.</p>
                        {row.followup_note ? <p><b>Last note:</b> {row.followup_note}</p> : null}
                      </div>
                      <form className="post-closure-form" action="/api/post-closure/followups" method="post">
                        <input type="hidden" name="matter_id" value={row.matter_id} />
                        <input type="hidden" name="touchpoint_months" value={row.touchpoint_months} />
                        <input type="hidden" name="closure_status" value={closureStatusFilter} />
                        <input type="hidden" name="closure_stage" value={closureStageFilter} />
                        <input type="hidden" name="closure_attorney" value={closureAttorneyFilter} />
                        <input type="hidden" name="closure_window" value={closureWindowFilter} />
                        <label>
                          Status
                          <select name="review_status" defaultValue={row.review_status || "In Progress"}>
                            {POST_CLOSURE_REVIEW_STATUSES.map((status) => (
                              <option key={status}>{status}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Contact Method
                          <select name="contact_method" defaultValue={row.contact_method || "Phone"}>
                            {POST_CLOSURE_CONTACT_METHODS.map((method) => (
                              <option key={method}>{method}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Issue Type
                          <select name="issue_type" defaultValue={row.issue_type || "None"}>
                            {POST_CLOSURE_ISSUE_TYPES.map((issue) => (
                              <option key={issue}>{issue}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Staff Member
                          <input name="reviewed_by" defaultValue={row.reviewed_by} placeholder="Name" />
                        </label>
                        <label className="post-closure-note">
                          Follow-Up Note
                          <textarea
                            name="followup_note"
                            defaultValue={row.followup_note}
                            placeholder="Example: Client was called, confirmed no unresolved concerns, and no further action is needed."
                            rows={3}
                          />
                        </label>
                        <button className="primary" type="submit">Save</button>
                      </form>
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <div className="workspace-empty">
              <strong>No post-closure reminders match this view yet.</strong>
              <p>Click Refresh Closed Matters to read closed matters from Clio and create the 1, 6, and 12-month internal follow-up queue.</p>
            </div>
          )}
        </section>
      </section>
      ) : null}

      {activeTab === "reports" ? (
      <section className="panel report-panel">
        <div className="panel-heading">
          <div>
            <h2>Reports</h2>
          </div>
        </div>
        <section className="ai-tools-overview">
          <div className="ai-tools-intro">
            <span className="label">Manual AI</span>
            <h3>Use AI only when you choose a specific issue</h3>
            <p>AI does not run during audit batches or page loads. Use it only on a selected flagged matter or inside the weekly review builder, so cost stays controlled.</p>
          </div>
          <div className="ai-tools-grid">
            <div className="ai-tool-card">
              <span>1</span>
              <strong>Ask AI about one item</strong>
              <p>Open a flagged matter, expand Problems, then type a question in the small <b>Ask CWCA AI</b> box.</p>
            </div>
            <div className="ai-tool-card">
              <span>2</span>
              <strong>Draft report language</strong>
              <p>Open the weekly review builder, select one reviewed matter, then click <b>Draft with AI</b>.</p>
            </div>
          </div>
        </section>
        <details className="report-advanced-builder ai-builder-section" id="ai-review-builder">
          <summary>
            <div>
              <span className="label">AI Drafting</span>
              <h3>AI-assisted weekly review builder</h3>
              <p className="muted small">Open this to select a flagged matter and use Draft with AI for Results Details, Report Summary, and Teams wording.</p>
            </div>
            <span className="summary-action">Open AI Builder</span>
          </summary>
          <ReviewBuilder items={reviewBuilderItems} initialFrom={filters.from} initialTo={filters.to} />
        </details>
        <div className="report-grid">
          <form className="report-card report-card-wide" action="/api/export.csv?type=case-manager-text" method="post">
            <div>
              <span className="label">Main Report</span>
              <strong>End of the week Case manager clio audit report</strong>
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
          <form className="report-card" action={`/api/export.csv?${logicIssueExportParams.toString()}`} method="post">
            <div>
              <span className="label">Internal Diagnostics</span>
              <strong>Audit Logic Issues</strong>
              <p>Rows where CWCA hit an API error, unclear evidence, or a rule that may need tuning.</p>
            </div>
            <button type="submit">Download Issues</button>
          </form>
        </div>
        <details className="report-preview report-preview-collapsible">
          <summary>
            <div>
              <span className="label">Optional</span>
              <h3>Report format preview</h3>
              <p className="muted small">Open to see an example before downloading.</p>
            </div>
            <span className="summary-action">Open Preview</span>
          </summary>
          <pre>{`End of the week Case manager clio audit report

Priority Summary
* Flagged matters reviewed: 3
* Items still needing action: 2
* Completed late/resolved items: 1

Flagged Matters

1. Matter: [Client Name]
   Attorney: [Attorney Name]
   Matter Number: [Matter Number]
   Clio Link: [Insert Clio Matter Link]

   Alert / Flag: Alert: Welcome letter was not completed within the required timeframe.

   Flagged Matter & What Happened:
   Welcome Letter is still flagged because CWCA did not find matching proof in Clio.

   Results Details:
   No proof of completion has been found yet.

   Current Status:
   Still Needs Action

   Next Step:
   Send the welcome letter if not already sent

Completed Items
* [Client Name] - Attorney Call: Complete

Items Still Needing Action
* [Client Name] - Welcome Letter: Still Needs Action.`}</pre>
        </details>
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
          <a className="button" href={filterLink({ ...filters, tab: activeTab, wstatus: workspaceStatusFilter, wfocus: workspaceFocusFilter }, { from: weekStart, to: today })}>This Week</a>
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
                    const href = evidencePath(row as DashboardItem, true);
                    return (
                      <div className={`workspace-row status-row-${statusClass(row.status)}`} key={`${section.attorney}-${row.matterId}-${row.stepCode}`}>
                        <span>
                          <strong>{row.clientName}</strong>
                          <small>{row.matterNumber}</small>
                        </span>
                        <span>{workflowLabel(row.stepCode)}</span>
                        <span>{badge(currentItemStatus(row))}</span>
                        <span>
                          {row.deadlineAt ? <small>Due: {formatLocal(row.deadlineAt)}</small> : null}
                          {row.evidenceAt ? <small>Found: {formatLocal(row.evidenceAt)}</small> : null}
                          {!row.deadlineAt && !row.evidenceAt ? <small>No timing note</small> : null}
                        </span>
                        <span className="workspace-links">
                          <a href={clioMatterPath(row.matterId)} target="_blank" rel="noreferrer">Clio</a>
                          {href ? <a href={href} target="_blank" rel="noreferrer">Proof</a> : null}
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

      {activeTab === "case-manager" ? (
      <section className="case-manager-layout">
        <section className="panel case-manager-hero">
          <div className="panel-heading">
            <div>
              <span className="label">Case Manager Workspace</span>
              <h2>Clear Tasks With Clio Proof</h2>
              <p className="muted small">Case managers can explain what happened, but a task only clears when there is proof in Clio or a Clio proof link is pasted.</p>
            </div>
            <span className="badge Pending">{caseManagerTasks.length} tasks</span>
          </div>
          <div className="case-manager-stats">
            <div><span>Open</span><strong>{caseManagerOpen}</strong></div>
            <div><span>In Progress</span><strong>{caseManagerInProgress}</strong></div>
            <div><span>Needs Proof</span><strong>{caseManagerProofNeeded}</strong></div>
          </div>
          <details className="case-manager-note">
            <summary>
              <span>Copy Teams message</span>
              <b>Open</b>
            </summary>
            <div className="post-closure-note-toolbar">
              <CopyTextButton targetId="case-manager-teams-note" label="Copy Message" />
            </div>
            <textarea id="case-manager-teams-note" readOnly rows={Math.min(14, Math.max(7, caseManagerTeamsNote.split("\n").length + 1))} defaultValue={caseManagerTeamsNote} />
          </details>
        </section>

        <section className="case-manager-task-list">
          {caseManagerTasks.length ? (
            caseManagerTasks.map((item) => {
              const href = evidencePath(item.row as DashboardItem, true);
              return (
                <article className={`panel case-manager-task status-row-${statusClass(item.row.status)}`} key={`${item.row.matterId}-${item.row.stepCode}`}>
                  <div className="case-manager-task-head">
                    <div>
                      <span className="label">{workflowLabel(item.row.stepCode)}</span>
                      <h3>{item.row.clientName}</h3>
                      <p>{item.row.matterNumber}</p>
                    </div>
                    <div>
                      <span className="label">Attorney</span>
                      <strong>{item.attorney}</strong>
                    </div>
                    <div>
                      <span className="label">Status</span>
                      {badge(currentItemStatus(item.row))}
                    </div>
                    <div className="case-manager-task-actions">
                      <a className="button compact primary" href={clioMatterPath(item.row.matterId)} target="_blank" rel="noreferrer">Open in Clio</a>
                      {href ? <a className="button compact" href={href} target="_blank" rel="noreferrer">Saved Proof</a> : null}
                    </div>
                  </div>
                  <p className="case-manager-task-reason">{actionFor(item.row.stepCode, item.row.status, item.row.reasonCode)}</p>
                  <MatterReviewControls
                    matterId={item.row.matterId}
                    stepCode={item.row.stepCode}
                    auditItemLabel={workflowLabel(item.row.stepCode)}
                    currentDecision={item.row.reviewDecision}
                    currentNote={item.row.reviewNote}
                    currentNextStep={item.row.nextStep}
                    currentReviewedBy={item.row.reviewedBy}
                    currentCaseManagerName={item.row.caseManagerName}
                    currentProofReference={item.row.reviewProofReference}
                    existingProofUrl={href || null}
                    mode="case-manager"
                  />
                </article>
              );
            })
          ) : (
            <section className="panel workspace-empty">
              <strong>No case-manager tasks need follow-up right now.</strong>
              <p>When CWCA finds items that need attention, they will show here with proof-based clearing controls.</p>
            </section>
          )}
        </section>
      </section>
      ) : null}

      {activeTab === "matters" ? (
      <section className="matter-list">
        {dashboardData.matters.length ? dashboardData.matters.map((m) => {
          const items = m.items as DashboardItem[];
          const evidenceItems = items.filter((i) => evidencePath(i));
          const refreshNeeded = needsMatterRefresh(items);
          const attentionItems = items
            .filter(itemNeedsAttention)
            .sort((a, b) => auditItemPriority(a.status) - auditItemPriority(b.status));
          const nextAction = attentionItems[0];
          const matterStatus = matterCardStatus(items, String(m.display_overall_status ?? m.overall_status));
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
                  {badge(matterStatus)}
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

              {!refreshNeeded && nextAction ? (
                <details className={`matter-dropdown next-action-card status-row-${statusClass(currentItemStatus(nextAction))}`}>
                  <summary>
                    <span>
                      <span className="label">Next Best Action</span>
                      <strong>{actionFor(nextAction.stepCode, nextAction.status, nextAction.reasonCode)}</strong>
                    </span>
                    <span className="dropdown-pill" aria-hidden="true" />
                  </summary>
                  <div className="matter-dropdown-body next-action-content">
                    <p><b>Why?</b> {problemText(nextAction)}</p>
                    <div className="next-action-links">
                      <a className="button compact primary" href={clioMatterPath(m.matter_id)} target="_blank" rel="noreferrer">Open in Clio</a>
                      {evidencePath(nextAction, true) ? <a className="button compact" href={evidencePath(nextAction, true)} target="_blank" rel="noreferrer">Open Proof in Clio</a> : null}
                    </div>
                  </div>
                </details>
              ) : null}

              {refreshNeeded ? (
                <div className="refresh-needed">
                  <strong>This matter needs one fresh Clio check.</strong>
                  <span>The saved result is from an older incomplete API run, so it is not proof of undone work yet.</span>
                </div>
              ) : (
                <section className="workflow-always-visible">
                  <div className="workflow-always-head">
                    <span className="label">Workflow Checks</span>
                    <strong>{attentionItems.length ? `${attentionItems.length} item${attentionItems.length === 1 ? "" : "s"} need follow-up` : "All workflow checks visible"}</strong>
                  </div>
                  <div className="step-grid">
                    {WORKFLOW_COLUMNS.map(([code, label]) => (
                      <div className="step-block" key={code}>
                        <span className="step-label">{label}</span>
                        {stepCell(items, code)}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className={`matter-compact-sections ${attentionItems.length ? "" : "evidence-only"}`}>
                {attentionItems.length ? (
                  <details className="matter-dropdown problems-dropdown">
                    <summary>
                      <span>
                        <span className="label">Problems</span>
                        <strong>{attentionItems.length} item{attentionItems.length === 1 ? "" : "s"} need review or follow-up</strong>
                      </span>
                      <span className="dropdown-pill" aria-hidden="true" />
                    </summary>
                    <div className="matter-dropdown-body">
                      {problemList(
                        {
                          matterId: String(m.matter_id),
                          matterNumber: m.matter_number,
                          clientName: `${m.client_first_name ?? ""} ${m.client_last_name ?? ""}`.trim() || m.matter_number,
                          attorney: m.responsible_attorney_name || "Unassigned",
                        },
                        items,
                      )}
                    </div>
                  </details>
                ) : null}
                <details className="matter-dropdown evidence-dropdown">
                  <summary>
                    <span>
                      <span className="label">Evidence</span>
                      <strong>{evidenceItems.length ? `${evidenceItems.length} proof link${evidenceItems.length === 1 ? "" : "s"} saved` : "No proof links saved yet"}</strong>
                    </span>
                    <span className="dropdown-pill" aria-hidden="true" />
                  </summary>
                  <div className="matter-dropdown-body">
                  <p className="evidence-links">
                    <span>Matter: {m.matter_number}</span>
                    <a href={clioMatterPath(m.matter_id)} target="_blank" rel="noreferrer">Open Matter in Clio</a>
                  </p>
                  {evidenceItems.length ? (
                    evidenceItems.map((i) => (
                      <p className="evidence-links" key={`${i.stepCode}-${i.evidenceRefId ?? i.evidenceUrl}`}>
                        <span>{i.stepCode.replaceAll("_", " ")}: {evidenceLabel(i)}</span>
                        <a href={evidencePath(i, true)} target="_blank" rel="noreferrer">Open Proof in Clio</a>
                      </p>
                    ))
                  ) : (
                    <p>None yet</p>
                  )}
                  </div>
                </details>
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
