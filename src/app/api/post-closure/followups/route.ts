import { NextRequest, NextResponse } from "next/server";
import { savePostClosureFollowup } from "@/lib/post-closure";
import { isValidSessionCookie } from "@/lib/session";
import { dashboardReturnUrl } from "@/lib/dashboard-return";

function redirectBack(request: NextRequest, params: Record<string, string>, matterId?: string) {
  return NextResponse.redirect(new URL(dashboardReturnUrl(params, matterId), request.url), 303);
}

export async function POST(request: NextRequest) {
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

  const matterId = form.get("matter_id")?.toString();

  try {
    await savePostClosureFollowup({
      matterId,
      touchpointMonths: form.get("touchpoint_months"),
      reviewStatus: form.get("review_status"),
      contactMethod: form.get("contact_method"),
      issueType: form.get("issue_type"),
      followupNote: form.get("followup_note"),
      reviewedBy: form.get("reviewed_by"),
    });
    return redirectBack(request, { ...filters, postClosure: "saved", message: "Post-closure follow-up saved." }, matterId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return redirectBack(request, { ...filters, postClosure: "failed", message: message.slice(0, 240) }, matterId);
  }
}
