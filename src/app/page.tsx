import { redirect } from "next/navigation";
import Link from "next/link";
import { getDashboardData } from "@/lib/dashboard-data";
import { hasDashboardSession } from "@/lib/session";
import { hasClioConnection } from "@/lib/token-store";
import { formatLocal } from "@/lib/business-time";
import { APP_VERSION } from "@/lib/version";

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

function setupStatus(items: Array<{ stepCode: string; status: string }>) {
  const statuses = ["SETUP_WELCOME", "SETUP_ATTY_CALL", "SETUP_COURT_DATE"].map((code) => step(items, code));
  if (statuses.includes("Unknown")) return "Unknown";
  if (statuses.includes("Missing")) return "Missing";
  if (statuses.includes("Late")) return "Late";
  if (statuses.includes("Pending")) return "Pending";
  return "On Time";
}

function itemLabels(items: Array<{ stepCode: string; status: string }>, status: string) {
  return items.filter((i) => i.status === status).map((i) => i.stepCode.replaceAll("_", " ")).join(", ");
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
            <Link className="button primary" href="/api/auth/clio/start">Connect Clio</Link>
          )}
          <form action="/api/audit/run" method="post">
            <button className="primary" type="submit">Run Audit Now</button>
          </form>
          <Link className="button" href={`/api/export.csv?${exportParams}`}>Export CSV</Link>
          <Link className="button" href="/logout">Log Out</Link>
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
          <Link className="button" href="/">Clear</Link>
        </form>
        <p className="muted small">
          Last run: {data.lastRun ? `${data.lastRun.status} at ${formatLocal(data.lastRun.finished_at ?? data.lastRun.started_at)} - ${data.lastRun.message ?? ""}` : "No audit has run yet."}
        </p>
      </section>

      <section className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Matter</th>
              <th>Attorney</th>
              <th>Overall</th>
              <th>Setup</th>
              <th>Client Contact</th>
              <th>Appearance</th>
              <th>Court Results</th>
              <th>Post-Court Call</th>
              <th>Follow-Up</th>
              <th>Created</th>
              <th>Last Court</th>
              <th>Late</th>
              <th>Missing</th>
              <th>Unknown</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {data.matters.map((m) => {
              const items = m.items as Array<{ stepCode: string; status: string; operationalState?: string; evidenceUrl?: string }>;
              return (
                <tr key={m.matter_id}>
                  <td>{`${m.client_first_name} ${m.client_last_name}`.trim()}</td>
                  <td>{m.matter_number}</td>
                  <td>{m.responsible_attorney_name}</td>
                  <td>{badge(m.overall_status)}</td>
                  <td>{badge(setupStatus(items))}</td>
                  <td>{badge(step(items, "CLIENT_CONTACT"))}</td>
                  <td>{badge(step(items, "APPEARANCE_FILING"))}</td>
                  <td>{badge(step(items, "COURT_RESULTS"))}</td>
                  <td>{badge(step(items, "POST_COURT_CALL"))}</td>
                  <td>{badge(step(items, "CLIENT_FOLLOWUP"))}</td>
                  <td>{formatLocal(m.matter_created_at)}</td>
                  <td>{formatLocal(m.last_court_date)}</td>
                  <td>{itemLabels(items, "Late")}</td>
                  <td>{itemLabels(items, "Missing")}</td>
                  <td>{itemLabels(items, "Unknown")}</td>
                  <td>
                    {items.filter((i) => i.evidenceUrl).map((i) => (
                      <div key={`${i.stepCode}-${i.evidenceUrl}`}>
                        <a href={i.evidenceUrl} target="_blank" rel="noreferrer">{i.stepCode.replaceAll("_", " ")}</a>
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
        <h2>Monthly Attorney Metrics</h2>
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
