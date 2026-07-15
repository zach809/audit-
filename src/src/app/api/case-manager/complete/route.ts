import { NextRequest, NextResponse } from "next/server";
import { auditOneMatterById } from "@/lib/audit";
import { db, initDb } from "@/lib/db";
import { saveAuditReview } from "@/lib/review-notes";
import { caseManagerSession } from "@/lib/session";
import { workflowLabel } from "@/lib/workflow-rules";

function portalRedirect(request: NextRequest, params: Record<string, string>) {
  const search = new URLSearchParams(params);
  return NextResponse.redirect(new URL(`/case-manager?${search.toString()}`, request.url), 303);
}

export async function POST(request: NextRequest) {
  const caseManagerName = caseManagerSession(request.cookies.get("cwca_cm_session")?.value);
  if (!caseManagerName) {
    return NextResponse.redirect(new URL("/case-manager/login", request.url), 303);
  }

  const form = await request.formData();
  const matterId = String(form.get("matter_id") ?? "").trim();
  const stepCode = String(form.get("step_code") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();
  const proofReference = String(form.get("proof_reference") ?? "").trim();
  const label = workflowLabel(stepCode);

  if (!matterId || !stepCode) {
    return portalRedirect(request, { cm: "failed", message: "Task details were missing. Please try again." });
  }

  try {
    await initDb();
    await auditOneMatterById(undefined, matterId);

    const sql = db();
    const rows = await sql<Array<{
      status: string;
      evidence_ref_id: string | null;
      evidence_url: string | null;
      evidence_source: string | null;
    }>>`
      select status, evidence_ref_id, evidence_url, evidence_source
      from audit_item
      where matter_id = ${matterId} and step_code = ${stepCode}
      limit 1
    `;
    const proof = rows[0];
    const proofText = proof?.evidence_url || (proof?.evidence_ref_id ? `${proof.evidence_source ?? "Clio proof"} #${proof.evidence_ref_id}` : proofReference);
    const proofFound = Boolean(proof?.evidence_ref_id || proof?.evidence_url);

    if (!proofFound) {
      await saveAuditReview({
        matterId,
        stepCode,
        decision: "In Progress",
        note,
        resultsDetails: note || `${caseManagerName} marked ${label} complete, but CWCA rechecked Clio and did not find proof yet.`,
        caseManagerName,
        proofType: "Clio Check",
        proofReference,
        nextStep: "CWCA did not find proof in Clio yet",
        reportSummary: `${label} was reported complete, but proof was not found in Clio during the recheck.`,
        reviewedBy: caseManagerName,
      });
      return portalRedirect(request, {
        cm: "proof-missing",
        message: `${label} stayed open because CWCA rechecked Clio and did not find proof yet.`,
      });
    }

    await saveAuditReview({
      matterId,
      stepCode,
      decision: "Resolved",
      note,
      resultsDetails: note || `${caseManagerName} completed ${label}; CWCA rechecked Clio and found proof.`,
      caseManagerName,
      proofType: "Clio Check",
      proofReference: proofText,
      nextStep: "No further action needed",
      reportSummary: `${label} was completed and verified with Clio proof.`,
      reviewedBy: caseManagerName,
    });

    return portalRedirect(request, {
      cm: "cleared",
      message: `${label} was verified in Clio and cleared.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return portalRedirect(request, { cm: "failed", message: message.slice(0, 220) });
  }
}
