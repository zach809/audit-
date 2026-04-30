"use server";

import { redirect } from "next/navigation";
import { auditNextBatch } from "@/lib/audit";
import { hasDashboardSession } from "@/lib/session";

export async function runAuditFromDashboard() {
  if (!hasDashboardSession()) {
    redirect("/login");
  }
  try {
    const result = await auditNextBatch();
    redirect(`/?audit=ran&message=${encodeURIComponent(result.message)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    redirect(`/?audit=failed&message=${encodeURIComponent(message.slice(0, 240))}`);
  }
}
