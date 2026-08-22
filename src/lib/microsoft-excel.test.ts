import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { STANDARDS_SHEET_HEADERS } from "./dashboard-data";
import * as excel from "./microsoft-excel";
import { excelSerialFromDateKey, type SheetDailyRow } from "./standards-sheet-sync";

const ENV_KEYS = [
  "VERCEL_ENV",
  "MICROSOFT_TENANT_ID",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_EXCEL_USER_ID",
  "MICROSOFT_EXCEL_WORKBOOK_PATH",
  "MICROSOFT_EXCEL_TEMPLATE_PATH",
  "MICROSOFT_EXCEL_WORKBOOK_WEB_URL",
  "MICROSOFT_EXCEL_WORKBOOK_PATH_PREVIEW",
  "MICROSOFT_EXCEL_WORKBOOK_WEB_URL_PREVIEW",
  "MICROSOFT_EXCEL_REFRESH_TOKEN",
] as const;

const savedEnv: Record<string, string | undefined> = {};
let originalFetch: typeof fetch;

before(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  originalFetch = globalThis.fetch;
});

after(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function setExcelEnv(values: Record<string, string>) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, {
    MICROSOFT_TENANT_ID: "tenant-1",
    MICROSOFT_CLIENT_ID: "client-1",
    MICROSOFT_EXCEL_USER_ID: "zach@hirschlawgroup.com",
    MICROSOFT_EXCEL_WORKBOOK_PATH: "CWCA/Standards {month}.xlsx",
    MICROSOFT_EXCEL_TEMPLATE_PATH: "CWCA/Standards Template.xlsx",
    ...values,
  });
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function captureTokenPosts() {
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    calls.push({ url, body });
    if (url.includes("graph.microsoft.com")) return jsonResponse(200, { id: "workbook-should-not-be-touched" });
    if (body.includes("grant_type=refresh_token") && !body.includes("client_secret")) {
      return jsonResponse(200, { access_token: "delegated-access-token" });
    }
    if (body.includes("grant_type=client_credentials") && body.includes("client_secret=real-app-secret")) {
      return jsonResponse(200, { access_token: "application-access-token" });
    }
    return jsonResponse(401, { error: "invalid_client", error_description: "Secret was sent or grant was wrong." });
  }) as typeof fetch;
  return calls;
}

