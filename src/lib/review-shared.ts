export const REVIEW_DECISIONS = [
  "Needs Review",
  "In Progress",
  "Resolved",
  "Still Needs Action",
  "Approved Exception",
  "No Action Needed",
  "Needs Attorney Review",
  "Unable to Confirm",
  "Skipped for Now",
] as const;

export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const PROOF_TYPES = [
  "Teams Reply",
  "Screenshot",
  "Clio Check",
  "Scheduled Email",
  "Manual Confirmation",
  "Approved Exception",
  "Other",
  "None Available",
] as const;

export type ProofType = (typeof PROOF_TYPES)[number];

export const NEXT_STEPS = [
  "No further action needed",
  "Case manager needs to update Clio",
  "Case manager needs to provide proof",
  "Attorney review needed",
  "Auditor needs to manually check Clio",
  "Follow up next week",
  "Other",
] as const;

export type ReviewNextStep = (typeof NEXT_STEPS)[number];

export type ReviewResult = "Resolved" | "In Progress" | "Still Needs Follow-Up" | "Approved Exception" | "Needs Review";

export function normalizeReviewDecision(value: unknown): ReviewDecision {
  if (value === "Complete") return "Resolved";
  if (String(value).toLowerCase() === ["false", "alarm"].join(" ")) return "No Action Needed";
  if (value === "Pending") return "Needs Review";
  return REVIEW_DECISIONS.includes(value as ReviewDecision) ? (value as ReviewDecision) : "Needs Review";
}

export function reviewResult(decision?: string | null): ReviewResult {
  if (decision === "Resolved" || decision === "No Action Needed") return "Resolved";
  if (decision === "Approved Exception") return "Approved Exception";
  if (decision === "In Progress" || decision === "Needs Attorney Review") return "In Progress";
  if (decision === "Still Needs Action" || decision === "Unable to Confirm") return "Still Needs Follow-Up";
  return "Needs Review";
}

export function normalizeProofType(value: unknown): ProofType {
  return PROOF_TYPES.includes(value as ProofType) ? (value as ProofType) : "None Available";
}

export function normalizeNextStep(value: unknown): ReviewNextStep | "" {
  return NEXT_STEPS.includes(value as ReviewNextStep) ? (value as ReviewNextStep) : "";
}

export function isReviewComplete(input: { decision?: string | null; resultsDetails?: string | null; nextStep?: string | null }): boolean {
  return Boolean(
    input.decision &&
      input.decision !== "Skipped for Now" &&
      input.resultsDetails?.trim() &&
      input.nextStep?.trim(),
  );
}
