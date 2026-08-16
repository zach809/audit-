"use server";

import { adminWriteRefusal } from "@/lib/admin-write";
import { writeMetricExclusion } from "@/lib/metric-exclusion";
import { saveAuditReview } from "@/lib/review-notes";
import { hasDashboardSession } from "@/lib/session";
import { scheduleStandardsPublish } from "@/lib/standards-publish";

export type WriteResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

export async function updateMatterExclusion(input: {
  action: string;
  matterId: string;
  reason?: string;
  requestedBy?: string;
}): Promise<WriteResult<{ excluded: boolean }>> {
  const refusal = adminWriteRefusal(hasDashboardSession());
  if (refusal) return { ok: false, error: refusal };
  try {
    const result = await writeMetricExclusion({
      action: input.action,
      matterId: input.matterId,
      reason: input.reason ?? "",
      requestedBy: input.requestedBy ?? "",
    });
    return { ok: true, excluded: result.excluded };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update this matter.";
    return { ok: false, error: message };
  }
}

export async function saveMatterReview(input: {
  matterId: string;
  stepCode: string;
  decision: string;
  note: string;
  nextStep: string;
  reviewedBy: string;
  caseManagerName: string;
  proofReference: string;
}): Promise<WriteResult> {
  const refusal = adminWriteRefusal(hasDashboardSession());
  if (refusal) return { ok: false, error: refusal };
  try {
    await saveAuditReview({
      matterId: input.matterId,
      stepCode: input.stepCode,
      decision: input.decision,
      note: input.note,
      resultsDetails: input.note,
      proofType: "Clio Check",
      proofReference: input.proofReference,
      nextStep: input.nextStep,
      reportSummary: input.note,
      internalNotes: "",
      includeInReport: true,
      caseManagerName: input.caseManagerName,
      reviewedBy: input.reviewedBy,
    });
    scheduleStandardsPublish();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save this review.";
    return { ok: false, error: message };
  }
}
