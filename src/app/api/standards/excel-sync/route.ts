import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { syncStandardsToMicrosoftExcel } from "@/lib/microsoft-excel";
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

function currentWeekStart(): string {
  const today = chicagoDateInput(new Date());
  const localNoon = new Date(`${today}T12:00:00`);
  const day = localNoon.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  localNoon.setDate(localNoon.getDate() + diff);
  return chicagoDateInput(localNoon);
}

function addDateKeyDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return chicagoDateInput(date);
}

function lastCompletedWeekRange(): { from: string; to: string } {
  const currentStart = currentWeekStart();
  return {
    from: addDateKeyDays(currentStart, -7),
    to: addDateKeyDays(currentStart, -1),
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
  const defaultRange = lastCompletedWeekRange();
  const filters = {
    attorney: url.searchParams.get("attorney") || "",
    overall: url.searchParams.get("overall") || "",
    from: url.searchParams.get("from") || defaultRange.from,
    to: url.searchParams.get("to") || defaultRange.to,
  };
  try {
    await initDb();
    const result = await syncStandardsToMicrosoftExcel(filters);
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
  const defaultRange = lastCompletedWeekRange();
  const filters = {
    attorney: form?.get("attorney")?.toString() ?? "",
    overall: form?.get("overall")?.toString() ?? "",
    from: form?.get("from")?.toString() || defaultRange.from,
    to: form?.get("to")?.toString() || defaultRange.to,
    tab: "standards",
  };
  try {
    await initDb();
    const result = await syncStandardsToMicrosoftExcel(filters);
    return redirectBack(request, {
      ...filters,
      excel: "synced",
      notice: `Excel workbook updated: ${result.rowsSynced} row${result.rowsSynced === 1 ? "" : "s"} across ${result.sheetsUpdated} case-manager tabs.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return redirectBack(request, { ...filters, excel: "failed", notice: message.slice(0, 240) });
  }
}
