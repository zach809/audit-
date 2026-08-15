import type { DashboardFilters } from "./dashboard-data";
import { googleSheetsConfigured, syncStandardsToGoogleSheets } from "./google-sheets";
import { microsoftExcelConfigured, syncStandardsToMicrosoftExcel } from "./microsoft-excel";
import { shouldPublishPeriod } from "./standards-sheet-sync";

export type StandardsPublishResult = {
  google: "synced" | "skipped" | "failed";
  excel: "synced" | "skipped" | "failed";
};

type PublishDeps = {
  googleConfigured?: () => boolean;
  excelConfigured?: () => boolean;
  syncGoogle?: (filters?: DashboardFilters) => Promise<unknown>;
  syncExcel?: (filters?: DashboardFilters) => Promise<unknown>;
  logError?: (message: string, error: unknown) => void;
};

function chicagoYmd(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(date);
}

function currentMonthRange(): DashboardFilters {
  const to = chicagoYmd(new Date());
  const monthStart = new Date(`${to}T12:00:00`);
  monthStart.setDate(1);
  return { from: chicagoYmd(monthStart), to };
}

export async function publishConfiguredStandardsSheets(deps: PublishDeps = {}): Promise<StandardsPublishResult> {
  const googleOn = deps.googleConfigured ?? googleSheetsConfigured;
  const excelOn = deps.excelConfigured ?? microsoftExcelConfigured;
  const syncGoogle = deps.syncGoogle ?? syncStandardsToGoogleSheets;
  const syncExcel = deps.syncExcel ?? syncStandardsToMicrosoftExcel;
  const logError = deps.logError ?? ((message, error) => console.error(message, error));
  const result: StandardsPublishResult = { google: "skipped", excel: "skipped" };

  if (googleOn()) {
    try {
      await syncGoogle(currentMonthRange());
      result.google = "synced";
    } catch (error) {
      result.google = "failed";
      logError("[standards-publish] Google Sheets sync failed", error);
    }
  }

  if (excelOn()) {
    try {
      await syncExcel();
      result.excel = "synced";
    } catch (error) {
      result.excel = "failed";
      logError("[standards-publish] Excel sync failed", error);
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
