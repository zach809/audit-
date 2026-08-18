import { optionalEnv } from "./config";
import type { DashboardFilters } from "./dashboard-data";
import { microsoftExcelConfigured, syncStandardsToMicrosoftExcel } from "./microsoft-excel";
import { currentChicagoMonthRange, shouldPublishPeriod } from "./standards-sheet-sync";

export type StandardsPublishResult = {
  google: "synced" | "skipped" | "failed";
  excel: "synced" | "skipped" | "failed";
};

type PublishDeps = {
  googleConfigured?: () => boolean;
  excelConfigured?: () => boolean;
  syncGoogle?: (filters?: DashboardFilters) => Promise<unknown>;
  syncExcel?: (filters?: DashboardFilters) => Promise<unknown>;
  workbookTarget?: () => string;
  logError?: (message: string, error: unknown) => void;
};

function excelWorkbookTarget(): string {
  return (
    optionalEnv("MICROSOFT_EXCEL_WORKBOOK_ITEM_ID").trim() ||
    optionalEnv("MICROSOFT_EXCEL_WORKBOOK_SHARE_URL").trim() ||
    optionalEnv("MICROSOFT_EXCEL_WORKBOOK_PATH").trim() ||
    "unspecified"
  );
}

export async function publishConfiguredStandardsSheets(deps: PublishDeps = {}): Promise<StandardsPublishResult> {
  const excelOn = deps.excelConfigured ?? microsoftExcelConfigured;
  const syncExcel = deps.syncExcel ?? syncStandardsToMicrosoftExcel;
  const workbookTarget = deps.workbookTarget ?? excelWorkbookTarget;
  const logError = deps.logError ?? ((message, error) => console.error(message, error));
  const result: StandardsPublishResult = { google: "skipped", excel: "skipped" };

  // On-change publishing is Excel Online only. The weekday cron still owns the other workbook.

  if (excelOn()) {
    try {
      await syncExcel(currentChicagoMonthRange());
      result.excel = "synced";
    } catch (error) {
      result.excel = "failed";
      logError(
        `[standards-publish] Excel Online sync failed for workbook ${workbookTarget()}`,
        error,
      );
    }
  }

  return result;
}

let pending: Promise<StandardsPublishResult> | null = null;

export function scheduleStandardsPublish(
  opts?: { auditStatus?: string | null },
  deps?: PublishDeps,
): Promise<StandardsPublishResult> {
  if (opts && "auditStatus" in opts && !shouldPublishPeriod(opts.auditStatus)) {
    return Promise.resolve({ google: "skipped", excel: "skipped" });
  }
  if (!pending) {
    pending = Promise.resolve()
      .then(() => publishConfiguredStandardsSheets(deps))
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}
