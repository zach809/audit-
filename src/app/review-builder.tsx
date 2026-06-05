"use client";

import { useMemo, useState } from "react";
import {
  NEXT_STEPS,
  PROOF_TYPES,
  REVIEW_DECISIONS,
  isReviewComplete,
  normalizeNextStep,
  normalizeProofType,
  normalizeReviewDecision,
  reviewResult,
  type ProofType,
  type ReviewDecision,
  type ReviewNextStep,
} from "@/lib/review-shared";

type ReviewHistoryEntry = {
  historyId?: number;
  updatedAt?: string | null;
  updatedBy?: string | null;
  previousDecision?: string | null;
  decision?: string | null;
  resultsDetails?: string | null;
  proofType?: string | null;
  proofReference?: string | null;
  nextStep?: string | null;
  reportSummary?: string | null;
};

export type ReviewBuilderItem = {
  id: string;
  matterId: string;
  stepCode: string;
  attorney: string;
  caseManager?: string | null;
  clientName: string;
  matterNumber: string;
  auditItem: string;
  status: string;
  why: string;
  due?: string | null;
  found?: string | null;
  clioUrl: string;
  proofUrl?: string | null;
  auditVersion?: string | null;
  reviewDecision?: string | null;
  reviewNote?: string | null;
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

type ReviewState = {
  decision: ReviewDecision;
  resultsDetails: string;
  proofType: ProofType;
  proofReference: string;
  nextStep: ReviewNextStep | "";
  reportSummary: string;
  internalNotes: string;
  includeInReport: boolean;
  reviewedBy: string;
  savedAt?: string;
  completedAt?: string;
  history: ReviewHistoryEntry[];
};

type DownloadType = "text" | "word" | "pdf";

const STATUS_FILTERS = ["All", ...REVIEW_DECISIONS] as const;
const ALERT_TYPE_FILTERS = [
  "All",
  "Welcome Letter",
  "Attorney Call",
  "Court Date",
  "Post-Court Call",
  "Client Contact",
  "Responsible Attorney",
  "Appearance Filing",
  "Court Result Follow-Up",
  "Other",
] as const;

function defaultReview(): ReviewState {
  return {
    decision: "Needs Review",
    resultsDetails: "",
    proofType: "None Available",
    proofReference: "",
    nextStep: "",
    reportSummary: "",
    internalNotes: "",
    includeInReport: true,
    reviewedBy: "",
    history: [],
  };
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
  if (from && to) return `${from} through ${to}`;
  if (from) return `${from} and later`;
  if (to) return `through ${to}`;
  return "All available dates";
}

function dateInRange(value: string | null | undefined, from: string, to: string): boolean {
  if (!value || (!from && !to)) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return true;
  const start = from ? new Date(`${from}T00:00:00`) : null;
  const end = to ? new Date(`${to}T23:59:59`) : null;
  return (!start || date >= start) && (!end || date <= end);
}

function cleanHistory(value: unknown): ReviewHistoryEntry[] {
  return Array.isArray(value) ? (value as ReviewHistoryEntry[]) : [];
}

function initialReviews(items: ReviewBuilderItem[]): Record<string, ReviewState> {
  return Object.fromEntries(
    items
      .filter((item) => item.reviewDecision || item.reviewNote || item.reviewProofReference || item.nextStep || item.reportSummary || item.reviewUpdatedAt)
      .map((item) => [
        item.id,
        {
          decision: normalizeReviewDecision(item.reviewDecision),
          resultsDetails: item.reviewNote ?? "",
          proofType: normalizeProofType(item.proofType),
          proofReference: item.reviewProofReference ?? "",
          nextStep: normalizeNextStep(item.nextStep),
          reportSummary: item.reportSummary ?? "",
          internalNotes: item.internalNotes ?? "",
          includeInReport: item.includeInReport !== false,
          reviewedBy: item.reviewedBy ?? "",
          savedAt: item.reviewUpdatedAt ?? "",
          completedAt: item.reviewCompletedAt ?? "",
          history: cleanHistory(item.reviewHistory),
        },
      ]),
  );
}

function statusForItem(item: ReviewBuilderItem, reviews: Record<string, ReviewState>): ReviewDecision {
  return reviews[item.id]?.decision ?? "Needs Review";
}

function reviewReady(review: ReviewState | undefined): boolean {
  return Boolean(review && isReviewComplete({ decision: review.decision, resultsDetails: review.resultsDetails, nextStep: review.nextStep }));
}

function statusClassName(status: string): string {
  return status.replace(/\s+/g, "-");
}

function reportLineValue(value?: string | null): string {
  return value?.trim() || "Not available";
}

function plainAlertText(item: ReviewBuilderItem): string {
  return item.why
    .replace(new RegExp(["mis", "sing"].join(""), "gi"), "not confirmed")
    .replace(/could not verify/gi, "system could not confirm")
    .replace(/needs review/gi, "needs review");
}

function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return Promise.resolve();
}

