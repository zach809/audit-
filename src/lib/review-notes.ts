import { db, initDb } from "./db";
import { normalizeReviewDecision } from "./review-shared";

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function saveAuditReview(input: {
  matterId: unknown;
  stepCode: unknown;
  decision: unknown;
  note: unknown;
  proofReference: unknown;
  reviewedBy?: unknown;
}) {
  await initDb();
  const matterId = cleanText(input.matterId, 80);
  const stepCode = cleanText(input.stepCode, 80);
  if (!matterId || !stepCode) throw new Error("Missing matter or audit item.");

  const decision = normalizeReviewDecision(input.decision);
  const note = cleanText(input.note, 800);
  const proofReference = cleanText(input.proofReference, 500);
  const reviewedBy = cleanText(input.reviewedBy, 120);

  const rows = await db()`
    insert into audit_review (
      matter_id, step_code, review_decision, review_note, proof_reference, reviewed_by, updated_at
    )
    values (
      ${matterId}, ${stepCode}, ${decision}, ${note}, ${proofReference}, ${reviewedBy}, now()
    )
    on conflict (matter_id, step_code) do update set
      review_decision = excluded.review_decision,
      review_note = excluded.review_note,
      proof_reference = excluded.proof_reference,
      reviewed_by = excluded.reviewed_by,
      updated_at = now()
    returning matter_id, step_code, review_decision, review_note, proof_reference, reviewed_by, updated_at
  `;
  return rows[0];
}
