import { NextRequest, NextResponse } from "next/server";
import { saveAuditReview } from "@/lib/review-notes";
import { isValidSessionCookie } from "@/lib/session";
import { scheduleStandardsPublish } from "@/lib/standards-publish";
import { rejectNonProductionWrite } from "@/lib/write-guard";

export async function POST(request: NextRequest) {
  // Both effects here are already scoped to this deployment: the review row goes to its database
  // branch, and scheduleStandardsPublish publishes Excel, which #42 scoped. This closes the last hole
  // in the rule that a non-production deployment does not write, not a leak into production.
  const blocked = rejectNonProductionWrite();
  if (blocked) return blocked;
  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const review = await saveAuditReview(body);
    scheduleStandardsPublish();
    return NextResponse.json({ review });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save review.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
