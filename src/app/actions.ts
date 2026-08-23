"use server";

import { redirect } from "next/navigation";
import { auditNextBatch } from "@/lib/audit";
import { hasDashboardSession } from "@/lib/session";
import { WRITE_BLOCKED_MESSAGE, writesAllowed } from "@/lib/write-guard";

export async function runAuditFromDashboard() {
  if (!hasDashboardSession()) {
    redirect("/login");
  }
  // Same audit run as GET /api/audit/run, which has been guarded since #42.
  if (!writesAllowed()) {
    redirect(`/?audit=failed&message=${encodeURIComponent(WRITE_BLOCKED_MESSAGE)}`);
  }
  let result;
  try {
    result = await auditNextBatch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    redirect(`/?audit=failed&message=${encodeURIComponent(message.slice(0, 240))}`);
  }
  redirect(`/?audit=ran&message=${encodeURIComponent(result.message)}`);
}