describe("Microsoft Excel auth", () => {
  it("uses delegated refresh when a refresh token is set, even with a wrong client secret", async () => {
    setExcelEnv({
      MICROSOFT_CLIENT_SECRET: "deliberately-wrong-secret",
      MICROSOFT_EXCEL_REFRESH_TOKEN: "refresh-token-live-value",
    });
    const calls = captureTokenPosts();
    assert.equal(excel.excelAuthDisclosure().authMode, "delegated");
    assert.equal(excel.excelAuthDisclosure().authAccount, "zach@hirschlawgroup.com");
    assert.equal(excel.microsoftExcelConfigured(), true);
    assert.equal(await excel.requestMicrosoftExcelAccessToken(), "delegated-access-token");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /login\.microsoftonline\.com\/tenant-1\/oauth2\/v2\.0\/token/);
    assert.match(calls[0].body, /grant_type=refresh_token/);
    assert.match(calls[0].body, /Files\.ReadWrite/);
    assert.match(calls[0].body, /offline_access/);
    assert.doesNotMatch(calls[0].body, /Files\.ReadWrite\.All/);
    assert.doesNotMatch(calls[0].body, /client_secret/);
    assert.doesNotMatch(calls[0].body, /deliberately-wrong-secret/);
    assert.doesNotMatch(calls[0].body, /grant_type=client_credentials/);
  });

  it("is configured for delegated auth without a client secret, and not for application auth without one", () => {
    setExcelEnv({ MICROSOFT_EXCEL_REFRESH_TOKEN: "refresh-token-live-value" });
    assert.equal(excel.microsoftExcelConfigured(), true);
    setExcelEnv({});
    assert.equal(excel.excelAuthDisclosure().authMode, "application");
    assert.equal(excel.microsoftExcelConfigured(), false);
  });

  it("keeps the existing client-credentials grant when no refresh token is set", async () => {
    setExcelEnv({ MICROSOFT_CLIENT_SECRET: "real-app-secret" });
    const calls = captureTokenPosts();
    assert.equal(excel.excelAuthDisclosure().authMode, "application");
    assert.equal(excel.excelAuthDisclosure().authAccount, "application");
    assert.equal(excel.microsoftExcelConfigured(), true);
    assert.equal(await excel.requestMicrosoftExcelAccessToken(), "application-access-token");
    assert.equal(calls.length, 1);
    assert.match(calls[0].body, /grant_type=client_credentials/);
    assert.match(calls[0].body, /client_secret=real-app-secret/);
    assert.match(calls[0].body, /graph\.microsoft\.com%2F\.default/);
    assert.doesNotMatch(calls[0].body, /refresh_token/);
    assert.doesNotMatch(calls[0].body, /Files\.ReadWrite/);
  });

  it("fails with MicrosoftInvalidGrantError when the refresh token is rejected, without calling Graph or falling back", async () => {
    setExcelEnv({
      MICROSOFT_CLIENT_SECRET: "deliberately-wrong-secret",
      MICROSOFT_EXCEL_REFRESH_TOKEN: "refresh-token-live-value",
    });
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = String(init?.body ?? "");
      calls.push(url);
      if (body.includes("grant_type=client_credentials")) return jsonResponse(200, { access_token: "must-not-be-used" });
      if (url.includes("login.microsoftonline.com")) {
        return jsonResponse(400, {
          error: "invalid_grant",
          error_description: "AADSTS70000: The refresh token has expired or was revoked. refresh_token=should-never-leak",
        });
      }
      return jsonResponse(200, { id: "workbook-should-not-be-touched" });
    }) as typeof fetch;

    await assert.rejects(
      () => excel.requestMicrosoftExcelAccessToken(),
      (error: unknown) => {
        assert.ok(error instanceof excel.MicrosoftInvalidGrantError);
        assert.equal(error.name, "MicrosoftInvalidGrantError");
        assert.equal(error.code, "invalid_grant");
        assert.match(error.message, /invalid_grant/);
        assert.match(error.message, /re-issued|revoked|expired/i);
        assert.doesNotMatch(error.message, /should-never-leak|refresh-token-live-value|deliberately-wrong-secret/);
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.match(calls[0], /login\.microsoftonline\.com/);
    assert.ok(!calls.some((url) => url.includes("graph.microsoft.com")));
  });

  it("redacts secrets in form/JSON text and in token error messages", async () => {
    const leaked = [
      "client_secret=super-secret-value",
      "refresh_token=refresh-token-live-value",
      "access_token=access-token-live-value",
      '{"client_secret":"json-secret","refresh_token":"json-refresh","access_token":"json-access"}',
    ].join(" ");
    const redacted = excel.redactMicrosoftSecrets(leaked);
    assert.match(redacted, /client_secret=\[REDACTED\]/);
    assert.match(redacted, /refresh_token=\[REDACTED\]/);
    assert.match(redacted, /access_token=\[REDACTED\]/);
    assert.doesNotMatch(redacted, /super-secret-value|refresh-token-live-value|access-token-live-value|json-secret|json-refresh|json-access/);

    setExcelEnv({ MICROSOFT_CLIENT_SECRET: "real-app-secret" });
    globalThis.fetch = (async () =>
      new Response("invalid_client client_secret=real-app-secret refresh_token=nope access_token=leak", { status: 401 })) as typeof fetch;
    await assert.rejects(
      () => excel.requestMicrosoftExcelAccessToken(),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /real-app-secret|nope|leak/);
        assert.match(error.message, /\[REDACTED\]/);
        return true;
      },
    );
  });
});

const NOW = new Date("2026-08-15T16:00:00Z");
const MONITOR_URL = "https://hirschlawgroup.sharepoint.com/_api/v2.0/monitor/copy-1";
const TEMPLATE_COPY = "/users/zach%40hirschlawgroup.com/drive/root:/CWCA/Standards%20Template.xlsx:/copy?@microsoft.graph.conflictBehavior=fail";
const DATA_RANGE = "/users/zach%40hirschlawgroup.com/drive/root:/CWCA/Standards%202026-08.xlsx:/workbook/worksheets('Data')/range(address='A1:J311')";
const PROBE_SELECT = "?$select=id,name,file,size,remoteItem";

