import { displayAuditStatus } from "./audit-display";

export const COMPLIANCE_KINDS = ["on-time", "late", "missing", "not-due", "no-activity", "other"] as const;

export type ComplianceKind = (typeof COMPLIANCE_KINDS)[number];

export type ComplianceMark = {
  kind: ComplianceKind;
  label: string;
};

export function complianceMark(status: string | null | undefined): ComplianceMark {
  const raw = String(status ?? "").trim();
  const key = raw.toLowerCase();
  if (key === "on time" || key === "on track") return { kind: "on-time", label: "On Time" };
  if (key === "late" || key === "timing review" || key === "late timing") return { kind: "late", label: "Late" };
  if (key === "missing" || key === "needs follow-up" || key === "needs action") return { kind: "missing", label: "Missing" };
  if (key === "pending" || key === "not due yet") return { kind: "not-due", label: "Not Due Yet" };
  if (key === "no activity") return { kind: "no-activity", label: "No activity" };
  return { kind: "other", label: displayAuditStatus(raw) || raw || "N/A" };
}
