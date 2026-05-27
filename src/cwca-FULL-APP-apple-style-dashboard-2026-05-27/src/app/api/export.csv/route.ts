import { NextRequest, NextResponse } from "next/server";
import { actionItemsCsv, caseManagerTodoText, dashboardCsv } from "@/lib/dashboard-data";
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
  const exportType = url.searchParams.get("type") ?? "";
  const isActionList = exportType === "actions";
  const isCaseManagerText = exportType === "case-manager-text";
  const caseManagerFilters = isCaseManagerText
    ? {
        attorney: "",
        overall: "",
        from: "",
        to: "",
      }
    : filters;
  const body = isCaseManagerText
    ? await caseManagerTodoText(caseManagerFilters, url.origin)
    : isActionList
      ? await actionItemsCsv(filters, url.origin)
      : await dashboardCsv(filters);
  const filename = isCaseManagerText
    ? "cwca-case-manager-to-do-list.txt"
    : isActionList
      ? "cwca-case-manager-action-report.csv"
      : "cwca-audit.csv";
  return new NextResponse(body, {
    headers: {
      "content-type": `${isCaseManagerText ? "text/plain" : "text/csv"}; charset=utf-8`,
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
