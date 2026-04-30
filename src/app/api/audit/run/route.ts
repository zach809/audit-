import { NextRequest, NextResponse } from "next/server";
import { auditNextBatch } from "@/lib/audit";
import { initDb } from "@/lib/db";
import { isAuthorizedWorkerRequest } from "@/lib/session";

export async function GET(request: NextRequest) {
  if (!isAuthorizedWorkerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await initDb();
  const result = await auditNextBatch();
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  return GET(request);
}
