import { redirect } from "next/navigation";
import { getDashboardData, standardsCaseManagerFor, type WorkspaceAuditItem } from "@/lib/dashboard-data";
import { actionFor, displayAuditStatus, isFollowUpStatus, statusClass, workspaceStatus } from "@/lib/audit-display";
import { formatLocal } from "@/lib/business-time";
import { appConfig } from "@/lib/config";
import { currentCaseManagerName } from "@/lib/session";
import { APP_VERSION } from "@/lib/version";
import { workflowLabel } from "@/lib/workflow-rules";

export const dynamic = "force-dynamic";

const CLEARING_DECISIONS = new Set(["Resolved", "No Action Needed", "Approved Exception"]);
const CLIENT_COMMUNICATION_STEPS = new Set(["CLIENT_CONTACT", "CLIENT_FOLLOWUP", "WEEKLY_CLIENT_CHECKIN", "COURT_REMINDER_CALL"]);
const DATE_PART_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type CaseManagerWindow = "this-week" | "past-week";

function clioMatterPath(matterId: string): string {
  return `${appConfig().clioBaseUrl}/nc/#/matters/${encodeURIComponent(matterId)}`;
}

function clioTaskPath(row: WorkspaceAuditItem): string {
  const matterUrl = clioMatterPath(row.matter_id);
  if (["SETUP_ATTY_CALL", "SETUP_COURT_DATE", "POST_COURT_CALL", "WEEKLY_CLIENT_CHECKIN"].includes(row.step_code)) {
    return `${matterUrl}/calendar`;
  }
  if (["SETUP_WELCOME", "APPEARANCE_FILING", "COURT_RESULTS", "CLIENT_CONTACT", "CLIENT_FOLLOWUP", "COURT_REMINDER_CALL"].includes(row.step_code)) {
    return `${matterUrl}/communications`;
  }
  return matterUrl;
}

function clioProofPath(row: WorkspaceAuditItem): string {
  if (row.evidence_url) return row.evidence_url;
  const matterUrl = clioMatterPath(row.matter_id);
  if (row.evidence_source === "Communication") return `${matterUrl}/communications`;
  if (row.evidence_source === "Calendar") return `${matterUrl}/calendar`;
  return matterUrl;
}

function clientName(row: WorkspaceAuditItem): string {
  return `${row.client_first_name ?? ""} ${row.client_last_name ?? ""}`.trim() || "Unnamed client";
}

function isOpenTask(row: WorkspaceAuditItem): boolean {
  const status = workspaceStatus(row.item_status, row.reason_code);
  return isFollowUpStatus(status) && !CLEARING_DECISIONS.has(row.review_decision ?? "");
}

function isClientCommunicationTask(row: WorkspaceAuditItem): boolean {
  return CLIENT_COMMUNICATION_STEPS.has(row.step_code);
}

function cmOpportunityText(row: WorkspaceAuditItem): string {
  switch (row.step_code) {
    case "SETUP_WELCOME":
      return "Send or confirm the Welcome Letter email template in Clio.";
    case "SETUP_ATTY_CALL":
      return "Create or confirm the attorney/client phone-call calendar event.";
    case "SETUP_COURT_DATE":
      return "Add or confirm the client's court-date calendar event.";
    case "WEEKLY_CLIENT_CHECKIN":
      return "Confirm the weekly client check-in event and same-day call proof.";
    case "COURT_REMINDER_CALL":
      return "Confirm the court reminder call before the upcoming court date.";
    case "CLIENT_CONTACT":
    case "CLIENT_FOLLOWUP":
      return "Confirm the client received a firm response or outreach.";
    default:
      return "Open Clio, complete the missing proof, then verify with CWCA.";
  }
}

