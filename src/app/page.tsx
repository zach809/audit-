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
  evidenceSource?: string;
  evidenceRefId?: string;
  evidenceUrl?: string;
};

function evidencePath(item: DashboardItem): string {
  if (item.evidenceRefId && item.evidenceSource === "Communication") return `/evidence/communications/${item.evidenceRefId}`;
  if (item.evidenceRefId && item.evidenceSource === "Calendar") return `/evidence/calendar_entries/${item.evidenceRefId}`;
  return item.evidenceUrl ?? "";
}

function evidenceLabel(item: DashboardItem): string {
  return item.evidenceSource && item.evidenceRefId ? `${item.evidenceSource} #${item.evidenceRefId}` : "Evidence";
}

function stepCell(items: DashboardItem[], code: string) {
  const item = items.find((i) => i.stepCode === code);
  const status = item?.status ?? "Pending";
  const detail = item?.reasonCode || item?.operationalState || "";
  const href = item ? evidencePath(item) : "";
  return (
    <div className="step-cell">
      {badge(status)}
      {detail && detail !== status ? <div className="detail">{detail}</div> : null}
      {href ? <a className="evidence-link" href={href}>{evidenceLabel(item!)}</a> : null}
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
  const exportParams = new URLSearchParams(filters).toString();
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
            <button className="primary" type="submit">Refresh Recent</button>
          </form>
          <form action={`/api/export.csv?${exportParams}`} method="post">
            <button type="submit">Export CSV</button>
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

      <section className="grid">
        <div className="stat"><span>Total</span><strong>{data.summary.total}</strong></div>
        <div className="stat"><span>Pass</span><strong>{data.summary.pass}</strong></div>
        <div className="stat"><span>Pending</span><strong>{data.summary.pending}</strong></div>
        <div className="stat"><span>Late</span><strong>{data.summary.late}</strong></div>
        <div className="stat"><span>Flag</span><strong>{data.summary.flag}</strong></div>
        <div className="stat"><span>Review</span><strong>{data.summary.review}</strong></div>
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
          Last run: {data.lastRun ? `${data.lastRun.status} at ${formatLocal(data.lastRun.finished_at ?? data.lastRun.started_at)} - ${data.lastRun.message ?? ""}` : "No audit has run yet."}
        </p>
        <p className="muted small">Showing the first 150 matching matters. Use filters or CSV export for broader review.</p>
      </section>

      <section className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Matter</th>
              <th>Attorney</th>
              <th>Overall</th>
              <th>Welcome Packet</th>
              <th>Attorney Call</th>
              <th>Court Date Added</th>
              <th>Client Contact</th>
              <th>Appearance Filed</th>
              <th>Court Results</th>
              <th>Post-Court Call</th>
              <th>Client Follow-Up</th>
              <th>Created</th>
              <th>Last Court</th>
              <th>Problems</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {data.matters.map((m) => {
              const items = m.items as DashboardItem[];
              return (
                <tr key={m.matter_id}>
                  <td>{`${m.client_first_name} ${m.client_last_name}`.trim()}</td>
                  <td>{m.matter_number}</td>
                  <td>{m.responsible_attorney_name}</td>
                  <td>{badge(m.display_overall_status ?? m.overall_status)}</td>
                  <td>{stepCell(items, "SETUP_WELCOME")}</td>
                  <td>{stepCell(items, "SETUP_ATTY_CALL")}</td>
                  <td>{stepCell(items, "SETUP_COURT_DATE")}</td>
                  <td>{stepCell(items, "CLIENT_CONTACT")}</td>
                  <td>{stepCell(items, "APPEARANCE_FILING")}</td>
                  <td>{stepCell(items, "COURT_RESULTS")}</td>
                  <td>{stepCell(items, "POST_COURT_CALL")}</td>
                  <td>{stepCell(items, "CLIENT_FOLLOWUP")}</td>
                  <td>{formatLocal(m.matter_created_at)}</td>
                  <td>{formatLocal(m.last_court_date)}</td>
                  <td>
                    <div><strong>Late:</strong> {itemLabels(items, "Late") || "None"}</div>
                    <div><strong>Missing:</strong> {itemLabels(items, "Missing") || "None"}</div>
                    <div><strong>Unknown:</strong> {itemLabelsWithReasons(items, "Unknown") || "None"}</div>
                  </td>
                  <td>
                    {items.filter((i) => evidencePath(i)).map((i) => (
                      <div key={`${i.stepCode}-${i.evidenceRefId ?? i.evidenceUrl}`}>
                        <a href={evidencePath(i)}>{i.stepCode.replaceAll("_", " ")}: {evidenceLabel(i)}</a>
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Current Month Attorney Metrics</h2>
        <p className="muted small">This summary covers the current month across the firm. Use the table filters above for matter-level review.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Attorney</th>
                <th>Checked</th>
                <th>Pass</th>
                <th>Late</th>
                <th>Flag</th>
                <th>Review</th>
                <th>Missing Items</th>
                <th>Late Items</th>
                <th>Unknown Items</th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((m) => (
                <tr key={m.snapshot_id}>
                  <td>{m.responsible_attorney_name || "Unassigned"}</td>
                  <td>{m.matters_checked}</td>
                  <td>{m.pass_count}</td>
                  <td>{m.late_count}</td>
                  <td>{m.flag_count}</td>
                  <td>{m.review_count}</td>
                  <td>{m.missing_item_count}</td>
                  <td>{m.late_item_count}</td>
                  <td>{m.unknown_item_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
