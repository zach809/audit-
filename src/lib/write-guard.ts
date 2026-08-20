import { NextResponse } from "next/server";
import { optionalEnv } from "./config";

export const WRITE_BLOCKED_MESSAGE =
  "Write blocked: this is a preview deployment pointed at the production database.";

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
