import { db, initDb } from "./db";
import { isReviewComplete, normalizeNextStep, normalizeProofType, normalizeReviewDecision } from "./review-shared";

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function saveAuditReview(input: {
  matterId: unknown;
  stepCode: unknown;
  decision: unknown;
  note: unknown;
  resultsDetails?: unknown;
  proofType?: unknown;
  proofReference: unknown;
  nextStep?: unknown;
  reportSummary?: unknown;
  internalNotes?: unknown;
  includeInReport?: unknown;
  reviewedBy?: unknown;
}) {
  await initDb();
  const matterId = cleanText(input.matterId, 80);
  const stepCode = cleanText(input.stepCode, 80);
  if (!matterId || !stepCode) throw new Error("Matter or audit item was not provided.");

  const decision = normalizeReviewDecision(input.decision);
  const note = cleanText(input.resultsDetails ?? input.note, 1200);
  const proofType = normalizeProofType(input.proofType);
  const proofReference = cleanText(input.proofReference, 500);
  const nextStep = normalizeNextStep(input.nextStep);
  const reportSummary = cleanText(input.reportSummary, 1000);
  const internalNotes = cleanText(input.internalNotes, 1000);
  const includeInReport = input.includeInReport === false ? false : true;
  const reviewedBy = cleanText(input.reviewedBy, 120);
  const completed = isReviewComplete({ decision, resultsDetails: note, nextStep });

  const previousRows = await db()`
    select review_decision
    from audit_review
    where matter_id = ${matterId} and step_code = ${stepCode}
    limit 1
  `;
  const previousDecision = previousRows[0]?.review_decision ?? null;

  const rows = await db()`
    insert into audit_review (
      matter_id, step_code, review_decision, review_note, proof_type, proof_reference,
      next_step, report_summary, internal_notes, include_in_report, reviewed_by,
      review_completed_at, updated_at
    )
    values (
      ${matterId}, ${stepCode}, ${decision}, ${note}, ${proofType}, ${proofReference},
      ${nextStep}, ${reportSummary}, ${internalNotes}, ${includeInReport}, ${reviewedBy},
      ${completed ? new Date() : null}, now()
    )
    on conflict (matter_id, step_code) do update set
      review_decision = excluded.review_decision,
      review_note = excluded.review_note,
      proof_type = excluded.proof_type,
      proof_reference = excluded.proof_reference,
      next_step = excluded.next_step,
      report_summary = excluded.report_summary,
      internal_notes = excluded.internal_notes,
      include_in_report = excluded.include_in_report,
      reviewed_by = excluded.reviewed_by,
      review_completed_at = excluded.review_completed_at,
      updated_at = now()
    returning matter_id, step_code, review_decision, review_note, proof_type, proof_reference,
      next_step, report_summary, internal_notes, include_in_report, reviewed_by,
      review_completed_at, updated_at
  `;

  const historyRows = await db()`
    insert into audit_review_history (
      matter_id, step_code, previous_decision, review_decision, results_details,
      proof_type, proof_reference, next_step, report_summary, updated_by, updated_at
    )
    values (
      ${matterId}, ${stepCode}, ${previousDecision}, ${decision}, ${note},
      ${proofType}, ${proofReference}, ${nextStep}, ${reportSummary}, ${reviewedBy}, now()
    )
    returning history_id, previous_decision, review_decision, results_details, proof_type,
      proof_reference, next_step, report_summary, updated_by, updated_at
  `;
  return { ...rows[0], history: historyRows[0] };
}
