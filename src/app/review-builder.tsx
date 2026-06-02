"use client";

import { useMemo, useState } from "react";

export type ReviewBuilderItem = {
  id: string;
  attorney: string;
  clientName: string;
  matterNumber: string;
  auditItem: string;
  status: string;
  why: string;
  nextStep: string;
  due?: string | null;
  found?: string | null;
  clioUrl: string;
  proofUrl?: string | null;
};

type Decision = "Resolved" | "Resolved, proof not linked" | "In progress" | "Pending" | "Not applicable" | "Needs attorney review";

type ReviewState = {
  decision: Decision;
  note: string;
  proof: string;
};

const decisions: Decision[] = [
  "Resolved",
  "Resolved, proof not linked",
  "In progress",
  "Pending",
  "Not applicable",
  "Needs attorney review",
];

function defaultReview(): ReviewState {
  return { decision: "Pending", note: "", proof: "" };
}

function generatedAt(): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultWeekRange(): { from: string; to: string } {
  const today = new Date();
  const day = today.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return { from: isoDate(monday), to: isoDate(friday) };
}

function previousWeekRange(): { from: string; to: string } {
  const current = defaultWeekRange();
  const monday = new Date(`${current.from}T00:00:00`);
  monday.setDate(monday.getDate() - 7);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return { from: isoDate(monday), to: isoDate(friday) };
}

function displayRange(from: string, to: string): string {
  if (from && to) {
    return `${from} to ${to}`;
  }
  if (from) {
    return `${from} to not selected`;
  }
  if (to) {
    return `not selected to ${to}`;
  }
  return "Date range not selected";
}

function resultSummary(decision: Decision): string {
  if (decision === "Resolved" || decision === "Resolved, proof not linked" || decision === "Not applicable") {
    return "Resolved";
  }
  if (decision === "In progress" || decision === "Needs attorney review") {
    return "In progress";
  }
  return "Pending";
}

function defaultNextStep(decision: Decision, nextStep: string): string {
  if (decision === "Resolved") {
    return "No follow-up needed.";
  }
  if (decision === "Resolved, proof not linked") {
    return "Add or link the proof in Clio so the file is easy to verify.";
  }
  if (decision === "Not applicable") {
    return "No follow-up needed for this item.";
  }
  if (decision === "Needs attorney review") {
    return "Ask the responsible attorney to confirm the next step.";
  }
  return nextStep;
}