function normalizeName(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function portalOwnerName(loginName: string): string {
  const local = loginName.includes("@") ? loginName.split("@")[0] : loginName;
  const normalized = normalizeName(local);
  const knownOwners: Record<string, string> = {
    alessandra: "Alessandra",
    anahi: "Anahi",
    camila: "Camila",
    claudia: "Claudia",
    ivan: "Ivan",
    jesus: "Jesus",
    lori: "Lori",
    nathaly: "Nathaly",
    ronald: "Ronald",
    svetlana: "Svetlana",
    zach: "Admin",
  };
  return knownOwners[normalized] ?? loginName.trim();
}

function canSeeAllAssignments(loginName: string): boolean {
  const normalized = normalizeName(loginName.includes("@") ? loginName.split("@")[0] : loginName);
  return normalized === "zach" || normalized === "admin";
}

function ownerMatches(row: WorkspaceAuditItem, ownerName: string): boolean {
  const assignedOwner = standardsCaseManagerFor(row);
  return normalizeName(assignedOwner) === normalizeName(ownerName);
}

function dateKey(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const parts = DATE_PART_FORMATTER.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function keyToUtcDate(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(key: string, days: number): string {
  const date = keyToUtcDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekStart(key: string): string {
  const date = keyToUtcDate(key);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(key, mondayOffset);
}

function taskWindow(value: string | undefined): CaseManagerWindow {
  return value === "past-week" ? "past-week" : "this-week";
}

function taskWindowBounds(window: CaseManagerWindow): { start: string; end: string; label: string } {
  const currentStart = weekStart(dateKey(new Date()));
  const start = window === "past-week" ? addDays(currentStart, -7) : currentStart;
  const end = addDays(start, 6);
  return {
    start,
    end,
    label: window === "past-week" ? "Past Week" : "This Week",
  };
}

function taskDueKey(row: WorkspaceAuditItem): string {
  return dateKey(row.deadline_at ?? row.matter_created_at);
}

function inTaskWindow(row: WorkspaceAuditItem, window: CaseManagerWindow): boolean {
  const key = taskDueKey(row);
  if (!key) return false;
  const bounds = taskWindowBounds(window);
  return key >= bounds.start && key <= bounds.end;
}

function windowHref(window: CaseManagerWindow, query: string, caseManager: string): string {
  const params = new URLSearchParams();
  params.set("window", window);
  if (query) params.set("q", query);
  if (caseManager) params.set("cmname", caseManager);
  return `/case-manager?${params.toString()}`;
}

function taskMatches(row: WorkspaceAuditItem, query: string, caseManager: string): boolean {
  const assignedOwner = standardsCaseManagerFor(row);
  const haystack = [
    clientName(row),
    row.matter_number,
    row.responsible_attorney_name,
    row.case_manager_name,
    assignedOwner,
    workflowLabel(row.step_code),
  ].join(" ").toLowerCase();
  const queryMatch = !query || haystack.includes(query.toLowerCase());
  const cmHaystack = [assignedOwner, row.case_manager_name].join(" ").toLowerCase();
  const cmMatch = !caseManager || cmHaystack.includes(caseManager.toLowerCase());
  return queryMatch && cmMatch;
}

export default async function CaseManagerPortalPage({
  searchParams,
}: {
  searchParams: { q?: string; cmname?: string; cm?: string; message?: string; window?: string };
}) {
  const caseManagerName = currentCaseManagerName();
  if (!caseManagerName) redirect("/case-manager/login");

  const dashboardData = await getDashboardData({});
  const query = String(searchParams.q ?? "");
  const cmNameFilter = String(searchParams.cmname ?? "");
  const activeWindow = taskWindow(searchParams.window);
  const activeWindowBounds = taskWindowBounds(activeWindow);
  const portalOwner = portalOwnerName(caseManagerName);
  const showAllAssignments = canSeeAllAssignments(caseManagerName);
  const visibleBaseTasks = dashboardData.workspaceItems
    .filter(isOpenTask)
    .filter((row) => showAllAssignments || ownerMatches(row, portalOwner))
    .filter((row) => taskMatches(row, query, cmNameFilter));
  const thisWeekCount = visibleBaseTasks.filter((row) => inTaskWindow(row, "this-week")).length;
  const pastWeekCount = visibleBaseTasks.filter((row) => inTaskWindow(row, "past-week")).length;
  const tasks = visibleBaseTasks
    .filter((row) => inTaskWindow(row, activeWindow))
    .sort((a, b) => {
      const dueA = a.deadline_at ? new Date(String(a.deadline_at)).getTime() : Number.MAX_SAFE_INTEGER;
      const dueB = b.deadline_at ? new Date(String(b.deadline_at)).getTime() : Number.MAX_SAFE_INTEGER;
      return dueA - dueB || clientName(a).localeCompare(clientName(b));
    });
  const communicationTasks = tasks.filter(isClientCommunicationTask);
  const overdueTasks = tasks.filter((row) => row.deadline_at && new Date(String(row.deadline_at)).getTime() < Date.now());
  const weeklyCallTasks = tasks.filter((row) => row.step_code === "WEEKLY_CLIENT_CHECKIN");
  const courtReminderTasks = tasks.filter((row) => row.step_code === "COURT_REMINDER_CALL");
  const onboardingTasks = tasks.filter((row) => ["SETUP_WELCOME", "SETUP_ATTY_CALL", "SETUP_COURT_DATE"].includes(row.step_code));
  const reviewOpportunityTasks = tasks.filter((row) => ["Unknown", "Needs Review"].includes(workspaceStatus(row.item_status, row.reason_code)));

  const message = searchParams.message ? decodeURIComponent(String(searchParams.message)) : "";
  const messageClass = searchParams.cm === "cleared" ? "cm-alert success" : searchParams.cm ? "cm-alert warning" : "cm-alert";

  return (
    <main className="cm-portal-shell">
      <header className="cm-portal-header">
        <div>
          <span className="label">Case Manager Portal</span>
          <h1>My Clio Follow-Up Tasks</h1>
          <p>Fix the item in Clio first. Then ask CWCA to verify it. Tasks only clear when proof is found in Clio.</p>
          <p className="cm-assignment-note">
            {showAllAssignments
              ? `Admin view: showing ${activeWindowBounds.label.toLowerCase()} assigned case-manager tasks.`
              : `Showing ${activeWindowBounds.label.toLowerCase()} tasks assigned to ${portalOwner} by attorney assignment.`}
          </p>
        </div>
        <div className="cm-portal-actions">
          <span className="badge On-Track">{caseManagerName}</span>
          <form action="/logout" method="post">
            <button className="button" type="submit">Log Out</button>
          </form>
        </div>
      </header>

      {message ? <p className={messageClass}>{message}</p> : null}

      <section className="cm-queue-summary">
        <div>
          <span>Needs Your Review</span>
          <strong>{tasks.length}</strong>
          <small>{activeWindowBounds.label}: {activeWindowBounds.start} to {activeWindowBounds.end}</small>
        </div>
        <nav className="cm-window-tabs" aria-label="Task week">
          <a className={activeWindow === "this-week" ? "active" : ""} href={windowHref("this-week", query, cmNameFilter)}>
            This Week <b>{thisWeekCount}</b>
          </a>
          <a className={activeWindow === "past-week" ? "active" : ""} href={windowHref("past-week", query, cmNameFilter)}>
            Past Week <b>{pastWeekCount}</b>
          </a>
        </nav>
        <ol className="cm-simple-steps" aria-label="How to clear tasks">
          <li><b>1</b><span>Open the right Clio tab.</span></li>
          <li><b>2</b><span>Complete or confirm the work.</span></li>
          <li><b>3</b><span>Click verify so CWCA can recheck proof.</span></li>
        </ol>
      </section>

      <section className="cm-notification-strip" aria-label="Case manager reminders">
        <div>
          <span>Follow-ups this week</span>
          <strong>{tasks.length}</strong>
          <small>Open items assigned to you in this view.</small>
        </div>
        <div className={communicationTasks.length ? "attention" : ""}>
          <span>Client communication reminders</span>
          <strong>{communicationTasks.length}</strong>
          <small>{communicationTasks.length ? "Open Clio and confirm the client was contacted." : "No client communication reminders in this view."}</small>
        </div>
        <div className={overdueTasks.length ? "attention" : ""}>
          <span>Past due</span>
          <strong>{overdueTasks.length}</strong>
          <small>{overdueTasks.length ? "Handle these first or request admin review if they should not count." : "Nothing past due in this view."}</small>
        </div>
        <div className={weeklyCallTasks.length ? "attention" : ""}>
          <span>Weekly calls</span>
          <strong>{weeklyCallTasks.length}</strong>
          <small>{weeklyCallTasks.length ? "Check weekly call events and matching call proof." : "No weekly call tasks in this view."}</small>
        </div>
        <div className={courtReminderTasks.length ? "attention" : ""}>
          <span>Court reminders</span>
          <strong>{courtReminderTasks.length}</strong>
          <small>{courtReminderTasks.length ? "Confirm court reminder calls before court." : "No court reminder tasks in this view."}</small>
        </div>
        <div className={onboardingTasks.length ? "attention" : ""}>
          <span>New matter setup</span>
          <strong>{onboardingTasks.length}</strong>
          <small>{onboardingTasks.length ? "Welcome Letter, phone call, or court date needs proof." : "No onboarding tasks in this view."}</small>
        </div>
        <div className={reviewOpportunityTasks.length ? "attention" : ""}>
          <span>Needs a second look</span>
          <strong>{reviewOpportunityTasks.length}</strong>
          <small>{reviewOpportunityTasks.length ? "Open Clio and verify proof before asking admin." : "No manual-review tasks in this view."}</small>
        </div>
      </section>

      <form className="cm-task-filters" action="/case-manager" method="get">
        <input type="hidden" name="window" value={activeWindow} />
        <label>
          Find a task
          <input name="q" defaultValue={query} placeholder="Client, matter, attorney..." />
        </label>
        <label>
          Case manager
          <input name="cmname" defaultValue={cmNameFilter} placeholder="Type a CM name" />
        </label>
        <button className="primary" type="submit">Filter</button>
        <a className="button" href="/case-manager">Clear</a>
      </form>

      <section className="cm-task-list">
        {tasks.length ? tasks.map((row) => {
          const status = workspaceStatus(row.item_status, row.reason_code);
          const assignedOwner = standardsCaseManagerFor(row);
          return (
            <article className={`cm-task-card status-row-${statusClass(status)}`} key={`${row.matter_id}-${row.step_code}`}>
              <div className="cm-task-main">
                <div>
                  <span className="label">{workflowLabel(row.step_code)}</span>
                  <h2>{clientName(row)}</h2>
                  <p>{row.matter_number}</p>
                </div>
                <span className={`badge ${statusClass(status)}`}>{displayAuditStatus(status, row.reason_code)}</span>
              </div>

              <div className="cm-next-step">
                <span>What to do</span>
                <strong>{actionFor(row.step_code, status, row.reason_code)}</strong>
              </div>

              {isClientCommunicationTask(row) ? (
                <div className="cm-client-reminder">
                  <strong>Client communication reminder</strong>
                  <span>Before this clears, Clio needs proof that the client was contacted or followed up with.</span>
                </div>
              ) : null}

              <div className="cm-task-opportunity">
                <strong>{workflowLabel(row.step_code)} opportunity</strong>
                <span>{cmOpportunityText(row)}</span>
              </div>

              <div className="cm-task-meta">
                <span><b>Case Manager</b>{assignedOwner}</span>
                <span><b>Attorney</b>{row.responsible_attorney_name || "Unassigned"}</span>
                <span><b>Due</b>{row.deadline_at ? formatLocal(row.deadline_at) : "No deadline"}</span>
                <span><b>Proof Status</b>{row.evidence_ref_id ? "Proof already saved" : "Needs proof in Clio"}</span>
              </div>

              <div className="cm-task-buttons">
                <a className="button compact primary" href={clioTaskPath(row)} target="_blank" rel="noreferrer">Open Correct Clio Tab</a>
                <a className="button compact" href={clioMatterPath(row.matter_id)} target="_blank" rel="noreferrer">Open Matter</a>
                {row.evidence_ref_id || row.evidence_url ? (
                  <a className="button compact" href={clioProofPath(row)} target="_blank" rel="noreferrer">Open Saved Proof</a>
                ) : null}
              </div>

              <details className="cm-complete-details">
                <summary>
                  <span>I fixed this in Clio</span>
                  <b>Verify Task</b>
                </summary>
                <form className="cm-complete-form" action="/api/case-manager/complete" method="post">
                  <input type="hidden" name="matter_id" value={row.matter_id} />
                  <input type="hidden" name="step_code" value={row.step_code} />
                  <label>
                    Quick note
                    <textarea name="note" rows={3} placeholder={`Example: ${workflowLabel(row.step_code)} was completed in Clio.`} />
                  </label>
                  <label>
                    Optional Clio link
                    <input name="proof_reference" placeholder="Paste the Clio proof link if you have it" />
                  </label>
                  <button className="primary" type="submit">Verify With CWCA</button>
                  <small>CWCA will recheck Clio. If proof is not found, this task stays open.</small>
                </form>
              </details>

              <details className="cm-complete-details cm-admin-request">
                <summary>
                  <span>This should not count in Standards</span>
                  <b>Ask Admin</b>
                </summary>
                <form className="cm-complete-form" action="/api/metrics/exclusion" method="post">
                  <input type="hidden" name="action" value="request" />
                  <input type="hidden" name="matter_id" value={row.matter_id} />
                  <label>
                    Why should admin review this?
                    <textarea name="reason" rows={3} placeholder="Example: Duplicate matter, wrong assignment, not a Standards case, or special exception." />
                  </label>
                  <button className="button" type="submit">Send Admin Request</button>
                  <small>This only asks admin to review it. It does not remove the task or change the score by itself.</small>
                </form>
              </details>
            </article>
          );
        }) : (
          <section className="cm-empty">
            <strong>No tasks need review right now.</strong>
            <p>No open tasks match {activeWindowBounds.label.toLowerCase()}. Use Past Week if you need to review last week.</p>
          </section>
        )}
      </section>

      <footer className="cm-footer">Version: {APP_VERSION}</footer>
    </main>
  );
}
