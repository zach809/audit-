import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { STANDARDS_SHEET_HEADERS } from "./dashboard-data";
import {
  activityCompletion,
  chicagoDateKey,
  collectArchiveRows,
  currentChicagoMonthRange,
  eachChicagoDateKey,
  excelSerialFromDateKey,
  formatSheetStamp,
  publishOwnerTab,
  rowsOnOrBeforeToday,
  sheetDateKey,
  shouldPublishPeriod,
  upsertDailyRows,
  type SheetDailyRow,
  type SheetValuesClient,
} from "./standards-sheet-sync";

const NOW = new Date("2026-08-15T14:15:00Z");
const STAMP = "Updated 2026-08-01 08:00 America/Chicago";
const period = { from: "8/1/2026", to: "8/15/2026" };

function daily(owner: string, date: string, sortDate: string, extras: Partial<SheetDailyRow> = {}): SheetDailyRow {
  return { owner, date, sortDate, newMatters: 0, attorneyCall: 0, welcome: 0, courtDate: 0, weeklyCheckIns: 0, completion: "No activity", ...extras };
}
function work(owner: string, date: string, sortDate: string, completion: string): SheetDailyRow {
  return daily(owner, date, sortDate, { newMatters: 1, attorneyCall: 1, welcome: 1, courtDate: 1, weeklyCheckIns: 0, completion });
}

function memorySheet(dailyRows: string[][] = []) {
  const grid: string[][] = [[STAMP], ...Array.from({ length: 11 }, () => []), [...STANDARDS_SHEET_HEADERS], ...dailyRows];
  const writes: string[] = [];
  const apply = (a1: string, values: Array<Array<string | number>>) => {
    const start = a1 === "A1" ? 0 : a1.startsWith("A14") ? 13 : 1;
    values.forEach((row, i) => {
      while (grid.length <= start + i) grid.push([]);
      row.forEach((cell, c) => { grid[start + i][c] = String(cell); });
    });
  };
  const client: SheetValuesClient & { grid: string[][]; writes: string[] } = {
    grid,
    writes,
    async getValues() { return grid; },
    async updateValues(_name, data) {
      for (const part of data) {
        writes.push(part.a1);
        apply(part.a1, part.values);
      }
    },
  };
  return client;
}

describe("standards sheet archive", () => {
  it("keeps a hand-written past date after a current-period sync", async () => {
    const sheet = memorySheet([["Svetlana", "7/1/2026", "12", "12", "12", "12", "4", "100%"]]);
    const result = await publishOwnerTab(sheet, { owner: "Svetlana", incoming: [work("Svetlana", "8/3/2026", "2026-08-03", "83%")], period, auditStatus: "completed", now: NOW });
    assert.deepEqual(result.dailyRows.map((row) => row.date), ["7/1/2026", "8/3/2026"]);
    assert.equal(sheet.grid[13][1], "7/1/2026");
    assert.equal(sheet.grid[13][7], "100%");
    assert.equal(sheet.grid[14][1], "8/3/2026");
  });

  it("upserts by date: replace in place, insert ascending, second sync does not duplicate", () => {
    const existing = [work("Ronald", "8/1/2026", "2026-08-01", "100%"), work("Ronald", "8/3/2026", "2026-08-03", "67%")];
    const first = upsertDailyRows(existing, [work("Ronald", "8/3/2026", "2026-08-03", "100%"), work("Ronald", "8/2/2026", "2026-08-02", "67%")]);
    const second = upsertDailyRows(first, [work("Ronald", "8/3/2026", "2026-08-03", "100%")]);
    assert.deepEqual(second.map((row) => `${row.sortDate}:${row.completion}`), ["2026-08-01:100%", "2026-08-02:67%", "2026-08-03:100%"]);
  });

  it("does not write or advance the stamp when Google auth fails", async () => {
    const sheet = memorySheet([["Alessandra", "7/15/2026", "3", "3", "3", "3", "1", "100%"]]);
    await assert.rejects(() => publishOwnerTab({
      async getValues() { throw new Error("Google token request failed: 401 invalid_grant"); },
      async updateValues() { throw new Error("should not write after auth failure"); },
    }, { owner: "Alessandra", incoming: [work("Alessandra", "8/3/2026", "2026-08-03", "100%")], period, auditStatus: "completed", now: NOW }), /401/);
    assert.equal(sheet.grid[0][0], STAMP);
    assert.equal(sheet.grid[13][1], "7/15/2026");
  });

  it("does not write a current-period row or stamp when the audit run did not complete", async () => {
    const sheet = memorySheet([["Camila", "8/1/2026", "2", "2", "2", "2", "0", "100%"]]);
    for (const status of [null, "running", "failed", "", "unknown"]) {
      assert.equal((await publishOwnerTab(sheet, { owner: "Camila", incoming: [work("Camila", "8/14/2026", "2026-08-14", "0%")], period, auditStatus: status, now: NOW })).wrote, false);
    }
    assert.equal(sheet.grid[0][0], STAMP);
    assert.equal(sheet.grid[13][1], "8/1/2026");
    assert.equal(sheet.writes.length, 0);
  });

  it("writes the stamp only after a successful data write", async () => {
    const sheet = memorySheet();
    await assert.rejects(() => publishOwnerTab({
      getValues: (name, a1) => sheet.getValues(name, a1),
      async updateValues(name, data) {
        if (data.some((part) => part.a1 === "A1")) throw new Error("stamp write failed");
        return sheet.updateValues(name, data);
      },
    }, { owner: "Lori", incoming: [work("Lori", "8/3/2026", "2026-08-03", "100%")], period, auditStatus: "completed", now: NOW }), /stamp write failed/);
    assert.equal(sheet.grid[0][0], STAMP);
  });

  it("uses No activity, never 0%, for idle case managers; scorecard and salvage use the shared module", async () => {
    assert.equal(activityCompletion({ newMatters: 0, attorneyCall: 0, welcome: 0, courtDate: 0, weeklyCheckIns: 0, completion: "0%" }), "No activity");
    assert.equal(activityCompletion({ newMatters: 2, attorneyCall: 0, welcome: 0, courtDate: 0, weeklyCheckIns: 0, completion: "0%" }), "0%");
    assert.equal(upsertDailyRows([], [daily("Ivan", "8/3/2026", "2026-08-03", { completion: "0%" })]).length, 0);
    assert.equal(shouldPublishPeriod("completed"), true);
    assert.equal(shouldPublishPeriod("failed"), false);
    assert.deepEqual(collectArchiveRows([[...STANDARDS_SHEET_HEADERS], ["Nathaly", "6/2/2026", "4", "4", "4", "4", "1", "100%"]], "Nathaly").map((row) => row.date), ["6/2/2026"]);
    const sheet = memorySheet();
    const result = await publishOwnerTab(sheet, { owner: "Ivan", incoming: [], period, auditStatus: "completed", now: NOW });
    assert.equal(sheet.grid[3][1], "No activity");
    assert.deepEqual(sheet.grid[12], [...STANDARDS_SHEET_HEADERS]);
    assert.equal(result.stamp, formatSheetStamp(NOW));
    assert.ok(sheet.writes.indexOf("A1") > 0);
  });
});