export function ReviewBuilder({ items, initialFrom = "", initialTo = "" }: { items: ReviewBuilderItem[]; initialFrom?: string; initialTo?: string }) {
  const defaultRange = defaultWeekRange();
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const [reviews, setReviews] = useState<Record<string, ReviewState>>({});
  const [reportFrom, setReportFrom] = useState(initialFrom || defaultRange.from);
  const [reportTo, setReportTo] = useState(initialTo || defaultRange.to);

  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const reviewedCount = Object.keys(reviews).length;
  const rangeLabel = displayRange(reportFrom, reportTo);

  function updateReview(id: string, patch: Partial<ReviewState>) {
    setReviews((current) => ({
      ...current,
      [id]: { ...defaultReview(), ...current[id], ...patch },
    }));
  }

  const reportText = useMemo(() => {
    const reviewedItems = items.filter((item) => reviews[item.id]);
    const pendingItems = reviewedItems.filter((item) => resultSummary(reviews[item.id].decision) === "Pending");
    const inProgressItems = reviewedItems.filter((item) => resultSummary(reviews[item.id].decision) === "In progress");
    const resolvedItems = reviewedItems.filter((item) => resultSummary(reviews[item.id].decision) === "Resolved");

    const lines = [
      "End-of-Week Clio Audit Review",
      `Generated: ${generatedAt()}`,
      `Report range: ${rangeLabel}`,
      "Use this report for internal workflow follow-up. It summarizes what needs attention, what was done, and what still needs a response.",
      "",
      "Result Summary",
      `* Items reviewed: ${reviewedCount}`,
      `* Resolved: ${resolvedItems.length}`,
      `* In progress: ${inProgressItems.length}`,
      `* Pending: ${pendingItems.length}`,
      "",
      "Flagged Matters",
      "",
    ];

    if (!reviewedItems.length) {
      lines.push("* No items have been reviewed yet. Select a flagged matter, choose a status, and add a short note.");
      return lines.join("\r\n");
    }

    reviewedItems.forEach((item, index) => {
      const review = reviews[item.id];
      const summary = resultSummary(review.decision);
      lines.push(`${index + 1}. Matter: ${item.clientName}`);
      lines.push(`   Attorney: ${item.attorney}`);
      lines.push(`   Matter Number: ${item.matterNumber}`);
      lines.push(`   Clio Link: ${item.clioUrl}`);
      lines.push("");
      lines.push(`   Flagged Matter: ${item.auditItem} needs review.`);
      lines.push(`   Why it matters: ${item.why}`);
      lines.push("");
      lines.push("   Completion Status:");
      lines.push(`   * What the team did: ${review.note || "No response has been added yet."}`);
      lines.push(`   * Current result: ${summary}`);
      lines.push(`   * Proof / reference: ${review.proof || item.proofUrl || "No proof link added yet."}`);
      lines.push(`   * Next step: ${defaultNextStep(review.decision, item.nextStep)}`);
      lines.push("");
    });

    lines.push("Items Still Needing Attention");
    if (!pendingItems.length && !inProgressItems.length) {
      lines.push("* None based on the editor selections in this draft.");
    } else {
      [...pendingItems, ...inProgressItems].forEach((item) => {
        lines.push(`* ${item.clientName} - ${item.auditItem}: ${resultSummary(reviews[item.id].decision)}`);
      });
    }

    return lines.join("\r\n");
  }, [items, rangeLabel, reviewedCount, reviews]);

  function downloadReport() {
    const blob = new Blob([reportText], { type: "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeFrom = reportFrom || "start";
    const safeTo = reportTo || "end";
    link.href = href;
    link.download = `cwca-end-of-week-audit-review-${safeFrom}-to-${safeTo}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  }

  if (!items.length) {
    return (
      <section className="review-builder panel">
        <div className="panel-heading">
          <div>
            <span className="label">Report Builder</span>
            <h2>Follow-Up Review Builder</h2>
            <p className="muted small">No flagged items are available for this report range.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="review-builder panel">
      <div className="panel-heading">
        <div>
          <span className="label">Report Builder</span>
          <h2>Follow-Up Review Builder</h2>
          <p className="muted small">Pick the week, review each flagged matter, add what happened, then download the draft report.</p>
        </div>
        <div className="review-builder-count">
          <strong>{reviewedCount}</strong>
          <span>reviewed</span>
        </div>
      </div>

      <div className="review-range-card">
        <div>
          <span className="label">Weekly Report Range</span>
          <strong>End-of-week review</strong>
          <p className="muted small">This date range appears on the downloaded report. Use the page filters above if you want the matter list to match the same range.</p>
        </div>
        <label>
          From
          <input type="date" value={reportFrom} onChange={(event) => setReportFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={reportTo} onChange={(event) => setReportTo(event.target.value)} />
        </label>
        <div className="review-range-actions">
          <button type="button" onClick={() => {
            const range = defaultWeekRange();
            setReportFrom(range.from);
            setReportTo(range.to);
          }}>This Week</button>
          <button type="button" onClick={() => {
            const range = previousWeekRange();
            setReportFrom(range.from);
            setReportTo(range.to);
          }}>Last Week</button>
        </div>
      </div>

      <div className="review-builder-grid">
        <div className="review-item-list" aria-label="Flagged matters to review">
          {items.map((item) => {
            const review = reviews[item.id];
            return (
              <button
                className={selected?.id === item.id ? "review-item active" : "review-item"}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                type="button"
              >
                <span>{review ? resultSummary(review.decision) : item.status}</span>
                <strong>{item.clientName}</strong>
                <small>{item.auditItem} - {item.attorney}</small>
              </button>
            );
          })}
        </div>

        {selected ? (
          <div className="review-editor">
            <div className="review-editor-head">
              <div>
                <span className="label">Selected Item</span>
                <h3>{selected.clientName}</h3>
                <p>{selected.matterNumber} - {selected.auditItem}</p>
              </div>
              <a className="button compact" href={selected.clioUrl} target="_blank" rel="noreferrer">Open in Clio</a>
            </div>

            <div className="review-context">
              <strong>Flagged Matter</strong>
              <p>{selected.why}</p>
              <small>{selected.due ? `Due: ${selected.due}` : "No due date shown"}{selected.found ? ` - Found: ${selected.found}` : ""}</small>
            </div>

            <div className="review-decision-buttons" aria-label="Current result">
              {decisions.map((decision) => (
                <button
                  className={reviews[selected.id]?.decision === decision ? "active" : ""}
                  key={decision}
                  onClick={() => updateReview(selected.id, { decision })}
                  type="button"
                >
                  {decision}
                </button>
              ))}
            </div>

            <label>
              What the Team Did
              <textarea
                placeholder="Example: Template was sent, but proof was not linked to the matter. The file was updated today."
                value={reviews[selected.id]?.note ?? ""}
                onChange={(event) => updateReview(selected.id, { note: event.target.value })}
              />
            </label>

            <label>
              Proof or Reference Link
              <input
                placeholder="Paste Clio link, proof link, or short reference"
                value={reviews[selected.id]?.proof ?? ""}
                onChange={(event) => updateReview(selected.id, { proof: event.target.value })}
              />
            </label>
          </div>
        ) : null}

        <div className="review-preview">
          <div className="review-preview-head">
            <span className="label">Draft Report</span>
            <button className="primary compact" onClick={downloadReport} type="button">Download Draft</button>
          </div>
          <pre>{reportText}</pre>
        </div>
      </div>
    </section>
  );
}
