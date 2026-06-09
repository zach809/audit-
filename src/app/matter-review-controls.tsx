"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  NEXT_STEPS,
  REVIEW_DECISIONS,
  normalizeNextStep,
  normalizeReviewDecision,
  type ReviewDecision,
  type ReviewNextStep,
} from "@/lib/review-shared";

type MatterReviewControlsProps = {
  matterId: string;
  stepCode: string;
  auditItemLabel: string;
  currentDecision?: string | null;
  currentNote?: string | null;
  currentNextStep?: string | null;
  currentReviewedBy?: string | null;
};

function suggestedNextStep(decision: ReviewDecision): ReviewNextStep {
  if (decision === "Resolved" || decision === "No Action Needed" || decision === "Approved Exception") {
    return "No further action needed";
  }
  if (decision === "Needs Attorney Review") return "Attorney review needed";
  if (decision === "Still Needs Action") return "Case manager needs to update Clio";
  if (decision === "Unable to Confirm") return "Auditor needs to manually check Clio";
  return "Auditor needs to manually check Clio";
}

export function MatterReviewControls({
  matterId,
  stepCode,
  auditItemLabel,
  currentDecision,
  currentNote,
  currentNextStep,
  currentReviewedBy,
}: MatterReviewControlsProps) {
  const router = useRouter();
  const initialDecision = useMemo(() => normalizeReviewDecision(currentDecision), [currentDecision]);
  const initialNextStep = useMemo(
    () => normalizeNextStep(currentNextStep) || suggestedNextStep(initialDecision),
    [currentNextStep, initialDecision],
  );
  const [decision, setDecision] = useState<ReviewDecision>(initialDecision);
  const [note, setNote] = useState(currentNote ?? "");
  const [nextStep, setNextStep] = useState<ReviewNextStep>(initialNextStep);
  const [reviewedBy, setReviewedBy] = useState(currentReviewedBy ?? "");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);
  const hasReview = Boolean(currentDecision || currentNote || currentReviewedBy);

  async function saveReview() {
    setSaveState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          matterId,
          stepCode,
          decision,
          resultsDetails: note,
          note,
          proofType: "Clio Check",
          proofReference: "",
          nextStep,
          reportSummary: note,
          internalNotes: "",
          includeInReport: true,
          reviewedBy,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not save this review.");
      setSaveState("saved");
      setMessage("Saved to CWCA. Updating this card...");
      setExpanded(false);
      router.refresh();
      window.setTimeout(() => {
        window.location.reload();
      }, 350);
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "Could not save this review.");
    }
  }

  return (
    <div className={`matter-review-controls ${expanded ? "is-open" : "is-collapsed"}`}>
      <div className="matter-review-controls-head">
        <div className="matter-review-summary">
          <strong>Auditor Status</strong>
          <span>{hasReview ? decision : "Not reviewed yet"}</span>
          {hasReview && note ? <small>{note}</small> : null}
          {!hasReview ? <small>Click to add the auditor decision.</small> : null}
          {message ? <small className={saveState === "error" ? "error" : "success"}>{message}</small> : null}
        </div>
        <button className="matter-review-toggle" type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "Hide" : hasReview ? "Edit Status" : "Update Status"}
        </button>
      </div>
      {expanded ? (
        <div className="matter-review-form">
          <div className="matter-review-grid">
            <label>
              Status
              <select
                value={decision}
                onChange={(event) => {
                  const nextDecision = normalizeReviewDecision(event.target.value);
                  setDecision(nextDecision);
                  setNextStep(suggestedNextStep(nextDecision));
                }}
              >
                {REVIEW_DECISIONS.filter((value) => value !== "Skipped for Now").map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Next Step
              <select value={nextStep} onChange={(event) => setNextStep(event.target.value as ReviewNextStep)}>
                {NEXT_STEPS.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            What happened?
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={`Example: ${auditItemLabel} was checked in Clio and the item was resolved.`}
              rows={3}
            />
          </label>
          <div className="matter-review-footer">
            <label>
              Reviewed By
              <input value={reviewedBy} onChange={(event) => setReviewedBy(event.target.value)} placeholder="Name" />
            </label>
            <button type="button" onClick={saveReview} disabled={saveState === "saving"}>
              {saveState === "saving" ? "Saving..." : "Save Status"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
