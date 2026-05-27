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
  const formData = await request.formData().catch(() => null);
  const formValue = (name: string) => {
    const value = formData?.get(name);
    return typeof value === "string" ? value : "";
  };
  const filters = {
    attorney: formValue("attorney") || url.searchParams.get("attorney") || "",
    overall: formValue("overall") || url.searchParams.get("overall") || "",
    from: formValue("from") || url.searchParams.get("from") || "",
    to: formValue("to") || url.searchParams.get("to") || "",
  };
  const exportType = url.searchParams.get("type") ?? "";
  const isActionList = exportType === "actions";
  const isCaseManagerText = exportType === "case-manager-text";
  const body = isCaseManagerText
    ? await caseManagerTodoText(filters, url.origin)
    : isActionList
      ? await actionItemsCsv(filters, url.origin)
      : await dashboardCsv(filters);
  const filename = isCaseManagerText
    ? "cwca-case-manager-missing-items-review.txt"
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
