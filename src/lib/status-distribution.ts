import { complianceMark, type ComplianceKind } from "./compliance-mark";

export type StatusSegment = {
  kind: ComplianceKind;
  label: string;
  count: number;
  className: `mark-${ComplianceKind}`;
};

const ORDER: ComplianceKind[] = ["missing", "late", "on-time", "not-due", "no-activity", "other"];

export function statusSegments(rows: Array<{ status: string }>): StatusSegment[] {
  const counts = new Map<ComplianceKind, StatusSegment>();
  for (const row of rows) {
    const mark = complianceMark(row.status);
    const current = counts.get(mark.kind);
    if (current) {
      current.count += 1;
    } else {
      counts.set(mark.kind, {
        kind: mark.kind,
        label: mark.label,
        count: 1,
        className: `mark-${mark.kind}`,
      });
    }
  }
  return ORDER.flatMap((kind) => {
    const segment = counts.get(kind);
    return segment ? [segment] : [];
  });
}