type GraphCall = { method: string; url: string; body: string; authorization: string };

function daily(owner: string, sortDate: string, extras: Partial<SheetDailyRow> = {}): SheetDailyRow {
  const [year, month, day] = sortDate.split("-");
  return {
    owner,
    date: `${Number(month)}/${Number(day)}/${year}`,
    sortDate,
    newMatters: 0,
    attorneyCall: 0,
    welcome: 0,
    courtDate: 0,
    weeklyCheckIns: 0,
    completion: "0%",
    ...extras,
  };
}

function rowsFrom(rows: SheetDailyRow[]) {
  return async () => rows;
}

function acceptedCopy() {
  return new Response(null, { status: 202, headers: { location: MONITOR_URL } });
}

function completedCopy() {
  return jsonResponse(200, { status: "completed", resourceId: "item-1" });
}

function nameTakenCopy() {
  return jsonResponse(200, {
    status: "failed",
    error: { code: "generalException", message: "copy failed", details: [{ code: "nameAlreadyExists" }] },
  });
}

function nestedNameTakenCopy() {
  return jsonResponse(200, {
    status: "failed",
    error: { code: "generalException", message: "copy failed", innerError: { code: "nameAlreadyExists" } },
  });
}

function genericFailedCopy() {
  return jsonResponse(200, { status: "failed", error: { code: "generalException", message: "copy failed" } });
}

/** What the live preview sync got on 2026-08-22, once the month workbook already existed. */
function generalExceptionCopy() {
  return jsonResponse(500, {
    error: {
      code: "generalException",
      message: "General exception while processing",
      innerError: { date: "2026-08-22T22:14:19", "request-id": "feda9901-0000-0000-0000-000000000000" },
    },
  });
}

function workbookFound() {
  return jsonResponse(200, { id: "item-1", name: "Standards 2026-08.xlsx", size: 48231, file: { mimeType: "application/vnd.ms-excel" } });
}

function workbookAbsent() {
  return jsonResponse(404, { error: { code: "itemNotFound" } });
}

function installGraphDouble(
  plan: {
    copy?: (attempt: number) => Response;
    monitor?: (attempt: number) => Response;
    probe?: (attempt: number) => Response;
    write?: (attempt: number) => Response;
  } = {},
) {
  const calls: GraphCall[] = [];
  const copy: (attempt: number) => Response = plan.copy ?? (() => acceptedCopy());
  const monitor: (attempt: number) => Response = plan.monitor ?? (() => completedCopy());
  const probe: (attempt: number) => Response = plan.probe ?? (() => workbookFound());
  const write: (attempt: number) => Response = plan.write ?? (() => jsonResponse(200, {}));
  let copyAttempts = 0;
  let monitorAttempts = 0;
  let probeAttempts = 0;
  let writeAttempts = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers ?? {});
    const call: GraphCall = {
      method: String(init?.method ?? "GET").toUpperCase(),
      url,
      body: String(init?.body ?? ""),
      authorization: headers.get("authorization") ?? "",
    };
    calls.push(call);
    if (url.startsWith("https://login.microsoftonline.com/")) return jsonResponse(200, { access_token: "delegated-access-token" });
    if (url === MONITOR_URL) {
      monitorAttempts += 1;
      return monitor(monitorAttempts);
    }
    if (url.includes("/copy?")) {
      copyAttempts += 1;
      return copy(copyAttempts);
    }
    if (url.includes(PROBE_SELECT)) {
      probeAttempts += 1;
      return probe(probeAttempts);
    }
    if (call.method === "PATCH" && url.includes("/workbook/")) {
      writeAttempts += 1;
      return write(writeAttempts);
    }
    return assert.fail(`the Excel sync made an unexpected request: ${call.method} ${url}`);
  }) as typeof fetch;
  return calls;
}

function graphWrites(calls: GraphCall[]) {
  return calls.filter((call) => call.method !== "GET" && call.url.includes("graph.microsoft.com"));
}

function patchBodies(calls: GraphCall[]) {
  return calls.filter((call) => call.method === "PATCH").map((call) => call.body);
}

function probeCalls(calls: GraphCall[]) {
  return calls.filter((call) => call.url.includes(PROBE_SELECT));
}

