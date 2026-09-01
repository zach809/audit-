import type { WorkspaceAuditItem } from "@/lib/dashboard-data";
import { APP_VERSION } from "@/lib/version";

export const CASE_MANAGER_KPIS = [
  { code: "SETUP_WELCOME", label: "Welcome Letter" },
  { code: "SETUP_ATTY_CALL", label: "Initial Attorney-Client Call" },
  { code: "SETUP_COURT_DATE", label: "Court Date Added" },
  { code: "WEEKLY_CLIENT_CHECKIN", label: "Weekly Client Check-In" },
] as const;

export type CaseManagerKpiCode = (typeof CASE_MANAGER_KPIS)[number]["code"];

export type CaseManagerDeduction = {
  row: WorkspaceAuditItem;
  kind: "missing" | "late";
  points: number;
  reason: string;
};

export type CaseManagerKpiScore = {
  code: CaseManagerKpiCode;
  label: string;
  expected: number;
  completed: number;
  missing: number;
  late: number;
  deduction: number;
  completionPercent: number;
};

export type CaseManagerScore = {
  score: number;
  totalMissing: number;
  totalLate: number;
  totalDeduction: number;
  kpis: CaseManagerKpiScore[];
  deductions: CaseManagerDeduction[];
};

export type CaseManagerActionItem = {
  row: WorkspaceAuditItem;
  urgency: "due-today" | "due-soon" | "upcoming";
};

const CLEARING_DECISIONS = new Set(["Resolved", "No Action Needed", "Approved Exception"]);
const GENERIC_REASONS = new Set(["", "NOT_FOUND", "EVIDENCE_NOT_CONFIRMED"]);

