"use client";

import { useMemo, useRef, useState } from "react";
import {
  NEXT_STEPS,
  REVIEW_DECISIONS,
  normalizeNextStep,
  normalizeReviewDecision,
  type ReviewDecision,
  type ReviewNextStep,
} from "@/lib/review-shared";
import { saveMatterReview } from "./matter-actions";

type MatterReviewControlsProps = {
  matterId: string;
  stepCode: string;
  auditItemLabel: string;
  currentDecision?: string | null;
  currentNote?: string | null;
  currentNextStep?: string | null;
  currentReviewedBy?: string | null;
  currentCaseManagerName?: string | null;
  currentProofReference?: string | null;
  existingProofUrl?: string | null;
  mode?: "auditor" | "case-manager";
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
  currentCaseManagerName,
  currentProofReference,
  existingProofUrl,
  mode = "auditor",
}: MatterReviewControlsProps) {
  const initialDecision = useMemo(() => normalizeReviewDecision(currentDecision), [currentDecision]);
  const initialNextStep = useMemo(
    () => normalizeNextStep(currentNextStep) || suggestedNextStep(initialDecision),
    [currentNextStep, initialDecision],
  );
  const [committed, setCommitted] = useState({
    decision: initialDecision,
    note: currentNote ?? "",
    nextStep: initialNextStep,
    reviewedBy: currentReviewedBy ?? "",
    caseManagerName: currentCaseManagerName ?? "",
    proofReference: currentProofReference ?? "",
  });
  const [decision, setDecision] = useState<ReviewDecision>(committed.decision);
  const [note, setNote] = useState(committed.note);
  const [nextStep, setNextStep] = useState<ReviewNextStep>(committed.nextStep);
  const [reviewedBy, setReviewedBy] = useState(committed.reviewedBy);
  const [caseManagerName, setCaseManagerName] = useState(committed.caseManagerName);
  const [proofReference, setProofReference] = useState(committed.proofReference);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);
  const saveRef = useRef<HTMLButtonElement>(null);
  const hasReview = Boolean(
    currentDecision ||
    currentNote ||
    currentReviewedBy ||
    committed.note ||
    committed.reviewedBy ||
    committed.decision !== "Needs Review",
  );

  async function saveReview() {
    if (saveState === "saving") return;
    setSaveState("saving");
    setMessage("");
    const result = await saveMatterReview({
      matterId,
      stepCode,
      decision,
      note,
      nextStep,
      reviewedBy,
      caseManagerName,
      proofReference,
    });
    if (!result.ok) {
      setDecision(committed.decision);
      setNote(committed.note);
      setNextStep(committed.nextStep);
      setReviewedBy(committed.reviewedBy);
      setCaseManagerName(committed.caseManagerName);
      setProofReference(committed.proofReference);
      setSaveState("error");
      setMessage(result.error);
      saveRef.current?.focus({ preventScroll: true });
      return;
    }
    setCommitted({ decision, note, nextStep, reviewedBy, caseManagerName, proofReference });
    setSaveState("saved");
    setMessage("Saved.");
    saveRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className={`matter-review-controls ${expanded ? "is-open" : "is-collapsed"}`}>
      <div className="matter-review-controls-head">
        <div className="matter-review-summary">
          <strong>Auditor Status</strong>
          <span>{hasReview ? decision : "Not reviewed yet"}</span>
          {hasReview && note ? <small>{note}</small> : null}
          {!hasReview ? <small>{mode === "case-manager" ? "Add what was done and a Clio proof link." : "Click to add the auditor decision."}</small> : null}
          {mode === "case-manager" ? <small>Resolved items require Clio proof. CWCA will not clear this from a note alone.</small> : null}
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
              placeholder={`Example: ${auditItemLabel} was completed in Clio. Proof link pasted below.`}
              rows={3}
            />
          </label>
          <label>
            Clio Proof Link
            <input
              value={proofReference}
              onChange={(event) => setProofReference(event.target.value)}
              placeholder={existingProofUrl ? "CWCA already has saved Clio proof for this item." : "Paste the Clio communication, calendar, or matter link"}
            />
            <small>{existingProofUrl ? "Saved CWCA proof exists. Add a link here only if you want to point to newer proof." : "Required before this can be marked Resolved, No Action Needed, or Approved Exception."}</small>
          </label>
          <div className="matter-review-footer">
            <label>
              Case Manager
              <input value={caseManagerName} onChange={(event) => setCaseManagerName(event.target.value)} placeholder="Name" />
            </label>
            <label>
              Reviewed By
              <input value={reviewedBy} onChange={(event) => setReviewedBy(event.target.value)} placeholder="Name" />
            </label>
            <button
              ref={saveRef}
              type="button"
              aria-busy={saveState === "saving"}
              onClick={() => {
                void saveReview();
              }}
            >
              {saveState === "saving" ? "Saving..." : "Save Status"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
