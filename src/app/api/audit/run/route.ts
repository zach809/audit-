import { NextRequest, NextResponse } from "next/server";
import { auditNextBatch, auditOneMatterById } from "@/lib/audit";
import { initDb } from "@/lib/db";
import { isAuthorizedWorkerRequest } from "@/lib/session";
import { appConfig } from "@/lib/config";

export const maxDuration = 300;

function redirectBack(request: NextRequest, params: Record<string, string>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return NextResponse.redirect(new URL(`/?${search.toString()}`, request.url), 303);
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedWorkerRequest(request)) {
    if (!request.headers.get("authorization")) {
      return NextResponse.redirect(new URL("/login", request.url), 303);
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await initDb();
  let result;
  const isManualDashboardRun = Boolean(request.cookies.get("cwca_session"));
  try {
    result = await auditNextBatch(undefined, {
      discover: true,
      discoverLookbackDays: isManualDashboardRun ? 7 : undefined,
      batchSize: appConfig().auditBatchSize,
      selection: isManualDashboardRun ? "recent" : "priority",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (request.cookies.get("cwca_session")) {
      return NextResponse.redirect(new URL(`/?audit=failed&message=${encodeURIComponent(message.slice(0, 240))}`, request.url), 303);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
  if (request.cookies.get("cwca_session")) {
    return NextResponse.redirect(new URL(`/?audit=ran&message=${encodeURIComponent(result.message)}`, request.url), 303);
  }
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  if (request.cookies.get("cwca_session")) {
    const form = await request.formData().catch(() => null);
    const matterId = form?.get("matter_id")?.toString();
    const filters = {
      attorney: form?.get("attorney")?.toString() ?? "",
      overall: form?.get("overall")?.toString() ?? "",
      from: form?.get("from")?.toString() ?? "",
      to: form?.get("to")?.toString() ?? "",
    };
    if (matterId) {
      try {
        const result = await auditOneMatterById(undefined, matterId);
        return redirectBack(request, { ...filters, audit: "ran", message: result.message });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return redirectBack(request, { ...filters, audit: "failed", message: message.slice(0, 240) });
      }
    }
    try {
      const result = await auditNextBatch(undefined, {
        batchSize: appConfig().auditBatchSize,
        maxRunMs: 25000,
        selection: "recent",
        filters,
      });
      return redirectBack(request, { ...filters, audit: "ran", message: result.message });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return redirectBack(request, { ...filters, audit: "failed", message: message.slice(0, 240) });
    }
  }
  return GET(request);
}