export function ReviewBuilder({ items, initialFrom = "", initialTo = "" }: { items: ReviewBuilderItem[]; initialFrom?: string; initialTo?: string }) {
  const defaultRange = defaultWeekRange();
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const [reviews, setReviews] = useState<Record<string, ReviewState>>(() => initialReviews(items));
  const [reportFrom, setReportFrom] = useState(initialFrom || defaultRange.from);
  const [reportTo, setReportTo] = useState(initialTo || defaultRange.to);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");
  const [alertFilter, setAlertFilter] = useState<(typeof ALERT_TYPE_FILTERS)[number]>("All");
  const [attorneyFilter, setAttorneyFilter] = useState("All");
  const [caseManagerFilter, setCaseManagerFilter] = useState("All");
  const [preparedBy, setPreparedBy] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [pendingDownload, setPendingDownload] = useState<DownloadType | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState(generatedAt());

  const weeklyItems = useMemo(
    () => items.filter((item) => dateInRange(item.due ?? item.found, reportFrom, reportTo)),
    [items, reportFrom, reportTo],
  );
  const queueItems = useMemo(
    () => weeklyItems.filter((item) => !reviewReady(reviews[item.id])),
    [reviews, weeklyItems],
  );
  const rangeLabel = displayRange(reportFrom, reportTo);

  const attorneyOptions = useMemo(() => ["All", ...Array.from(new Set(queueItems.map((item) => item.attorney || "Unassigned"))).sort()], [queueItems]);
  const caseManagerOptions = useMemo(
    () => ["All", ...Array.from(new Set(queueItems.map((item) => item.caseManager || "Not available"))).sort()],
    [queueItems],
  );

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return queueItems
      .filter((item) => {
        const status = statusForItem(item, reviews);
        const caseManager = item.caseManager || "Not available";
        const matchesSearch = !query || [item.clientName, item.matterNumber, item.attorney, caseManager].join(" ").toLowerCase().includes(query);
        const matchesStatus = statusFilter === "All" || status === statusFilter;
        const matchesAlert = alertFilter === "All" || item.auditItem === alertFilter || (alertFilter === "Court Date" && item.auditItem === "Court Date Added");
        const matchesAttorney = attorneyFilter === "All" || item.attorney === attorneyFilter;
        const matchesCaseManager = caseManagerFilter === "All" || caseManager === caseManagerFilter;
        return matchesSearch && matchesStatus && matchesAlert && matchesAttorney && matchesCaseManager;
      })
      .sort((a, b) => {
        const aReview = reviews[a.id];
        const bReview = reviews[b.id];
        const aSkipped = aReview?.decision === "Skipped for Now" ? 1 : 0;
        const bSkipped = bReview?.decision === "Skipped for Now" ? 1 : 0;
        const aReady = reviewReady(aReview) ? 1 : 0;
        const bReady = reviewReady(bReview) ? 1 : 0;
        return aSkipped - bSkipped || aReady - bReady || a.clientName.localeCompare(b.clientName);
      });
  }, [alertFilter, attorneyFilter, caseManagerFilter, queueItems, reviews, search, statusFilter]);

  const selected =
    filteredItems.find((item) => item.id === selectedId) ??
    queueItems.find((item) => item.id === selectedId) ??
    weeklyItems.find((item) => item.id === selectedId) ??
    filteredItems[0] ??
    queueItems[0] ??
    weeklyItems[0] ??
    null;
  const selectedReview = selected ? reviews[selected.id] ?? defaultReview() : defaultReview();

  const reviewedItems = weeklyItems.filter((item) => reviewReady(reviews[item.id]));
  const remainingItems = weeklyItems.filter((item) => !reviewReady(reviews[item.id]));
  const resolvedItems = weeklyItems.filter((item) => {
    const decision = reviews[item.id]?.decision;
    return decision === "Resolved" || decision === "No Action Needed";
  });
  const followUpItems = weeklyItems.filter((item) => {
    const decision = reviews[item.id]?.decision;
    return decision === "Still Needs Action" || decision === "Unable to Confirm" || decision === "Needs Attorney Review";
  });
  const exceptionItems = weeklyItems.filter((item) => reviews[item.id]?.decision === "Approved Exception");
  const inProgressItems = weeklyItems.filter((item) => reviews[item.id]?.decision === "In Progress");

  function updateReview(id: string, patch: Partial<ReviewState>) {
    setSaveStatus("");
    setReviews((current) => ({
      ...current,
      [id]: { ...defaultReview(), ...current[id], ...patch },
    }));
  }

  function nextUnresolvedItem(currentId: string, nextReviews: Record<string, ReviewState>): ReviewBuilderItem | null {
    return (
      weeklyItems.find((item) => item.id !== currentId && !reviewReady(nextReviews[item.id])) ??
      weeklyItems.find((item) => item.id !== currentId) ??
      null
    );
  }

  async function saveReview(options: { moveNext?: boolean; skip?: boolean } = {}) {
    if (!selected) return;
    const current = reviews[selected.id] ?? defaultReview();
    const review: ReviewState = options.skip
      ? {
          ...current,
          decision: "Skipped for Now",
          resultsDetails: current.resultsDetails || "Skipped for now.",
          nextStep: current.nextStep || "Follow up next week",
        }
      : current;

    if (!options.skip && !reviewReady(review)) {
      setSaveStatus("Add results details and choose a next step before saving this review.");
      return;
    }

    setSaveStatus("Saving...");
    const response = await fetch("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        matterId: selected.matterId,
        stepCode: selected.stepCode,
        decision: review.decision,
        resultsDetails: review.resultsDetails,
        proofType: review.proofType,
        proofReference: review.proofReference,
        nextStep: review.nextStep,
        reportSummary: review.reportSummary,
        internalNotes: review.internalNotes,
        includeInReport: review.includeInReport,
        reviewedBy: review.reviewedBy || preparedBy,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setSaveStatus(body?.error || "Could not save review.");
      return;
    }

    const body = await response.json().catch(() => null);
    const savedAt = new Date().toLocaleString();
    const savedReview = {
      ...review,
      savedAt,
      completedAt: reviewReady(review) ? savedAt : "",
      reviewedBy: review.reviewedBy || preparedBy,
      history: body?.review?.history ? [body.review.history, ...(review.history ?? [])] : review.history,
    };
    const nextReviews = { ...reviews, [selected.id]: savedReview };
    setReviews(nextReviews);
    setSaveStatus(options.skip ? "Skipped for now." : "Saved.");

    if (options.moveNext || options.skip) {
      const nextItem = nextUnresolvedItem(selected.id, nextReviews);
      if (nextItem) setSelectedId(nextItem.id);
    }
  }

  const reportText = useMemo(() => {
    const includedItems = weeklyItems.filter((item) => reviews[item.id]?.includeInReport !== false);
    const includedReviewed = includedItems.filter((item) => reviewReady(reviews[item.id]));
    const includedUnreviewed = includedItems.filter((item) => !reviewReady(reviews[item.id]));
    const includedResolved = includedItems.filter((item) => {
      const decision = reviews[item.id]?.decision;
      return decision === "Resolved" || decision === "No Action Needed";
    });
    const includedFollowUp = includedItems.filter((item) => {
      const decision = reviews[item.id]?.decision;
      return decision === "Still Needs Action" || decision === "Unable to Confirm" || decision === "Needs Attorney Review" || decision === "In Progress";
    });
    const includedExceptions = includedItems.filter((item) => reviews[item.id]?.decision === "Approved Exception");
    const completedResolvedExplained = includedResolved.length + includedExceptions.length;

    const lines = [
      "End of the week Case manager clio audit report",
      "",
      `Period Covered: ${rangeLabel}`,
      `Prepared By: ${preparedBy || "Not entered"}`,
      `Report Date: ${generatedAt()}`,
      "",
      "What This Report Shows",
      "",
      "This report shows the Clio items that were reviewed at the end of the week.",
      "Some matters appear in this report because the system alerted that something needed review. This does not always mean the item was not done. It means the item needed to be checked, confirmed, or explained.",
      "",
      "Weekly Summary",
      "",
      `Total Flagged Matters: ${weeklyItems.length}`,
      `Reviewed: ${reviewedItems.length}`,
      `Remaining to Review: ${remainingItems.length}`,
      `Resolved: ${resolvedItems.length}`,
      `Still Needs Follow-Up: ${followUpItems.length}`,
      `Approved Exceptions: ${exceptionItems.length}`,
      "",
      "Flagged Matters Reviewed",
      "",
    ];

    if (!includedReviewed.length) {
      lines.push("No flagged matters have been reviewed for this date range yet.");
      lines.push("");
    } else {
      includedReviewed.forEach((item) => {
        const review = reviews[item.id];
        lines.push(`${item.clientName}`);
        lines.push("");
        lines.push(`Attorney: ${reportLineValue(item.attorney)}`);
        lines.push(`Case Manager: ${reportLineValue(item.caseManager)}`);
        lines.push(`Alert Type: ${item.auditItem}`);
        lines.push(`Status: ${review.decision}`);
        lines.push("");
        lines.push("What triggered the alert:");
        lines.push(`The system alerted because ${plainAlertText(item)}`);
        lines.push("");
        lines.push("Results Details:");
        lines.push(review.reportSummary.trim() || review.resultsDetails.trim());
        lines.push("");
        lines.push("Next Step:");
        lines.push(review.nextStep || "Not selected");
        lines.push("");
      });
    }

    lines.push("Items Completed or Resolved");
    lines.push("");
    if (!includedResolved.length) {
      lines.push("* None for this draft.");
    } else {
      includedResolved.forEach((item) => lines.push(`* ${item.clientName} - ${item.auditItem}: Resolved`));
    }
    lines.push("");
    lines.push("Items Still Needing Follow-Up");
    lines.push("");
    if (!includedFollowUp.length) {
      lines.push("* None for this draft.");
    } else {
      includedFollowUp.forEach((item) => lines.push(`* ${item.clientName} - ${item.auditItem}: ${reviews[item.id]?.nextStep || "Follow up needed"}`));
    }
    lines.push("");
    lines.push("Approved Exceptions or Explanations");
    lines.push("");
    if (!includedExceptions.length) {
      lines.push("* None for this draft.");
    } else {
      includedExceptions.forEach((item) => {
        const review = reviews[item.id];
        lines.push(`* ${item.clientName} - ${item.auditItem}: ${review.reportSummary || review.resultsDetails}`);
      });
    }
    if (includedUnreviewed.length) {
      lines.push("");
      lines.push("Skipped or Not Yet Reviewed Items");
      lines.push("");
      includedUnreviewed.forEach((item) => lines.push(`* ${item.clientName} - ${item.auditItem}: Still needs review`));
    }
    lines.push("");
    lines.push("Final Summary");
    lines.push("");
    lines.push(`This week, ${reviewedItems.length} flagged matters were reviewed.`);
    lines.push(`${resolvedItems.length} were resolved.`);
    lines.push(`${followUpItems.length} still need follow-up.`);
    lines.push(`${exceptionItems.length} were explained through approved exceptions.`);
    if (remainingItems.length) lines.push(`${remainingItems.length} are still waiting for review.`);
    lines.push("");
    lines.push("Final Result");
    lines.push("");
    lines.push(`${completedResolvedExplained} of ${weeklyItems.length} flagged matters were completed, resolved, or explained.`);
    lines.push(`${followUpItems.length} flagged matters still need follow-up.`);
    lines.push(`${remainingItems.length} flagged matters still need review.`);

    return lines.join("\r\n");
  }, [exceptionItems.length, followUpItems.length, preparedBy, rangeLabel, remainingItems.length, resolvedItems.length, reviewedItems.length, reviews, weeklyItems]);

  function performDownload(type: DownloadType) {
    setPendingDownload(null);
    if (type === "pdf") {
      window.print();
      return;
    }
    const safeFrom = reportFrom || "start";
    const safeTo = reportTo || "end";
    const isWord = type === "word";
    const body = isWord
      ? `<html><head><meta charset="utf-8"><title>End of the week Case manager clio audit report</title></head><body><pre>${reportText.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre></body></html>`
      : reportText;
    const blob = new Blob([body], { type: isWord ? "application/msword;charset=utf-8" : "text/plain;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `cwca-end-of-week-case-manager-audit-report-${safeFrom}-to-${safeTo}.${isWord ? "doc" : "txt"}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
  }

  function requestDownload(type: DownloadType) {
    if (remainingItems.length) {
      setPendingDownload(type);
      return;
    }
    performDownload(type);
  }

  function selectedMatterSummary(): string {
    if (!selected) return "";
    const review = reviews[selected.id] ?? defaultReview();
    return [
      `Matter: ${selected.clientName}`,
      `Attorney: ${selected.attorney}`,
      `Alert Type: ${selected.auditItem}`,
      `Status: ${review.decision}`,
      `Results Details: ${review.reportSummary || review.resultsDetails || "Not entered yet"}`,
      `Next Step: ${review.nextStep || "Not selected"}`,
      `Clio Link: ${selected.clioUrl}`,
    ].join("\n");
  }

  if (!items.length) {
    return (
      <section className="review-builder panel">
        <div className="panel-heading">
          <div>
            <span className="label">End-of-Week Review Builder</span>
            <h2>End-of-Week Case Manager Clio Audit Report Builder</h2>
            <p className="muted small">No flagged matters are available for this report range.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="review-builder panel weekly-review-builder">
      <div className="panel-heading review-builder-title">
        <div>
          <span className="label">End-of-Week Review Builder</span>
          <h2>End-of-Week Case Manager Clio Audit Report Builder</h2>
          <p className="muted small">Review each flagged matter, add results details, update the status, and generate the weekly Clio audit report.</p>
        </div>
        <div className="review-builder-count">
          <strong>{reviewedItems.length}</strong>
          <span>reviewed</span>
        </div>
      </div>

      <div className="review-range-card">
        <label>
          Prepared By
          <input value={preparedBy} onChange={(event) => setPreparedBy(event.target.value)} placeholder="Name" />
        </label>
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
          <button type="button" onClick={() => {
            setReportFrom("");
            setReportTo("");
          }}>All Dates</button>
        </div>
      </div>

      <div className="review-progress-grid">
        <div><span>Total Flagged Matters</span><strong>{weeklyItems.length}</strong></div>
        <div><span>Reviewed</span><strong>{reviewedItems.length}</strong></div>
        <div><span>Remaining to Review</span><strong>{remainingItems.length}</strong></div>
        <div><span>Resolved</span><strong>{resolvedItems.length}</strong></div>
        <div><span>Still Needs Follow-Up</span><strong>{followUpItems.length}</strong></div>
        <div><span>Approved Exceptions</span><strong>{exceptionItems.length}</strong></div>
        <div><span>In Progress</span><strong>{inProgressItems.length}</strong></div>
      </div>

      <div className={remainingItems.length ? "review-completion-message attention" : "review-completion-message done"}>
        <strong>Review Progress: {reviewedItems.length} of {weeklyItems.length} flagged matters reviewed</strong>
        <span>
          {remainingItems.length
            ? `There are still ${remainingItems.length} flagged matters left to review for this date range.`
            : "All flagged matters for this date range have been reviewed."}
        </span>
      </div>

      <div className="review-builder-grid">
        <div className="review-queue-panel">
          <div className="review-queue-head">
            <div>
              <span className="label">Needs Review</span>
              <strong>{filteredItems.length} matters need review</strong>
            </div>
            <small>{queueItems.length} left</small>
          </div>
          <div className="review-queue-filters">
            <label className="queue-filter queue-filter-search">
              <span>Search</span>
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Client, matter, attorney..." />
            </label>
            <label className="queue-filter">
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as (typeof STATUS_FILTERS)[number])}>
                {STATUS_FILTERS.map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
            <label className="queue-filter">
              <span>Alert Type</span>
              <select value={alertFilter} onChange={(event) => setAlertFilter(event.target.value as (typeof ALERT_TYPE_FILTERS)[number])}>
                {ALERT_TYPE_FILTERS.map((alert) => <option key={alert}>{alert}</option>)}
              </select>
            </label>
            <label className="queue-filter">
              <span>Attorney</span>
              <select value={attorneyFilter} onChange={(event) => setAttorneyFilter(event.target.value)}>
                {attorneyOptions.map((attorney) => <option key={attorney}>{attorney}</option>)}
              </select>
            </label>
            <label className="queue-filter">
              <span>Case Manager</span>
              <select value={caseManagerFilter} onChange={(event) => setCaseManagerFilter(event.target.value)}>
                {caseManagerOptions.map((caseManager) => <option key={caseManager}>{caseManager}</option>)}
              </select>
            </label>
          </div>

          <div className="review-item-list" aria-label="Flagged matters review queue">
            {filteredItems.length ? filteredItems.map((item) => {
              const review = reviews[item.id];
              const status = statusForItem(item, reviews);
              return (
                <button
                  className={selected?.id === item.id ? `review-item active status-${statusClassName(status)}` : `review-item status-${statusClassName(status)}`}
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  type="button"
                >
                  <span>{status}</span>
                  <strong>{item.clientName}</strong>
                  <small>Alert: {item.auditItem}</small>
                  <small>Attorney: {item.attorney || "Unassigned"}</small>
                  <small>Case Manager: {item.caseManager || "Not available"}</small>
                  {item.due ? <small>Due: {item.due}</small> : null}
                  <small>Last Update: {review?.savedAt ? review.savedAt : "Not reviewed yet"}</small>
                </button>
              );
            }) : (
              <div className="review-queue-empty">
                <strong>No matters need review for this date range.</strong>
                <small>Change the date range or clear filters to see more.</small>
              </div>
            )}
          </div>
        </div>

        {selected ? (
          <div className="review-editor">
            <div className="review-editor-head">
              <div>
                <span className="label">Selected Flagged Matter</span>
                <h3>{selected.clientName}</h3>
                <p>{selected.matterNumber}</p>
              </div>
              <a className="button compact" href={selected.clioUrl} target="_blank" rel="noreferrer">Open in Clio</a>
            </div>

            <div className="selected-matter-grid">
              <span><b>Case Manager</b>{selected.caseManager || "Not available"}</span>
              <span><b>Attorney</b>{selected.attorney || "Unassigned"}</span>
              <span><b>Alert Type</b>{selected.auditItem}</span>
              <span><b>Date Alerted</b>{selected.found || selected.due || "Not available"}</span>
              <span><b>Due Date</b>{selected.due || "Not available"}</span>
            </div>

            <div className="review-context">
              <strong>Why This Appeared</strong>
              <p>The system alerted because {plainAlertText(selected)}</p>
              <small>This does not always mean the item was not done. It means the item needs to be reviewed, confirmed, or explained.</small>
            </div>

            <div className="review-decision-buttons" aria-label="Status">
              {REVIEW_DECISIONS.map((decision) => (
                <button
                  className={selectedReview.decision === decision ? `active status-${statusClassName(decision)}` : ""}
                  key={decision}
                  onClick={() => updateReview(selected.id, { decision })}
                  type="button"
                >
                  {decision}
                </button>
              ))}
            </div>

            <label>
              Results Details
              <small>Write what was found, confirmed, updated, or explained.</small>
              <textarea
                placeholder="Example: Ivan confirmed the client was contacted by email. The court event was added to Clio and screenshot proof was provided."
                value={selectedReview.resultsDetails}
                onChange={(event) => updateReview(selected.id, { resultsDetails: event.target.value })}
              />
            </label>

            <div className="review-form-grid">
              <label>
                Proof Type
                <select value={selectedReview.proofType} onChange={(event) => updateReview(selected.id, { proofType: event.target.value as ProofType })}>
                  {PROOF_TYPES.map((proofType) => <option key={proofType}>{proofType}</option>)}
                </select>
              </label>
              <label>
                Next Step
                <select value={selectedReview.nextStep} onChange={(event) => updateReview(selected.id, { nextStep: event.target.value as ReviewNextStep })}>
                  <option value="">Select next step</option>
                  {NEXT_STEPS.map((nextStep) => <option key={nextStep}>{nextStep}</option>)}
                </select>
              </label>
            </div>

            <label>
              Proof or Reference
              <input
                placeholder="Paste a Clio link, Teams note, proof link, screenshot reference, or short explanation."
                value={selectedReview.proofReference}
                onChange={(event) => updateReview(selected.id, { proofReference: event.target.value })}
              />
            </label>

            <label>
              Report Summary
              <small>Write the clean version that should appear in the weekly report.</small>
              <textarea
                placeholder="Example: Ivan confirmed that the client was contacted before ICD. The matter was reviewed and marked resolved."
                value={selectedReview.reportSummary}
                onChange={(event) => updateReview(selected.id, { reportSummary: event.target.value })}
              />
            </label>

            <label>
              Internal Auditor Notes
              <small>Private working notes for the auditor. These should not appear in the final report unless manually included.</small>
              <textarea
                placeholder="Private note for the auditor."
                value={selectedReview.internalNotes}
                onChange={(event) => updateReview(selected.id, { internalNotes: event.target.value })}
              />
            </label>

            <div className="review-form-grid">
              <label>
                Last Updated By
                <input value={selectedReview.reviewedBy} placeholder={preparedBy || "Name"} onChange={(event) => updateReview(selected.id, { reviewedBy: event.target.value })} />
              </label>
              <label className="include-toggle">
                Include in weekly report
                <select value={selectedReview.includeInReport ? "Yes" : "No"} onChange={(event) => updateReview(selected.id, { includeInReport: event.target.value === "Yes" })}>
                  <option>Yes</option>
                  <option>No</option>
                </select>
              </label>
            </div>

            <div className="review-save-row">
              <button className="primary compact" type="button" onClick={() => saveReview()}>Save Review</button>
              <button className="compact" type="button" onClick={() => saveReview({ moveNext: true })}>Save & Next</button>
              <button className="compact" type="button" onClick={() => saveReview({ skip: true })}>Skip for Now</button>
              <button className="compact" type="button" onClick={() => copyText(selectedMatterSummary()).then(() => setSaveStatus("Matter summary copied."))}>Copy Matter Summary</button>
            </div>
            <span className="review-save-status">{saveStatus || (selectedReview.savedAt ? `Last Update: ${selectedReview.savedAt}` : "Add results details and a next step before saving.")}</span>

            <div className="review-history">
              <span className="label">Update History</span>
              {selectedReview.history.length ? (
                selectedReview.history.map((entry, index) => (
                  <div className="history-entry" key={`${entry.historyId ?? index}-${entry.updatedAt ?? index}`}>
                    <strong>{entry.updatedAt ? generatedAtFrom(entry.updatedAt) : "Date not available"}</strong>
                    <p>{entry.updatedBy || "Auditor"} updated status from {entry.previousDecision || "Not reviewed"} to {entry.decision || selectedReview.decision}.</p>
                    {entry.resultsDetails ? <p>Results Details: {entry.resultsDetails}</p> : null}
                    {entry.proofReference ? <p>Proof/reference: {entry.proofReference}</p> : null}
                    {entry.nextStep ? <p>Next Step: {entry.nextStep}</p> : null}
                  </div>
                ))
              ) : (
                <p className="muted small">No saved updates yet.</p>
              )}
            </div>
          </div>
        ) : null}

        <div className="review-preview">
          <div className="review-preview-head">
            <div>
              <span className="label">Draft Report</span>
              <small>Last refreshed: {lastRefreshed}</small>
            </div>
            <div className="report-button-row">
              <button className="compact" onClick={() => setLastRefreshed(generatedAt())} type="button">Refresh Draft</button>
              <button className="compact" onClick={() => copyText(reportText)} type="button">Copy Report</button>
              <button className="primary compact" onClick={() => requestDownload("text")} type="button">Download Draft</button>
              <button className="compact" onClick={() => requestDownload("pdf")} type="button">Export PDF</button>
              <button className="compact" onClick={() => requestDownload("word")} type="button">Export Word</button>
            </div>
          </div>

          {pendingDownload ? (
            <div className="download-warning">
              <strong>There are still {remainingItems.length} flagged matters that have not been reviewed for this date range.</strong>
              <p>Do you still want to download the draft report?</p>
              <div>
                <button className="primary compact" type="button" onClick={() => performDownload(pendingDownload)}>Continue Download</button>
                <button className="compact" type="button" onClick={() => setPendingDownload(null)}>Go Back to Review</button>
              </div>
            </div>
          ) : null}

          <pre>{reportText}</pre>
        </div>
      </div>
    </section>
  );
}

function generatedAtFrom(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
