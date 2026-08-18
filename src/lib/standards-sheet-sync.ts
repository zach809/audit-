import { STANDARDS_SHEET_HEADERS } from "./dashboard-data";
import { buildStandardsScorecard, type StandardsScorecard } from "./standards-scorecard";

export const DAILY_HEADER_ROW = 13;
export const DAILY_FIRST_ROW = 14;

export type SheetDailyRow = {
  owner: string;
  date: string;
  sortDate: string;
  newMatters: number;
  attorneyCall: number;
  welcome: number;
  courtDate: number;
  weeklyCheckIns: number;
  completion: string;
};

export type SheetValuesClient = {
  getValues(sheetName: string, a1: string): Promise<string[][]>;
  updateValues(sheetName: string, data: Array<{ a1: string; values: Array<Array<string | number>> }>): Promise<void>;
};

type Countable = { newMatters: number; attorneyCall: number; welcome: number; courtDate: number; weeklyCheckIns: number; completion?: string };

export function shouldPublishPeriod(auditStatus: string | null | undefined): boolean {
  return String(auditStatus ?? "").trim().toLowerCase() === "completed";
}

export function formatSheetStamp(now: Date, timeZone = "America/Chicago"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `Updated ${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${timeZone}`;
}

export function chicagoDateKey(date: Date, timeZone = "America/Chicago"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function currentChicagoMonthRange(now = new Date()): { from: string; to: string } {
  const today = chicagoDateKey(now);
  const monthStart = new Date(`${today}T12:00:00`);
  monthStart.setDate(1);
  return { from: chicagoDateKey(monthStart), to: today };
}

const EXCEL_SERIAL_EPOCH_UTC = Date.UTC(1899, 11, 30);

export function dateKeyFromExcelSerial(serial: number): string {
  const whole = Math.trunc(Number(serial));
  if (!Number.isFinite(whole) || whole < 20000 || whole > 80000) return "";
  const utc = new Date(EXCEL_SERIAL_EPOCH_UTC + whole * 86400000);
  const year = utc.getUTCFullYear();
  const month = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const day = String(utc.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function excelSerialFromDateKey(value: string | number): number {
  const key = sheetDateKey(value);
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Math.round((utc - EXCEL_SERIAL_EPOCH_UTC) / 86400000);
}

export function sheetDateKey(value: string | number): string {
  const trimmed = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return dateKeyFromExcelSerial(Number(trimmed));
  return "";
}

export function rowsOnOrBeforeToday<T extends { date: string; sortDate: string }>(rows: T[], now = new Date()): T[] {
  const today = chicagoDateKey(now);
  return rows.filter((row) => {
    const key = sheetDateKey(row.sortDate || row.date);
    return Boolean(key) && key <= today;
  });
}

export function activityCompletion(row: Countable): string {
  const active = row.newMatters > 0 || row.weeklyCheckIns > 0 || row.attorneyCall > 0 || row.welcome > 0 || row.courtDate > 0;
  return active ? row.completion || "0%" : "No activity";
}

function scorecardBlock(card: StandardsScorecard): Array<Array<string | number>> {
  const [phone, welcome, court, weekly] = card.coreStandards;
  const blank = ["", "", "", "", "", "", "", ""] as Array<string | number>;
  return [
    ["Case Manager", card.owner, "Period", card.periodLabel, "Target", card.targetLabel, "Verdict", card.verdict],
    ["Overall compliance", card.overallCompliance, "Targets met", card.targetsMet, "Cases handled", card.casesHandled, "Follow-up items", card.followUpItems],
    ["Standard", "Actual", "Required", "Status", "", "", "", ""],
    [phone.name, phone.actual, phone.required, phone.status, "", "", "", ""],
    [welcome.name, welcome.actual, welcome.required, welcome.status, "", "", "", ""],
    [court.name, court.actual, court.required, court.status, "", "", "", ""],
    [weekly.name, weekly.actual, weekly.required, weekly.status, "", "", "", ""],
    ["Weekly check-ins", card.weeklyCheckIns, "", "", "", "", "", ""],
    blank,
  ];
}

function asNumber(value: string | number | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function collectArchiveRows(grid: Array<Array<string | number | undefined>>, owner: string): SheetDailyRow[] {
  const found: SheetDailyRow[] = [];
  for (const row of grid) {
    const name = String(row?.[0] ?? "").trim();
    const date = String(row?.[1] ?? "").trim();
    const sortDate = sheetDateKey(date);
    if (!name || name !== owner || !sortDate) continue;
    found.push({
      owner: name,
      date,
      sortDate,
      newMatters: asNumber(row[2]),
      attorneyCall: asNumber(row[3]),
      welcome: asNumber(row[4]),
      courtDate: asNumber(row[5]),
      weeklyCheckIns: asNumber(row[6]),
      completion: String(row[7] ?? ""),
    });
  }
  return found;
}

export function upsertDailyRows(existing: SheetDailyRow[], incoming: SheetDailyRow[]): SheetDailyRow[] {
  const byDate = new Map<string, SheetDailyRow>();
  for (const row of existing) {
    const key = sheetDateKey(row.sortDate || row.date) || row.sortDate;
    if (key) byDate.set(key, { ...row, sortDate: key });
  }
  for (const row of incoming) {
    const key = sheetDateKey(row.sortDate || row.date);
    const completion = activityCompletion(row);
    if (!key || completion === "No activity") continue;
    byDate.set(key, { ...row, sortDate: key, completion });
  }
  return Array.from(byDate.values()).sort((a, b) => a.sortDate.localeCompare(b.sortDate));
}

function dailyRowValues(row: SheetDailyRow): Array<string | number> {
  return [row.owner, row.date, row.newMatters, row.attorneyCall, row.welcome, row.courtDate, row.weeklyCheckIns, row.completion];
}

function countDailyRowsFrom(grid: Array<Array<string | number | undefined>>, owner: string, start: number): number {
  let count = 0;
  for (let i = start; i < grid.length; i += 1) {
    const row = grid[i] ?? [];
    const name = String(row[0] ?? "").trim();
    if (sheetDateKey(String(row[1] ?? "")) && name === owner) {
      count += 1;
      continue;
    }
    if (name || String(row[1] ?? "").trim()) break;
  }
  return count;
}

export async function publishOwnerTab(
  client: SheetValuesClient,
  input: {
    owner: string;
    incoming: SheetDailyRow[];
    period: { from: string; to: string };
    auditStatus: string | null | undefined;
    now: Date;
  },
): Promise<{ wrote: boolean; skipped?: string; dailyRows: SheetDailyRow[]; stamp: string }> {
  if (!shouldPublishPeriod(input.auditStatus)) {
    return { wrote: false, skipped: "incomplete-audit", dailyRows: [], stamp: "" };
  }
  const grid = await client.getValues(input.owner, "A1:H");
  const incoming = input.incoming.map((row) => ({ ...row, completion: activityCompletion(row) }));
  const merged = upsertDailyRows(collectArchiveRows(grid, input.owner), incoming);
  const dailyValues = merged.map(dailyRowValues);
  const previousDailyCount = countDailyRowsFrom(grid, input.owner, DAILY_FIRST_ROW - 1);
  while (dailyValues.length < previousDailyCount) dailyValues.push(["", "", "", "", "", "", "", ""]);
  const dataWrites: Array<{ a1: string; values: Array<Array<string | number>> }> = [{
    a1: "A2:H13",
    values: [
      ["", "", "", "", "", "", "", ""],
      ...scorecardBlock(buildStandardsScorecard(input.owner, incoming, input.period)),
      ["", "", "", "", "", "", "", ""],
      [...STANDARDS_SHEET_HEADERS],
    ],
  }];
  if (dailyValues.length) dataWrites.push({ a1: `A14:H${DAILY_HEADER_ROW + dailyValues.length}`, values: dailyValues });
  await client.updateValues(input.owner, dataWrites);
  const stamp = formatSheetStamp(input.now);
  await client.updateValues(input.owner, [{ a1: "A1", values: [[stamp]] }]);
  return { wrote: true, dailyRows: merged, stamp };
}