function dateKey(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function inRange(value: Date | string | null | undefined, from: string, to: string): boolean {
  const key = dateKey(value);
  return Boolean(key && key >= from && key <= to);
}

function rowDate(row: WorkspaceAuditItem): Date | null {
  const raw = row.review_updated_at ?? row.evidence_at ?? row.deadline_at ?? row.matter_created_at;
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isFinite(date.getTime()) ? date : null;
}

function preferRow(a: WorkspaceAuditItem, b: WorkspaceAuditItem): WorkspaceAuditItem {
  const aCurrent = a.audit_version === APP_VERSION ? 1 : 0;
  const bCurrent = b.audit_version === APP_VERSION ? 1 : 0;
  if (aCurrent !== bCurrent) return bCurrent > aCurrent ? b : a;
  return (rowDate(b)?.getTime() ?? 0) > (rowDate(a)?.getTime() ?? 0) ? b : a;
}

function dedupeRows(rows: WorkspaceAuditItem[]): WorkspaceAuditItem[] {
  const byItem = new Map<string, WorkspaceAuditItem>();
  for (const row of rows) {
    const key = `${row.matter_id}:${row.step_code}`;
    const existing = byItem.get(key);
    byItem.set(key, existing ? preferRow(existing, row) : row);
  }
  return [...byItem.values()];
}

function isProtected(row: WorkspaceAuditItem): boolean {
  return Boolean(
    row.metric_excluded ||
      row.metric_exclusion_requested_by ||
      CLEARING_DECISIONS.has(row.review_decision ?? ""),
  );
}

function deadlinePassed(row: WorkspaceAuditItem, now: Date): boolean {
  if (!row.deadline_at) return false;
  const deadline = row.deadline_at instanceof Date ? row.deadline_at : new Date(String(row.deadline_at));
  return Number.isFinite(deadline.getTime()) && deadline.getTime() < now.getTime();
}

function confirmedMissing(row: WorkspaceAuditItem, now: Date): boolean {
  if (row.item_status !== "Missing" || isProtected(row)) return false;
  if (row.audit_version !== APP_VERSION || !deadlinePassed(row, now)) return false;
  return !GENERIC_REASONS.has(String(row.reason_code ?? "").trim());
}

function confirmedLate(row: WorkspaceAuditItem): boolean {
  return (
    row.item_status === "Late" &&
    !isProtected(row) &&
    row.audit_version === APP_VERSION &&
    Boolean(row.evidence_ref_id || row.evidence_url || row.evidence_at)
  );
}

function completed(row: WorkspaceAuditItem): boolean {
  if (isProtected(row)) return true;
  return ["On Time", "On Track", "Late"].includes(row.item_status) && Boolean(
    row.evidence_ref_id || row.evidence_url || row.evidence_at,
  );
}

function deadlineDate(row: WorkspaceAuditItem): Date | null {
  if (!row.deadline_at) return null;
  const deadline = row.deadline_at instanceof Date ? row.deadline_at : new Date(String(row.deadline_at));
  return Number.isFinite(deadline.getTime()) ? deadline : null;
}

function plainReason(row: WorkspaceAuditItem, kind: "missing" | "late"): string {
  if (kind === "late") {
    return "CWCA found the Clio proof, but the work was completed after the standard's deadline.";
  }
  switch (row.step_code) {
    case "SETUP_WELCOME":
      return "The deadline and grace period passed without a confirmed Welcome Letter email in Clio Communications.";
    case "SETUP_ATTY_CALL":
      return "The deadline and grace period passed without a confirmed attorney-client call event or communication in Clio.";
    case "SETUP_COURT_DATE":
      return "The deadline and grace period passed without a confirmed court-date calendar event linked to this matter.";
    case "WEEKLY_CLIENT_CHECKIN":
      return "The 10-day contact window and grace period passed without a confirmed outgoing call, email, or SMS in Clio.";
    default:
      return "The deadline and grace period passed without confirmed proof in Clio.";
  }
}

export function buildCaseManagerScore(
  allRows: WorkspaceAuditItem[],
  options: { from: string; to: string; now?: Date },
): CaseManagerScore {
  const now = options.now ?? new Date();
  const rows = dedupeRows(allRows).filter((row) =>
    CASE_MANAGER_KPIS.some((kpi) => kpi.code === row.step_code),
  );
  const deductions: CaseManagerDeduction[] = [];

  const kpis = CASE_MANAGER_KPIS.map((kpi): CaseManagerKpiScore => {
    const scoped = rows.filter((row) => {
      if (row.step_code !== kpi.code) return false;
      const belongsToWindow = kpi.code === "WEEKLY_CLIENT_CHECKIN"
        ? inRange(row.deadline_at, options.from, options.to)
        : inRange(row.matter_created_at, options.from, options.to);
      if (!belongsToWindow) return false;

      // Human decisions remain scoreable, but stale or generic machine rows do not.
      // This keeps an old NOT_FOUND result from becoming a new point deduction.
      if (isProtected(row)) return true;
      if (row.audit_version !== APP_VERSION) return false;
      if (row.item_status === "Missing" && GENERIC_REASONS.has(String(row.reason_code ?? "").trim())) {
        return false;
      }
      return true;
    });
    let missing = 0;
    let late = 0;
    for (const row of scoped) {
      if (confirmedMissing(row, now)) {
        missing += 1;
        deductions.push({ row, kind: "missing", points: 2, reason: plainReason(row, "missing") });
      } else if (confirmedLate(row)) {
        late += 1;
        deductions.push({ row, kind: "late", points: 0.5, reason: plainReason(row, "late") });
      }
    }
    const expected = scoped.length;
    const completedCount = scoped.filter(completed).length;
    const deduction = missing * 2 + late * 0.5;
    return {
      code: kpi.code,
      label: kpi.label,
      expected,
      completed: completedCount,
      missing,
      late,
      deduction,
      completionPercent: expected ? Math.round((completedCount / expected) * 100) : 100,
    };
  });

  const totalMissing = deductions.filter((item) => item.kind === "missing").length;
  const totalLate = deductions.filter((item) => item.kind === "late").length;
  const totalDeduction = totalMissing * 2 + totalLate * 0.5;
  return {
    score: Math.max(0, Math.round((100 - totalDeduction) * 10) / 10),
    totalMissing,
    totalLate,
    totalDeduction,
    kpis,
    deductions: deductions.sort((a, b) => b.points - a.points),
  };
}

export function buildCaseManagerActionQueue(
  allRows: WorkspaceAuditItem[],
  options: { now?: Date; horizonDays?: number } = {},
): CaseManagerActionItem[] {
  const now = options.now ?? new Date();
  const horizon = new Date(now.getTime() + (options.horizonDays ?? 7) * 24 * 60 * 60 * 1000);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const dueSoon = new Date(now.getTime() + 72 * 60 * 60 * 1000);

  return dedupeRows(allRows)
    .filter((row) => CASE_MANAGER_KPIS.some((kpi) => kpi.code === row.step_code))
    .filter((row) => {
      if (row.audit_version !== APP_VERSION || isProtected(row) || completed(row)) return false;
      const deadline = deadlineDate(row);
      return Boolean(deadline && deadline.getTime() >= now.getTime() && deadline.getTime() <= horizon.getTime());
    })
    .map((row): CaseManagerActionItem => {
      const deadline = deadlineDate(row)!;
      const urgency: CaseManagerActionItem["urgency"] = deadline <= endOfToday
        ? "due-today"
        : deadline <= dueSoon
          ? "due-soon"
          : "upcoming";
      return { row, urgency };
    })
    .sort((a, b) => deadlineDate(a.row)!.getTime() - deadlineDate(b.row)!.getTime());
}
