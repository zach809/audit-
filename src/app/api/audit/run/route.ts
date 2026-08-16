import { NextRequest, NextResponse } from "next/server";
import { auditNextBatch, auditOneMatterById } from "@/lib/audit";
import { initDb } from "@/lib/db";
import { isAuthorizedWorkerRequest } from "@/lib/session";
import { appConfig } from "@/lib/config";
import { scheduleStandardsPublish } from "@/lib/standards-publish";
import { dashboardReturnUrl } from "@/lib/dashboard-return";
import { rejectNonProductionWrite } from "@/lib/write-guard";

export const maxDuration = 300;

function redirectBack(request: NextRequest, params: Record<string, string>, matterId?: string) {
  return NextResponse.redirect(new URL(dashboardReturnUrl(params, matterId), request.url), 303);
}

export async function GET(request: NextRequest) {
  const blocked = rejectNonProductionWrite();
  if (blocked) return blocked;
  if (!isAuthorizedWorkerRequest(request)) {
    if (!request.headers.get("authorization")) {
      return NextResponse.redirect(new URL("/login", request.url), 303);
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let result;
  const isManualDashboardRun = Boolean(request.cookies.get("cwca_session"));
  try {
    await initDb();
    const config = appConfig();
    result = await auditNextBatch(undefined, {
      discover: true,
      discoverLookbackDays: config.initialLookbackDays,
      batchSize: config.auditBatchSize,
      selection: isManualDashboardRun ? "recent" : "priority",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request.cookies.get("cwca_session")) {
      return NextResponse.redirect(new URL(`/?audit=failed&message=${encodeURIComponent(message.slice(0, 240))}`, request.url), 303);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
  scheduleStandardsPublish({ auditStatus: "completed" });
  if (request.cookies.get("cwca_session")) {
    return NextResponse.redirect(new URL(`/?audit=ran&message=${encodeURIComponent(result.message)}`, request.url), 303);
  }
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const blocked = rejectNonProductionWrite();
  if (blocked) return blocked;
  if (request.cookies.get("cwca_session")) {
    const form = await request.formData().catch(() => null);
    const matterId = form?.get("matter_id")?.toString();
    const filters = {
      attorney: form?.get("attorney")?.toString() ?? "",
      overall: form?.get("overall")?.toString() ?? "",
      from: form?.get("from")?.toString() ?? "",
      to: form?.get("to")?.toString() ?? "",
      tab: form?.get("tab")?.toString() ?? "",
      wstatus: form?.get("wstatus")?.toString() ?? "",
      wfocus: form?.get("wfocus")?.toString() ?? "",
      wstep: form?.get("wstep")?.toString() ?? "",
      cm: form?.get("cm")?.toString() ?? "",
      sort: form?.get("sort")?.toString() ?? "",
      dir: form?.get("dir")?.toString() ?? "",
      page: form?.get("page")?.toString() ?? "",
    };
    if (matterId) {
      try {
        const result = await auditOneMatterById(undefined, matterId);
        scheduleStandardsPublish({ auditStatus: "completed" });
        return redirectBack(request, { ...filters, audit: "ran", message: result.message }, matterId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return redirectBack(request, { ...filters, audit: "failed", message: message.slice(0, 240) }, matterId);
      }
    }
    try {
      const config = appConfig();
      const result = await auditNextBatch(undefined, {
        discover: true,
        discoverLookbackDays: config.initialLookbackDays,
        batchSize: Math.max(config.auditBatchSize, 25),
        maxRunMs: 25000,
        selection: "recent",
        filters,
      });
      scheduleStandardsPublish({ auditStatus: "completed" });
      return redirectBack(request, { ...filters, audit: "ran", message: result.message });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return redirectBack(request, { ...filters, audit: "failed", message: message.slice(0, 240) });
    }
  }
  return GET(request);
}
