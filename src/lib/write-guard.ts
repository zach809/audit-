import { NextResponse } from "next/server";
import { optionalEnv } from "./config";

// Preview has its own Neon branch and, since #42, its own Excel workbook. Neither is what this
// protects. The Google Sheet and the Clio OAuth connection carry no environment scoping at all.
export const WRITE_BLOCKED_MESSAGE =
  "Write blocked: only production runs write operations. This deployment has its own database branch and its own Excel workbook, but the Google Sheet and the Clio connection are production's.";

export function writesAllowed(): boolean {
  const vercelEnv = optionalEnv("VERCEL_ENV");
  if (vercelEnv === "production") return true;
  return vercelEnv === "" && /^(1|true)$/i.test(optionalEnv("CWCA_ALLOW_WRITES"));
}

export function rejectNonProductionWrite(): NextResponse | null {
  if (writesAllowed()) return null;
  return NextResponse.json({ error: WRITE_BLOCKED_MESSAGE }, { status: 403 });
}

export function previewExcelSyncAllowed(): boolean {
  return optionalEnv("VERCEL_ENV") === "preview" && /^(1|true)$/i.test(optionalEnv("CWCA_ALLOW_PREVIEW_EXCEL_SYNC"));
}

export function rejectNonProductionExcelSync(): NextResponse | null {
  if (previewExcelSyncAllowed()) return null;
  return rejectNonProductionWrite();
}
