import { NextRequest, NextResponse } from "next/server";
import { actionItemsCsv, dashboardCsv } from "@/lib/dashboard-data";
import { isValidSessionCookie } from "@/lib/session";

export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/", request.url), 303);
}

export async function POST(request: NextRequest) {
  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const url = new URL(request.url);
  const filters = {
    attorney: url.searchParams.get("attorney") ?? "",
    overall: url.searchParams.get("overall") ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  };
  const actionList = url.searchParams.get("type") === "actions";
  const csv = actionList ? await actionItemsCsv(filters, url.origin) : await dashboardCsv(filters);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${actionList ? "cwca-attorney-assistant-action-report.csv" : "cwca-audit.csv"}"`,
    },
  });
}
