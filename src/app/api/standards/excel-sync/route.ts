import { NextRequest, NextResponse } from "next/server";
import { initDb } from "@/lib/db";
import { syncStandardsToMicrosoftExcel } from "@/lib/microsoft-excel";
import { isAuthorizedWorkerRequest, isValidSessionCookie } from "@/lib/session";
import { currentChicagoMonthRange } from "@/lib/standards-sheet-sync";
import { rejectNonProductionExcelSync } from "@/lib/write-guard";

export const maxDuration = 120;

function redirectBack(request: NextRequest, params: Record<string, string>) {
  const search = new URLSearchParams(params);
  return NextResponse.redirect(new URL(`/?${search.toString()}`, request.url), 303);
}

export async function GET(request: NextRequest) {
  const blocked = rejectNonProductionExcelSync();
  if (blocked) return blocked;
  if (!isAuthorizedWorkerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const defaultRange = currentChicagoMonthRange();
  const filters = {
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
  const blocked = rejectNonProductionExcelSync();
  if (blocked) return blocked;
  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const defaultRange = currentChicagoMonthRange();
  const filters = {
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
      notice: `Excel workbook ${result.workbookTarget} updated (${result.authMode === "delegated" ? `delegated as ${result.authAccount}` : "application client-credentials"}): ${result.rowsSynced} row${result.rowsSynced === 1 ? "" : "s"} across ${result.sheetsUpdated} case-manager tabs.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return redirectBack(request, { ...filters, excel: "failed", notice: message.slice(0, 240) });
  }
}
