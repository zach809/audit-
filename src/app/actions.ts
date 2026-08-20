"use server";

import { redirect } from "next/navigation";
import { auditNextBatch } from "@/lib/audit";
import { hasDashboardSession } from "@/lib/session";

export async function runAuditFromDashboard() {
  if (!hasDashboardSession()) {
    redirect("/login");
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
