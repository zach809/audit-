import { NextRequest, NextResponse } from "next/server";
import { saveAuditReview } from "@/lib/review-notes";
import { isValidSessionCookie } from "@/lib/session";
import { scheduleStandardsPublish } from "@/lib/standards-publish";

export async function POST(request: NextRequest) {
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
