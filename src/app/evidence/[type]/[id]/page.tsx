import { redirect } from "next/navigation";
import { formatLocal } from "@/lib/business-time";
import { ClioApiError, ClioClient } from "@/lib/clio";
import { hasDashboardSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type EvidenceRecord = Record<string, unknown>;

function text(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not shown by Clio";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function person(value: unknown): string {
  if (!value || typeof value !== "object") return "Not shown by Clio";
  const record = value as Record<string, unknown>;
  return text(record.name ?? record.id);
}

function people(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "Not shown by Clio";
  return value.map(person).join(", ");
}

function dateText(value: unknown): string {
  if (!value) return "Not shown by Clio";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Not shown by Clio";
  return formatLocal(date);
}

async function loadEvidence(type: string, id: string): Promise<{ label: string; rows: Array<[string, string]> }> {
  const client = new ClioClient();

  if (type === "communications") {
    const response = await client.request<{ data: EvidenceRecord }>(`/communications/${id}.json`, {
      fields: "id,subject,type,date,created_at,received_at,user{id,name},senders{id,name},receivers{id,name},matter{id,display_number}",
    });
    const data = response.data;
    return {
      label: `Communication #${id}`,
      rows: [
        ["Subject", text(data.subject)],
        ["Type", text(data.type)],
        ["Date", dateText(data.date ?? data.created_at ?? data.received_at)],
        ["Firm User", person(data.user)],
        ["Senders", people(data.senders)],
        ["Receivers", people(data.receivers)],
        ["Matter", text((data.matter as Record<string, unknown> | undefined)?.display_number ?? (data.matter as Record<string, unknown> | undefined)?.id)],
      ],
    };
  }

  if (type === "calendar_entries") {
    const response = await client.request<{ data: EvidenceRecord }>(`/calendar_entries/${id}.json`, {
      fields: "id,summary,description,start_at,end_at,created_at,all_day,matter{id,display_number},calendar_owner{id,name},calendar_entry_event_type{id,name}",
    });
    const data = response.data;
    return {
      label: `Calendar Entry #${id}`,
      rows: [
        ["Summary", text(data.summary)],
        ["Type", text((data.calendar_entry_event_type as Record<string, unknown> | undefined)?.name)],
        ["Starts", dateText(data.start_at)],
        ["Ends", dateText(data.end_at)],
        ["Created", dateText(data.created_at)],
        ["Owner", person(data.calendar_owner)],
        ["Matter", text((data.matter as Record<string, unknown> | undefined)?.display_number ?? (data.matter as Record<string, unknown> | undefined)?.id)],
      ],
    };
  }

  throw new Error("This evidence type is not supported yet.");
}

export default async function EvidencePage({ params }: { params: { type: string; id: string } }) {
  if (!hasDashboardSession()) redirect("/login");
  let evidence: { label: string; rows: Array<[string, string]> } | null = null;
  let error = "";

  try {
    evidence = await loadEvidence(params.type, params.id);
  } catch (err) {
    if (err instanceof ClioApiError) {
      error = `Clio could not load this evidence record (${err.status}).`;
    } else {
      error = err instanceof Error ? err.message : "Could not load this evidence record.";
    }
  }

  return (
    <main className="shell">
      <div className="topbar">
        <div className="title">
          <h1>Evidence Detail</h1>
          <p>This shows the exact Clio object the audit used.</p>
        </div>
        <div className="actions">
          <a className="button" href="/">Back to Dashboard</a>
        </div>
      </div>

      {error ? <section className="notice danger">{error}</section> : null}

      {evidence ? (
        <section className="panel">
          <h2>{evidence.label}</h2>
          <table className="evidence-table">
            <tbody>
              {evidence.rows.map(([label, value]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </main>
  );
}
