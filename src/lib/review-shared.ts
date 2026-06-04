export const REVIEW_DECISIONS = [
  "Pending",
  "Complete",
  "In Progress",
  "Still Needs Action",
  "False Alarm",
  "Needs Attorney Review",
] as const;

export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export type ReviewResult = "Resolved" | "In Progress" | "Pending";

export function normalizeReviewDecision(value: unknown): ReviewDecision {
  return REVIEW_DECISIONS.includes(value as ReviewDecision) ? (value as ReviewDecision) : "Pending";
}

export function reviewResult(decision?: string | null): ReviewResult {
  if (decision === "Complete" || decision === "False Alarm") return "Resolved";
  if (decision === "In Progress" || decision === "Needs Attorney Review") return "In Progress";
  return "Pending";
}