describe("sheet dates and Chicago period", () => {
  it("reads Excel serials as real dates and converts date keys back to serials", () => {
    assert.equal(sheetDateKey("46237"), "2026-08-03");
    assert.equal(sheetDateKey(46238), "2026-08-04");
    assert.equal(sheetDateKey("8/3/2026"), "2026-08-03");
    assert.equal(excelSerialFromDateKey("2026-08-03"), 46237);
    assert.equal(excelSerialFromDateKey("8/21/2026"), 46255);
    assert.deepEqual(collectArchiveRows([["Lori", 46237, 1, 1, 1, 1, 0, "100%"]], "Lori").map((row) => row.sortDate), ["2026-08-03"]);
  });

  it("drops dates after today in America/Chicago and keeps today", () => {
    const now = new Date("2026-08-15T16:00:00Z");
    assert.equal(chicagoDateKey(now), "2026-08-15");
    const kept = rowsOnOrBeforeToday([
      daily("Lori", "8/15/2026", "2026-08-15"),
      daily("Lori", "8/16/2026", "2026-08-16"),
      daily("Lori", "8/21/2026", "2026-08-21"),
      daily("Lori", "46262", "46262"),
    ], now);
    assert.deepEqual(kept.map((row) => row.sortDate), ["2026-08-15"]);
  });

  it("defaults the Excel period to the current Chicago month through today", () => {
    const range = currentChicagoMonthRange(new Date("2026-08-15T16:00:00Z"));
    assert.deepEqual(range, { from: "2026-08-01", to: "2026-08-15" });
  });

  it("walks every day of a range inclusively, and neither drops nor doubles a day across DST", () => {
    assert.deepEqual(eachChicagoDateKey("2026-08-01", "2026-08-04"), ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]);
    assert.deepEqual(eachChicagoDateKey("2026-08-31", "2026-08-31"), ["2026-08-31"]);
    assert.deepEqual(eachChicagoDateKey("2026-08-04", "2026-08-01"), []);
    assert.equal(eachChicagoDateKey("2026-03-01", "2026-03-31").length, 31);
    assert.deepEqual(eachChicagoDateKey("2026-03-07", "2026-03-09"), ["2026-03-07", "2026-03-08", "2026-03-09"]);
    assert.equal(eachChicagoDateKey("2026-11-01", "2026-11-30").length, 30);
    assert.deepEqual(eachChicagoDateKey("2026-10-31", "2026-11-02"), ["2026-10-31", "2026-11-01", "2026-11-02"]);
    assert.equal(new Set(eachChicagoDateKey("2026-01-01", "2026-12-31")).size, 365);
  });
});

describe("google-sheets clear API", () => {
  it("has no batchClear / values.clear path left in the live writer", () => {
    const source = readFileSync(fileURLToPath(new URL("./google-sheets.ts", import.meta.url)), "utf8");
    assert.doesNotMatch(source, /batchClear|values:clear|:clear/);
  });
});
