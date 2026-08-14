import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { syncStandardsToGoogleSheets } from "@/lib/google-sheets";
import { isAuthorizedWorkerRequest, isValidSessionCookie } from "@/lib/session";

export const maxDuration = 120;

function chicagoDateInput(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function currentMonthRange(): { from: string; to: string } {
  const today = chicagoDateInput(new Date());
  const monthStart = new Date(`${today}T12:00:00`);
  monthStart.setDate(1);
  return {
    from: chicagoDateInput(monthStart),
    to: today,
  };
}

function redirectBack(request: NextRequest, params: Record<string, string>) {
  const search = new URLSearchParams(params);
  return NextResponse.redirect(new URL(`/?${search.toString()}`, request.url), 303);
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedWorkerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const defaultRange = currentMonthRange();
  const filters = {
    from: url.searchParams.get("from") || defaultRange.from,
    to: url.searchParams.get("to") || defaultRange.to,
  };
  try {
    await initDb();
    const result = await syncStandardsToGoogleSheets(filters);
    return NextResponse.json({ ok: true, ...result, filters });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const defaultRange = currentMonthRange();
  const filters = {
    from: form?.get("from")?.toString() || defaultRange.from,
    to: form?.get("to")?.toString() || defaultRange.to,
    tab: "standards",
  };
  try {
    await initDb();
    const result = await syncStandardsToGoogleSheets(filters);
    return redirectBack(request, {
      ...filters,
      sheets: "synced",
      notice: `Google Sheet updated: ${result.rowsSynced} row${result.rowsSynced === 1 ? "" : "s"} across ${result.sheetsUpdated} case-manager tabs.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return redirectBack(request, { ...filters, sheets: "failed", notice: message.slice(0, 240) });
  }
}
