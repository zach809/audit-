import { redirect } from "next/navigation";
import { getDashboardData } from "@/lib/dashboard-data";
import { hasDashboardSession } from "@/lib/session";
import { hasClioConnection } from "@/lib/token-store";
import { formatLocal } from "@/lib/business-time";
import { APP_VERSION } from "@/lib/version";
import { APP_TZ } from "@/lib/config";

export const dynamic = "force-dynamic";

function badge(value: string | null | undefined) {
  const label = value || "";
  const cls = label.replace(/\s+/g, "-").replace("/", "A");
  return <span className={`badge ${cls}`}>{label || "N/A"}</span>;
}

function step(items: Array<{ stepCode: string; status: string; operationalState?: string }>, code: string) {
  const item = items.find((i) => i.stepCode === code);
  return item?.status ?? "Pending";
}

function itemLabels(items: Array<{ stepCode: string; status: string }>, status: string) {
  return items.filter((i) => i.status === status).map((i) => i.stepCode.replaceAll("_", " ")).join(", ");
}

function itemLabelsWithReasons(items: Array<{ stepCode: string; status: string; reasonCode?: string }>, status: string) {
  return items
    .filter((i) => i.status === status)
    .map((i) => `${i.stepCode.replaceAll("_", " ")}${i.reasonCode ? ` (${i.reasonCode})` : ""}`)
    .join(", ");
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

const STEP_INFO: Record<string, { label: string; missing: string; action: string; late: string }> = {
  SETUP_WELCOME: {
    label: "Welcome Packet",
    missing: "Welcome packet email/template was not found in Clio communications.",
    action: "Check or send the Welcome Letter / Carta de bienvenida template.",
    late: "Welcome packet was found, but after the setup deadline.",
  },
  SETUP_ATTY_CALL: {
    label: "Attorney Call",
    missing: "Attorney/client phone call calendar event was not found.",
    action: "Add or verify a Phone Call / Client Call calendar event on the matter.",
    late: "Attorney/client call was scheduled after the setup deadline.",
  },
  SETUP_COURT_DATE: {
    label: "Court Date Added",
    missing: "Court date calendar event was not found.",
    action: "Add or verify the court/hearing/plea/status/continuance calendar event on the matter.",
    late: "Court date was added after the setup deadline.",
  },
  CLIENT_CONTACT: {
    label: "Client Contact",
    missing: "Outgoing client contact communication was not found.",
    action: "Check or send an email/log communication to the client.",
    late: "Client contact was found, but after the next-business-day deadline.",
  },
  APPEARANCE_FILING: {
    label: "Appearance Filed",
    missing: "Appearance filing communication/template was not found.",
    action: "Check or send the appearance filing notification template.",
    late: "Appearance filing was found, but after the second-business-day deadline.",
  },
  COURT_RESULTS: {
    label: "Court Results",
    missing: "Court result communication/template was not found after the last court date.",
    action: "Check or send the Court Result / Resultado template.",
    late: "Court result was found, but after the court-results deadline.",
  },
  POST_COURT_CALL: {
    label: "Post-Court Call",
    missing: "Post-court attorney/client call calendar event was not found.",
    action: "Schedule or verify the post-court attorney call if the case continues.",
    late: "Post-court call was scheduled after the post-court deadline.",
  },
  CLIENT_FOLLOWUP: {
    label: "Client Follow-Up",
    missing: "Client follow-up risk detected: three or more inbound client communications before a firm response.",
    action: "Review the communication thread and respond or coach as needed.",
    late: "Client follow-up was handled late.",
  },
};

const STEP_COLUMNS = Object.entries(STEP_INFO).map(([code, info]) => [code, info.label] as [string, string]);

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
  return STEP_INFO[code]?.label ?? code.replaceAll("_", " ");
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
  const info = STEP_INFO[item.stepCode] ?? {
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

export default async function Dashboard({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!hasDashboardSession()) redirect("/login");
  const connected = await hasClioConnection().catch(() => false);
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
      <div className="topbar">
        <div className="title">
          <h1>Clio Workflow Compliance Auditor</h1>
          <p>Read-only dashboard grouped by responsible attorney.</p>
          <p className="muted small">Version: {APP_VERSION}</p>
        </div>
        <div className="actions">
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
            <button className="primary" type="submit">Run Audit Batch</button>
          </form>
          <form action={`/api/export.csv?${exportParams}`} method="post">
            <button type="submit">Export CSV</button>
          </form>
          <form action={`/api/export.csv?${actionExportParams.toString()}`} method="post">
            <button type="submit">Export Attorney Assistant Report</button>
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

      <section className="queue-panel">
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

      <section className="panel compliance-panel">
        <div className="panel-heading">
          <div>
            <h2>Compliance And Data Handling</h2>
            <p className="muted small">Built for internal workflow coaching with read-only Clio access and minimal local storage.</p>
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

      <section className="panel">
        <form className="filters">
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
          <a className="button" href={filterLink(filters, { from: today, to: today })}>Today</a>
          <a className="button" href={filterLink(filters, { from: monthStart, to: today })}>This Month</a>
          <a className="button" href={filterLink(filters, { from: "", to: "" })}>All Dates</a>
        </div>
        {hasFilters ? (
          <p className="filter-alert">
            Filtered view is on. The totals and table now match these filters.
          </p>
        ) : null}
        <p className="muted small">
          Run Audit Batch checks up to {auditBatchSize} matters at a time and returns after about 25 seconds if Clio is slow. {uncheckedCount > 0 ? `${uncheckedCount} ${waitingLabel} left, about ${batchesLeft} ${batchLabel} to finish this view.` : "Everything discovered has been checked."}
        </p>
        <p className="muted small">
          Last run: {data.lastRun ? `${data.lastRun.status} at ${formatLocal(data.lastRun.finished_at ?? data.lastRun.started_at)} - ${data.lastRun.message ?? ""}` : "No audit has run yet."}
        </p>
        <p className="muted small">Showing the first 150 matching matters. Use filters or CSV export for broader review.</p>
        <p className="muted small">Export Attorney Assistant Report downloads the exact late, missing, and review items to send to assistants, with the timeliness goal, improvement action, proof link, and Clio matter link.</p>
      </section>

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
                  {STEP_COLUMNS.map(([code, label]) => (
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

      <section className="panel">
        <h2>Current Month Attorney Coaching Summary</h2>
        <p className="muted small">This turns the monthly counts into coaching areas. It is based only on Clio-visible workflow evidence.</p>
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
    </main>
  );
}