function copyCalls(calls: GraphCall[]) {
  return calls.filter((call) => call.url.includes("/copy?"));
}

function delegatedEnv() {
  setExcelEnv({ MICROSOFT_EXCEL_REFRESH_TOKEN: "refresh-token-live-value" });
}

describe("Microsoft Excel month book", () => {
  it("writes the Data worksheet and never addresses any other worksheet", async () => {
    delegatedEnv();
    const calls = installGraphDouble();
    const result = await excel.syncStandardsToMicrosoftExcel(
      {},
      { now: NOW, reportRows: rowsFrom([daily("Lori", "2026-08-03", { newMatters: 2, completion: "100%" })]) },
    );

    for (const write of graphWrites(calls)) {
      assert.ok(
        write.url.endsWith(TEMPLATE_COPY) || write.url.endsWith(DATA_RANGE),
        `the sync wrote outside the Data worksheet: ${write.method} ${write.url}`,
      );
    }
    const bodies = patchBodies(calls);
    assert.equal(bodies.length, 1);
    const patched = JSON.parse(bodies[0]) as { values: Array<Array<string | number>>; numberFormat: string[][] };
    assert.deepEqual(patched.values[0].slice(0, STANDARDS_SHEET_HEADERS.length), STANDARDS_SHEET_HEADERS);
    assert.match(String(patched.values[0][9]), /^Updated 2026-08-15 \d\d:\d\d America\/Chicago$/);
    assert.equal(patched.values.length, 311);
    assert.ok(patched.values.every((row) => row.length === 10));
    assert.equal(patched.numberFormat.length, patched.values.length);
    assert.equal(typeof patched.values[1][1], "number");
    assert.equal(patched.numberFormat[1][1], "yyyy-mm-dd");
    assert.equal(patched.numberFormat[1][0], "General");
    assert.equal(result.workbookPath, "CWCA/Standards 2026-08.xlsx");
    assert.equal(result.month, "2026-08");
    assert.equal(result.rowsSynced, 150);
    const monitorCalls = calls.filter((call) => call.url === MONITOR_URL);
    assert.ok(monitorCalls.length >= 1, "the sync never polled the copy monitor");
    assert.equal(monitorCalls.every((call) => call.authorization === ""), true);
  });

  it("creates one workbook for the month however the name conflict comes back", async () => {
    delegatedEnv();
    const calls = installGraphDouble({
      copy: (attempt) => (attempt === 2 ? jsonResponse(409, { error: { code: "nameAlreadyExists" } }) : acceptedCopy()),
      monitor: (attempt) => (attempt === 1 ? completedCopy() : nameTakenCopy()),
    });
    const runs = [];
    for (let run = 0; run < 3; run += 1) {
      runs.push(await excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) }));
    }

    assert.deepEqual(runs.map((run) => run.workbookCreated), [true, false, false]);
    assert.equal(new Set(runs.map((run) => run.workbookPath)).size, 1);
    const copies = calls.filter((call) => call.url.includes("/copy?"));
    assert.equal(copies.length, 3);
    assert.ok(copies.every((call) => call.body === JSON.stringify({ name: "Standards 2026-08.xlsx" })));
    assert.equal(patchBodies(calls).length, 3);
    assert.ok(!calls.some((call) => /conflictBehavior=(rename|replace)/.test(call.url)));
    assert.equal(probeCalls(calls).length, 1, "the 409 run has to confirm the workbook, because 409 alone does not name it");
  });

  it("keeps syncing when the copy is refused with a 500 and the month workbook is already there", async () => {
    delegatedEnv();
    const calls = installGraphDouble({ copy: () => generalExceptionCopy(), probe: () => workbookFound() });
    const result = await excel.syncStandardsToMicrosoftExcel(
      {},
      { now: NOW, reportRows: rowsFrom([daily("Lori", "2026-08-03", { newMatters: 2, completion: "100%" })]) },
    );

    assert.equal(result.workbookCreated, false);
    assert.equal(result.workbookPath, "CWCA/Standards 2026-08.xlsx");
    assert.equal(patchBodies(calls).length, 1);
    assert.equal(copyCalls(calls).length, 1, "a second copy would give the month a second workbook");
    assert.equal(probeCalls(calls).length, 1);
    assert.ok(probeCalls(calls).every((call) => call.method === "GET"));
    assert.ok(
      probeCalls(calls).every((call) => call.url.endsWith(`Standards%202026-08.xlsx${PROBE_SELECT}`)),
      "the probe has to address the item itself: a trailing colon there is the relationship form, which Graph does not document before a query",
    );
  });

  it("keeps syncing when the copy monitor reports a failure it cannot name and the workbook is already there", async () => {
    delegatedEnv();
    const calls = installGraphDouble({ monitor: () => genericFailedCopy(), probe: () => workbookFound() });
    const result = await excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) });

    assert.equal(result.workbookCreated, false);
    assert.equal(patchBodies(calls).length, 1);
    assert.equal(copyCalls(calls).length, 1, "a second copy would give the month a second workbook");
    assert.equal(probeCalls(calls).length, 1);
  });

  it("reads a name conflict Graph nested in innerError without asking the drive at all", async () => {
    delegatedEnv();
    const calls = installGraphDouble({ monitor: () => nestedNameTakenCopy() });
    const result = await excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) });

    assert.equal(result.workbookCreated, false);
    assert.equal(patchBodies(calls).length, 1);
    assert.equal(probeCalls(calls).length, 0);
  });

  it("still fails loudly, and writes nothing, when the copy is refused and the workbook really is absent", async () => {
    delegatedEnv();
    const calls = installGraphDouble({ copy: () => generalExceptionCopy(), probe: () => workbookAbsent() });
    await assert.rejects(
      () => excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) }),
      (error: unknown) => {
        assert.ok(error instanceof excel.ExcelWorkbookCopyError);
        assert.match(error.message, /Graph answered 500/);
        assert.match(error.message, /Nothing was written/);
        return true;
      },
    );
    assert.equal(patchBodies(calls).length, 0);
    assert.equal(probeCalls(calls).length, 1);
  });

  it("fails loudly rather than guessing when the probe itself cannot settle whether the workbook exists", async () => {
    delegatedEnv();
    const calls = installGraphDouble({
      copy: () => generalExceptionCopy(),
      probe: () => jsonResponse(503, { error: { code: "serviceNotAvailable" } }),
    });
    await assert.rejects(
      () => excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) }),
      (error: unknown) => {
        assert.ok(error instanceof excel.ExcelWorkbookCopyError);
        assert.match(error.message, /Graph answered 500/);
        return true;
      },
    );
    assert.equal(patchBodies(calls).length, 0);
  });

  it("fails loudly when the probe answers with something that is not a file", async () => {
    delegatedEnv();
    const calls = installGraphDouble({
      copy: () => generalExceptionCopy(),
      probe: () => jsonResponse(200, { id: "item-1", name: "Standards 2026-08.xlsx", folder: { childCount: 0 } }),
    });
    await assert.rejects(
      () => excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) }),
      (error: unknown) => {
        assert.ok(error instanceof excel.ExcelWorkbookCopyError);
        assert.match(error.message, /Graph answered 500/, "the original failure has to survive the probe");
        return true;
      },
    );
    assert.equal(patchBodies(calls).length, 0);
  });

  it("refuses to write through a shortcut that points at another drive's file", async () => {
    delegatedEnv();
    const calls = installGraphDouble({
      copy: () => generalExceptionCopy(),
      probe: () =>
        jsonResponse(200, {
          id: "item-1",
          name: "Standards 2026-08.xlsx",
          size: 48231,
          file: { mimeType: "application/vnd.ms-excel" },
          remoteItem: { id: "somewhere-else", driveId: "another-drive" },
        }),
    });
    await assert.rejects(
      () => excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) }),
      (error: unknown) => {
        assert.ok(error instanceof excel.ExcelWorkbookCopyError);
        return true;
      },
    );
    assert.equal(patchBodies(calls).length, 0, "an alias is not the month workbook, whatever its name says");
  });

  it("refuses to write into an empty stub left by a half-finished copy", async () => {
    delegatedEnv();
    const calls = installGraphDouble({
      copy: () => generalExceptionCopy(),
      probe: () => jsonResponse(200, { id: "item-1", name: "Standards 2026-08.xlsx", size: 0, file: { mimeType: "application/vnd.ms-excel" } }),
    });
    await assert.rejects(
      () => excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) }),
      (error: unknown) => {
        assert.ok(error instanceof excel.ExcelWorkbookCopyError);
        return true;
      },
    );
    assert.equal(patchBodies(calls).length, 0);
  });

  it("rebuilds a byte-identical Data worksheet whatever order the database returns rows in", async () => {
    delegatedEnv();
    const rows = [
      daily("Lori", "2026-08-03", { newMatters: 2, attorneyCall: 1, completion: "100%" }),
      daily("Ivan", "2026-08-11", { welcome: 3, completion: "50%" }),
      daily("Lori", "2026-08-04", { weeklyCheckIns: 1, completion: "25%" }),
    ];
    const calls = installGraphDouble();
    await excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom(rows) });
    await excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([...rows].reverse()) });

    const bodies = patchBodies(calls);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
  });

  it("gives a case manager with no activity all month his own block of zeroed days", () => {
    const range = excel.resolveMonthRange({}, NOW);
    const sheet = excel.buildDataSheet([daily("Lori", "2026-08-03", { newMatters: 2, completion: "100%" })], range, NOW);
    const blockStart = (owner: string) => 1 + ["Svetlana", "Jesus", "Alessandra", "Ivan", "Ronald", "Camila", "Anahi", "Lori"].indexOf(owner) * 31;

    assert.deepEqual(sheet.values[blockStart("Svetlana")], [
      "Svetlana",
      excelSerialFromDateKey("2026-08-01"),
      0, 0, 0, 0, 0,
      "No activity",
      "", "",
    ]);
    const svetlana = sheet.values.slice(blockStart("Svetlana"), blockStart("Svetlana") + 31);
    assert.equal(svetlana.filter((row) => row[0] === "Svetlana").length, 15);
    assert.equal(svetlana[14][1], excelSerialFromDateKey("2026-08-15"));
    assert.deepEqual(svetlana[15], ["", "", "", "", "", "", "", "", "", ""]);
    assert.equal(sheet.values[blockStart("Lori") + 2][7], "100%");
    assert.equal(sheet.values[blockStart("Lori")][7], "No activity");
    assert.equal(sheet.address, "A1:J311");
  });

  it("writes nothing at all when the template is missing", async () => {
    delegatedEnv();
    const calls = installGraphDouble({ copy: () => jsonResponse(404, { error: { code: "itemNotFound" } }) });
    await assert.rejects(
      () => excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) }),
      (error: unknown) => {
        assert.ok(error instanceof excel.ExcelTemplateMissingError);
        assert.match(error.message, /MICROSOFT_EXCEL_TEMPLATE_PATH/);
        return true;
      },
    );
    assert.equal(patchBodies(calls).length, 0);
  });

  it("names the open workbook when Graph refuses the write with a nested accessConflict", async () => {
    delegatedEnv();
    const calls = installGraphDouble({
      write: () =>
        jsonResponse(409, {
          error: {
            code: "conflict",
            message: "The request could not be completed.",
            innerError: { code: "accessConflict", message: "another client has locked the workbook for edit" },
          },
        }),
    });
    await assert.rejects(
      () => excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) }),
      (error: unknown) => {
        assert.ok(error instanceof excel.ExcelWorkbookBusyError);
        assert.match(error.message, /another editor has it open/);
        assert.match(error.message, /accessConflict/i);
        assert.match(error.message, /CWCA\/Standards 2026-08\.xlsx/);
        assert.match(error.message, /Nothing was written/);
        assert.match(error.message, /no numbers were lost/);
        return true;
      },
    );
    assert.equal(patchBodies(calls).length, 1);
  });

  it("reports a bare 423 as locked without claiming it knows a person is editing", async () => {
    delegatedEnv();
    installGraphDouble({ write: () => jsonResponse(423, { error: { code: "resourceLocked" } }) });
    await assert.rejects(
      () => excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) }),
      (error: unknown) => {
        assert.ok(error instanceof excel.ExcelWorkbookBusyError);
        assert.match(error.message, /CWCA\/Standards 2026-08\.xlsx/);
        assert.match(error.message, /423/);
        assert.match(error.message, /retention hold|sensitivity label|checkout/);
        assert.doesNotMatch(error.message, /another editor has it open/, "423 alone does not prove a live editor");
        return true;
      },
    );
  });

  it("leaves an unrelated write failure reported as it is today, status and body intact", async () => {
    delegatedEnv();
    installGraphDouble({ write: () => jsonResponse(500, { error: { code: "internalServerError", message: "GenericFileOpenError" } }) });
    await assert.rejects(
      () => excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!(error instanceof excel.ExcelWorkbookBusyError));
        assert.match(error.message, /could not write the Data worksheet of CWCA\/Standards 2026-08\.xlsx: 500/);
        assert.match(error.message, /GenericFileOpenError/);
        return true;
      },
    );
  });

  it("resolves the month once and refuses a range that would straddle two workbooks", () => {
    assert.deepEqual(excel.resolveMonthRange({}, NOW), { monthKey: "2026-08", from: "2026-08-01", to: "2026-08-15", daysInMonth: 31 });
    assert.deepEqual(excel.resolveMonthRange({ from: "2026-08-01", to: "2026-08-31" }, NOW).to, "2026-08-15");
    assert.deepEqual(excel.resolveMonthRange({ from: "2026-06-14" }, NOW), { monthKey: "2026-06", from: "2026-06-01", to: "2026-06-30", daysInMonth: 30 });
    assert.deepEqual(excel.resolveMonthRange({ from: "2026-02-11", to: "2026-02-28" }, NOW), {
      monthKey: "2026-02",
      from: "2026-02-01",
      to: "2026-02-28",
      daysInMonth: 28,
    });
    assert.throws(() => excel.resolveMonthRange({ from: "2026-07-28", to: "2026-08-03" }, NOW), /one month per workbook/);
    assert.throws(() => excel.resolveMonthRange({ from: "2027-08-01" }, NOW), /workbook for 2027-08.+current Chicago month is 2026-08/);
    assert.equal(excel.monthWorkbookPath("CWCA/Standards {month}.xlsx", "2026-02"), "CWCA/Standards 2026-02.xlsx");
  });
});

