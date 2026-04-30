"use server";

import { redirect } from "next/navigation";
import { auditNextBatch } from "@/lib/audit";
import { hasDashboardSession } from "@/lib/session";

export async function runAuditFromDashboard() {
  if (!hasDashboardSession()) {
    redirect("/login");
  }
  await auditNextBatch();
  redirect("/?audit=ran");
}
