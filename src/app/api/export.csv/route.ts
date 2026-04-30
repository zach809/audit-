import { NextRequest, NextResponse } from "next/server";
import { dashboardCsv } from "@/lib/dashboard-data";
import { isValidSessionCookie } from "@/lib/session";

export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/", request.url), 303);
}

export async function POST(request: NextRequest) {
  if (!isValidSessionCookie(request.cookies.get("cwca_session")?.value)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const url = new URL(request.url);
  const csv = await dashboardCsv({
    attorney: url.searchParams.get("attorney") ?? "",
    overall: url.searchParams.get("overall") ?? "",
    from: url.searchParams.get("from") ?? "",
    to: url.searchParams.get("to") ?? "",
  });
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="cwca-audit.csv"`,
    },
  });
}
