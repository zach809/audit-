import { NextRequest, NextResponse } from "next/server";
import { isValidSessionCookie } from "@/lib/session";
import { syncPostClosureFollowups } from "@/lib/post-closure";

export const maxDuration = 300;

function redirectBack(request: NextRequest, params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return NextResponse.redirect(new URL(`/?${search.toString()}`, request.url), 303);
}

export async function POST(request: NextRequest) {
  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncPostClosureFollowups();
    const message = `Closed-matter follow-ups refreshed: ${result.syncedMatters} closed matters, ${result.remindersCreated} reminders.`;
    return redirectBack(request, {
      tab: "post-closure",
      closure_status: "due",
      postClosure: "synced",
      message,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return redirectBack(request, {
      tab: "post-closure",
      postClosure: "failed",
      message: message.slice(0, 240),
    });
  }
}