describe("excel-sync route defaults and writer guards", () => {
  it("defaults Excel sync to the current Chicago month and writes only through the Data worksheet", () => {
    const route = readFileSync(fileURLToPath(new URL("../app/api/standards/excel-sync/route.ts", import.meta.url)), "utf8");
    const writer = readFileSync(fileURLToPath(new URL("./microsoft-excel.ts", import.meta.url)), "utf8");
    assert.doesNotMatch(route, /lastCompletedWeekRange/);
    assert.match(route, /currentChicagoMonthRange/);
    assert.match(writer, /numberFormat/);
    assert.doesNotMatch(writer, /clearRows|padRows\(\[\]/);
    assert.doesNotMatch(
      writer,
      /collectArchiveRows|upsertDailyRows|createSession|worksheets\/add|conflictBehavior=rename|conflictBehavior=replace/,
    );
    const worksheetMentions = writer.match(/worksheets[^\n]*/g) ?? [];
    assert.ok(worksheetMentions.length >= 1);
    assert.ok(worksheetMentions.every((mention) => mention.startsWith("worksheets('Data')")), worksheetMentions.join(" | "));
  });

  it("reports the workbook it wrote to in both the JSON body and the redirect notice", () => {
    const route = readFileSync(fileURLToPath(new URL("../app/api/standards/excel-sync/route.ts", import.meta.url)), "utf8");
    const writer = readFileSync(fileURLToPath(new URL("./microsoft-excel.ts", import.meta.url)), "utf8");
    assert.match(writer, /workbookTarget: scopedLabel\(workbookPath, config\.workbookScope\)/);
    assert.match(writer, /workbookScope: config\.workbookScope/);
    assert.match(route, /NextResponse\.json\(\{ ok: true, \.\.\.result, filters \}\)/);
    assert.match(route, /Excel workbook \$\{result\.workbookTarget\} updated/);
    assert.match(route, /Data worksheet of \$\{result\.workbookPath\}/);
  });
});

const PRODUCTION_TARGET = {
  MICROSOFT_EXCEL_WORKBOOK_PATH: "CWCA/Standards {month}.xlsx",
  MICROSOFT_EXCEL_WORKBOOK_WEB_URL: "https://example.com/production-web-url",
  MICROSOFT_EXCEL_REFRESH_TOKEN: "refresh-token-live-value",
};

describe("Microsoft Excel preview workbook target", () => {
  it("leaves production and local on the production workbook variables", async () => {
    setExcelEnv({
      ...PRODUCTION_TARGET,
      VERCEL_ENV: "production",
      MICROSOFT_EXCEL_WORKBOOK_PATH_PREVIEW: "CWCA/cwca-standards-test {month}.xlsx",
      MICROSOFT_EXCEL_WORKBOOK_WEB_URL_PREVIEW: "https://example.com/preview-web-url",
    });
    assert.equal(excel.excelWorkbookScope(), "production");
    assert.equal(excel.excelWorkbookLabel(), "CWCA/Standards {month}.xlsx (production)");
    assert.equal(excel.microsoftExcelWorkbookUrl(), "https://example.com/production-web-url");
    assert.equal(excel.microsoftExcelConfigured(), true);

    const calls = installGraphDouble();
    const result = await excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) });
    assert.equal(result.workbookPath, "CWCA/Standards 2026-08.xlsx");
    assert.equal(result.workbookScope, "production");
    assert.equal(result.workbookTarget, "CWCA/Standards 2026-08.xlsx (production)");
    assert.equal(result.workbookUrl, "https://example.com/production-web-url");
    assert.ok(!calls.some((call) => call.url.includes("cwca-standards-test")));

    delete process.env.VERCEL_ENV;
    assert.equal(excel.excelWorkbookScope(), "production");
    assert.equal(excel.microsoftExcelWorkbookUrl(), "https://example.com/production-web-url");
  });

  it("refuses a preview sync with no preview workbook and makes no HTTP call", async () => {
    setExcelEnv({ ...PRODUCTION_TARGET, VERCEL_ENV: "preview" });
    const calls = installGraphDouble();
    assert.equal(excel.excelWorkbookScope(), "preview");
    assert.equal(excel.microsoftExcelConfigured(), false);
    assert.equal(excel.microsoftExcelWorkbookUrl(), "");
    assert.equal(excel.excelWorkbookLabel(), "unspecified (preview)");
    await assert.rejects(
      () => excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, excel.PREVIEW_WORKBOOK_REQUIRED_MESSAGE);
        assert.match(error.message, /never falls back to the production workbook/);
        assert.doesNotMatch(error.message, /Excel Online sync is not configured/);
        assert.doesNotMatch(error.message, /Standards \{month\}|Standards Template|production-web-url/);
        return true;
      },
    );
    assert.deepEqual(calls, []);
  });

  it("copies and writes the preview workbook while the production path is inherited", async () => {
    setExcelEnv({
      ...PRODUCTION_TARGET,
      VERCEL_ENV: "preview",
      MICROSOFT_EXCEL_WORKBOOK_PATH_PREVIEW: "CWCA/cwca-standards-test {month}.xlsx",
    });
    assert.equal(process.env.MICROSOFT_EXCEL_WORKBOOK_PATH, "CWCA/Standards {month}.xlsx");
    assert.equal(excel.microsoftExcelConfigured(), true);
    assert.equal(excel.excelWorkbookLabel(), "CWCA/cwca-standards-test {month}.xlsx (preview)");

    const calls = installGraphDouble();
    const result = await excel.syncStandardsToMicrosoftExcel({}, { now: NOW, reportRows: rowsFrom([]) });
    assert.equal(result.workbookPath, "CWCA/cwca-standards-test 2026-08.xlsx");
    assert.equal(result.workbookScope, "preview");
    assert.equal(result.workbookTarget, "CWCA/cwca-standards-test 2026-08.xlsx (preview)");

    const copies = calls.filter((call) => call.url.includes("/copy?"));
    assert.equal(copies.length, 1);
    assert.equal(copies[0].body, JSON.stringify({ name: "cwca-standards-test 2026-08.xlsx" }));
    const patches = calls.filter((call) => call.method === "PATCH");
    assert.equal(patches.length, 1);
    assert.match(patches[0].url, /root:\/CWCA\/cwca-standards-test%202026-08\.xlsx:\/workbook\/worksheets\('Data'\)/);
    assert.ok(
      !graphWrites(calls).some((call) => call.url.includes("Standards%202026-08.xlsx")),
      "a preview run addressed the production month workbook",
    );
  });
});
