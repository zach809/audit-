import { WORKFLOW_RULES, workflowLabel } from "./workflow-rules";

export type AuditStatus = "Missing" | "Late" | "Unknown" | "Needs Recheck" | "Pending" | "On Time" | "On Track" | string;

export const FOLLOW_UP_STATUSES = new Set(["Missing", "Late", "Unknown", "Needs Review", "Needs Recheck"]);
export const REVIEW_STATUSES = new Set(["Unknown", "Needs Review", "Needs Recheck"]);

export function statusClass(value: string | null | undefined): string {
  return (value || "N/A").replace(/\s+/g, "-").replace("/", "A");
}

export function isGenericApiError(reason?: string | null): boolean {
  return reason === "API_ERROR" || reason === "MATTER_ERROR: API_ERROR" || Boolean(reason?.startsWith("NOTES_400:"));
}

export function isInternalPlaceholder(reason?: string | null): boolean {
  return !reason || reason === "NOT_FOUND" || reason === "UNKNOWN";
}

export function displayAuditStatus(status: string, reasonCode?: string | null): string {
  if (status === "Unknown" && isGenericApiError(reasonCode)) return "Needs Recheck";
  if (status === "Unknown") return "Needs Review";
  if (status === "On Time") return "On Track";
  return status;
}

export function workspaceStatus(status: string, reasonCode?: string | null): string {
  if (status === "Unknown" && isGenericApiError(reasonCode)) return "Needs Recheck";
  if (status === "On Time") return "On Track";
  return status;
}

export function isFollowUpStatus(status: string): boolean {
  return FOLLOW_UP_STATUSES.has(status);
}

export function auditItemPriority(status: string): number {
  if (status === "Missing") return 1;
  if (REVIEW_STATUSES.has(status)) return 2;
  if (status === "Late") return 3;
  if (status === "Pending") return 4;
  if (status === "On Time" || status === "On Track") return 5;
  return 6;
}

export function workspaceFilterMatches(status: string, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "followup") return isFollowUpStatus(status);
  if (filter === "missing") return status === "Missing";
  if (filter === "review") return REVIEW_STATUSES.has(status);
  if (filter === "late") return status === "Late";
  if (filter === "pending") return status === "Pending";
  return isFollowUpStatus(status);
}

export function actionFor(stepCode: string, status: string, reasonCode?: string | null): string {
  const info = WORKFLOW_RULES[stepCode];
  if (status === "Missing") return info ? `${info.missing} ${info.action}` : "Complete or verify this missing workflow step in Clio.";
  if (status === "Late") return info?.late ?? "Review timing. Evidence was found after the deadline.";
  if (status === "Unknown" || status === "Needs Recheck") {
    if (isGenericApiError(reasonCode)) {
      return "Recheck the matter before coaching. This is an audit visibility issue, not proof that work was missed.";
    }
    return info?.unknown ?? "Review this item in Clio. The app could not verify it from API-visible evidence.";
  }
  return "Review this item in Clio.";
}

export function priorityFor(status: string): string {
  if (status === "Missing") return "Action Needed";
  if (status === "Late") return "Timing Improvement";
  if (status === "Unknown" || status === "Needs Recheck") return "Review First";
  return "Review";
}

export function whyFlagged(stepCode: string, status: string, reasonCode?: string | null): string {
  if (status === "Missing") return `${workflowLabel(stepCode)} was not found from the allowed read-only Clio evidence.`;
  if (status === "Late") return `${workflowLabel(stepCode)} was found, but after the expected timeliness goal.`;
  if (status === "Unknown" || status === "Needs Recheck") {
    if (reasonCode && !isInternalPlaceholder(reasonCode)) return `The auditor could not confirm this item from Clio: ${reasonCode}`;
    return "The auditor could not confirm this item from Clio-visible evidence.";
  }
  return "";
}

export function timingGoalFor(stepCode: string): string {
  return WORKFLOW_RULES[stepCode]?.goal ?? "Review the expected workflow timing.";
}
