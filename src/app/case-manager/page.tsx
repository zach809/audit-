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

function clioMatterPath(matterId: string): string {
  return `${appConfig().clioBaseUrl}/nc/#/matters/${encodeURIComponent(matterId)}`;
}

function clioTaskPath(row: WorkspaceAuditItem): string {
  const matterUrl = clioMatterPath(row.matter_id);
  if (["SETUP_ATTY_CALL", "SETUP_COURT_DATE", "POST_COURT_CALL", "WEEKLY_CLIENT_CHECKIN"].includes(row.step_code)) {
    return `${matterUrl}/calendar`;
  }
  if (["SETUP_WELCOME", "APPEARANCE_FILING", "COURT_RESULTS", "CLIENT_CONTACT", "CLIENT_FOLLOWUP"].includes(row.step_code)) {
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
  searchParams: { q?: string; cmname?: string; cm?: string; message?: string };
}) {
  const caseManagerName = currentCaseManagerName();
  if (!caseManagerName) redirect("/case-manager/login");

  const dashboardData = await getDashboardData({});
  const query = String(searchParams.q ?? "");
  const cmNameFilter = String(searchParams.cmname ?? "");
  const portalOwner = portalOwnerName(caseManagerName);
  const showAllAssignments = canSeeAllAssignments(caseManagerName);
  const tasks = dashboardData.workspaceItems
    .filter(isOpenTask)
    .filter((row) => showAllAssignments || ownerMatches(row, portalOwner))
    .filter((row) => taskMatches(row, query, cmNameFilter))
    .sort((a, b) => {
      const dueA = a.deadline_at ? new Date(String(a.deadline_at)).getTime() : Number.MAX_SAFE_INTEGER;
      const dueB = b.deadline_at ? new Date(String(b.deadline_at)).getTime() : Number.MAX_SAFE_INTEGER;
      return dueA - dueB || clientName(a).localeCompare(clientName(b));
    });

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
              ? "Admin view: showing all assigned case-manager tasks."
              : `Showing tasks assigned to ${portalOwner} by attorney assignment.`}
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
        </div>
        <ol className="cm-simple-steps" aria-label="How to clear tasks">
          <li><b>1</b><span>Open the right Clio tab.</span></li>
          <li><b>2</b><span>Complete or confirm the work.</span></li>
          <li><b>3</b><span>Click verify so CWCA can recheck proof.</span></li>
        </ol>
      </section>

      <form className="cm-task-filters" action="/case-manager" method="get">
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
            </article>
          );
        }) : (
          <section className="cm-empty">
            <strong>No tasks need review right now.</strong>
            <p>When CWCA finds work that needs proof in Clio, it will appear here.</p>
          </section>
        )}
      </section>

      <footer className="cm-footer">Version: {APP_VERSION}</footer>
    </main>
  );
}
