import { NextRequest, NextResponse } from "next/server";
import { savePostClosureFollowup } from "@/lib/post-closure";
import { isValidSessionCookie } from "@/lib/session";
import { rejectNonProductionWrite } from "@/lib/write-guard";

function redirectBack(request: NextRequest, params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return NextResponse.redirect(new URL(`/?${search.toString()}`, request.url), 303);
}

export async function POST(request: NextRequest) {
  const blocked = rejectNonProductionWrite();
  if (blocked) return blocked;
  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await request.formData();
  const filters = {
    tab: "post-closure",
    closure_status: form.get("closure_status")?.toString() ?? "due",
    closure_stage: form.get("closure_stage")?.toString() ?? "",
    closure_attorney: form.get("closure_attorney")?.toString() ?? "",
    closure_window: form.get("closure_window")?.toString() ?? "current",
  };

  try {
    await savePostClosureFollowup({
      matterId: form.get("matter_id"),
      touchpointMonths: form.get("touchpoint_months"),
      reviewStatus: form.get("review_status"),
      contactMethod: form.get("contact_method"),
      issueType: form.get("issue_type"),
      followupNote: form.get("followup_note"),
      reviewedBy: form.get("reviewed_by"),
    });
    return redirectBack(request, { ...filters, postClosure: "saved", message: "Post-closure follow-up saved." });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return redirectBack(request, { ...filters, postClosure: "failed", message: message.slice(0, 240) });
  }
}
