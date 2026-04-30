import { NextRequest, NextResponse } from "next/server";
import { auditNextBatch } from "@/lib/audit";
import { initDb } from "@/lib/db";
import { isAuthorizedWorkerRequest } from "@/lib/session";
import { appConfig } from "@/lib/config";

export const maxDuration = 300;

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
      discover: !isManualDashboardRun,
      batchSize: isManualDashboardRun ? 1 : appConfig().auditBatchSize,
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
  return GET(request);
}
