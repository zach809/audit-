import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { STANDARDS_SHEET_HEADERS } from "./dashboard-data";
import * as excel from "./microsoft-excel";
import type { SheetDailyRow } from "./standards-sheet-sync";

const ENV_KEYS = [
  "VERCEL_ENV",
  "MICROSOFT_TENANT_ID",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "MICROSOFT_EXCEL_USER_ID",
  "MICROSOFT_EXCEL_WORKBOOK_SHARE_URL",
  "MICROSOFT_EXCEL_WORKBOOK_PATH",
  "MICROSOFT_EXCEL_WORKBOOK_ITEM_ID",
  "MICROSOFT_EXCEL_WORKBOOK_WEB_URL",
  "MICROSOFT_EXCEL_WORKBOOK_SHARE_URL_PREVIEW",
  "MICROSOFT_EXCEL_WORKBOOK_PATH_PREVIEW",
  "MICROSOFT_EXCEL_WORKBOOK_ITEM_ID_PREVIEW",
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
    MICROSOFT_EXCEL_WORKBOOK_SHARE_URL: "https://example.com/workbook",
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

const PRODUCTION_TARGET = {
  MICROSOFT_EXCEL_WORKBOOK_ITEM_ID: "prod-item-id-must-not-be-used",
  MICROSOFT_EXCEL_WORKBOOK_PATH: "Production/real-standards.xlsx",
  MICROSOFT_EXCEL_WORKBOOK_SHARE_URL: "https://example.com/production-workbook",
  MICROSOFT_EXCEL_WORKBOOK_WEB_URL: "https://example.com/production-web-url",
  MICROSOFT_EXCEL_REFRESH_TOKEN: "refresh-token-live-value",
};

function captureGraphUrls() {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("login.microsoftonline.com")) return jsonResponse(200, { access_token: "access-token" });
    return jsonResponse(200, {});
  }) as typeof fetch;
  return calls;
}

function shareId(url: string) {
  return `u!${Buffer.from(url).toString("base64url").replace(/=+$/g, "")}`;
}

describe("Microsoft Excel preview workbook target", () => {
  it("leaves production and local on the production workbook variables", async () => {
    setExcelEnv({
      ...PRODUCTION_TARGET,
      VERCEL_ENV: "production",
      MICROSOFT_EXCEL_WORKBOOK_ITEM_ID: "",
      MICROSOFT_EXCEL_WORKBOOK_SHARE_URL: "",
      MICROSOFT_EXCEL_WORKBOOK_PATH_PREVIEW: "CWCA/cwca-standards-test.xlsx",
      MICROSOFT_EXCEL_WORKBOOK_WEB_URL_PREVIEW: "https://example.com/preview-web-url",
    });
    assert.equal(excel.excelWorkbookScope(), "production");
    assert.equal(excel.excelWorkbookLabel(), "Production/real-standards.xlsx (production)");
    assert.equal(excel.microsoftExcelWorkbookUrl(), "https://example.com/production-web-url");
    assert.equal(excel.microsoftExcelConfigured(), true);

    const calls = captureGraphUrls();
    await assert.rejects(() => excel.syncStandardsToMicrosoftExcel(), /persistent Excel workbook session/);
    const graph = calls.filter((url) => url.includes("graph.microsoft.com"));
    assert.equal(graph.length, 1);
    assert.match(graph[0], /root:\/Production\/real-standards\.xlsx:\/workbook\/createSession/);
    assert.ok(!calls.some((url) => url.includes("cwca-standards-test")));

    delete process.env.VERCEL_ENV;
    assert.equal(excel.excelWorkbookScope(), "production");
    assert.equal(excel.microsoftExcelWorkbookUrl(), "https://example.com/production-web-url");
  });

  it("refuses a preview sync with no preview workbook and makes no HTTP call", async () => {
    setExcelEnv({ ...PRODUCTION_TARGET, VERCEL_ENV: "preview" });
    const calls = captureGraphUrls();
    assert.equal(excel.excelWorkbookScope(), "preview");
    assert.equal(excel.microsoftExcelConfigured(), false);
    assert.equal(excel.microsoftExcelWorkbookUrl(), "");
    assert.equal(excel.excelWorkbookLabel(), "unspecified (preview)");
    await assert.rejects(
      () => excel.syncStandardsToMicrosoftExcel(),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, excel.PREVIEW_WORKBOOK_REQUIRED_MESSAGE);
        assert.match(error.message, /never falls back to the production workbook/);
        assert.doesNotMatch(error.message, /Excel Online sync is not configured/);
        assert.doesNotMatch(error.message, /prod-item-id-must-not-be-used|real-standards|production-workbook/);
        return true;
      },
    );
    assert.deepEqual(calls, []);
  });

  it("writes to the preview path even when the production item id is inherited", async () => {
    setExcelEnv({
      ...PRODUCTION_TARGET,
      VERCEL_ENV: "preview",
      MICROSOFT_EXCEL_WORKBOOK_SHARE_URL: "",
      MICROSOFT_EXCEL_WORKBOOK_PATH_PREVIEW: "CWCA/cwca-standards-test.xlsx",
    });
    assert.equal(process.env.MICROSOFT_EXCEL_WORKBOOK_ITEM_ID, "prod-item-id-must-not-be-used");
    assert.equal(excel.microsoftExcelConfigured(), true);
    assert.equal(excel.excelWorkbookLabel(), "CWCA/cwca-standards-test.xlsx (preview)");

    const calls = captureGraphUrls();
    await assert.rejects(() => excel.syncStandardsToMicrosoftExcel(), /persistent Excel workbook session/);
    const graph = calls.filter((url) => url.includes("graph.microsoft.com"));
    assert.equal(graph.length, 1);
    assert.match(graph[0], /root:\/CWCA\/cwca-standards-test\.xlsx:\/workbook\/createSession/);
    assert.ok(!calls.some((url) => url.includes("prod-item-id-must-not-be-used")));
    assert.ok(!calls.some((url) => url.includes("real-standards")));
  });

  it("uses the preview sharing link over an inherited production sharing link", async () => {
    setExcelEnv({
      ...PRODUCTION_TARGET,
      VERCEL_ENV: "preview",
      MICROSOFT_EXCEL_WORKBOOK_SHARE_URL_PREVIEW: "https://example.com/preview-workbook",
      MICROSOFT_EXCEL_WORKBOOK_ITEM_ID_PREVIEW: "preview-item-id",
    });
    assert.equal(excel.excelWorkbookLabel(), "shared link (preview)");
    assert.doesNotMatch(excel.excelWorkbookLabel(), /https?:|preview-workbook|production-workbook/);

    const calls = captureGraphUrls();
    await assert.rejects(() => excel.syncStandardsToMicrosoftExcel(), /could not resolve the Excel workbook sharing link/);
    const graph = calls.filter((url) => url.includes("graph.microsoft.com"));
    assert.equal(graph.length, 1);
    assert.ok(graph[0].includes(`/shares/${shareId("https://example.com/preview-workbook")}/driveItem`));
    assert.ok(!calls.some((url) => url.includes(shareId("https://example.com/production-workbook"))));
    assert.ok(!calls.some((url) => url.includes("prod-item-id-must-not-be-used")));
  });
});

function daily(owner: string, date: string, sortDate: string, extras: Partial<SheetDailyRow> = {}): SheetDailyRow {
  return { owner, date, sortDate, newMatters: 0, attorneyCall: 0, welcome: 0, courtDate: 0, weeklyCheckIns: 0, completion: "No activity", ...extras };
}

function work(owner: string, date: string, sortDate: string, completion: string): SheetDailyRow {
  return daily(owner, date, sortDate, { newMatters: 1, attorneyCall: 1, welcome: 1, courtDate: 1, weeklyCheckIns: 0, completion });
}

describe("Microsoft Excel daily write plan", () => {
  const now = new Date("2026-08-15T16:00:00Z");

  it("writes Date as an Excel serial with yyyy-mm-dd numberFormat, not a text date", () => {
    const plan = excel.planExcelWorksheetValues({
      owner: "Lori",
      existingGrid: [STANDARDS_SHEET_HEADERS],
      incoming: [work("Lori", "8/3/2026", "2026-08-03", "100%")],
      now,
    });
    assert.equal(plan.values[0][1], "Date");
    assert.equal(plan.values[1][1], 46237);
    assert.equal(typeof plan.values[1][1], "number");
    assert.equal(plan.numberFormat[1][1], "yyyy-mm-dd");
    assert.notEqual(plan.values[1][1], "8/3/2026");
    assert.notEqual(plan.values[1][1], "2026-08-03");
  });

  it("does not write a row for a date after today even when the requested range includes it", () => {
    const plan = excel.planExcelWorksheetValues({
      owner: "Lori",
      existingGrid: [
        STANDARDS_SHEET_HEADERS,
        ["Lori", 46237, 1, 1, 1, 1, 0, "100%"],
        ["Lori", 46255, 0, 0, 0, 0, 0, "0%"],
        ["Lori", 46262, 0, 0, 0, 0, 0, "0%"],
      ],
      incoming: [
        work("Lori", "8/3/2026", "2026-08-03", "100%"),
        daily("Lori", "8/21/2026", "2026-08-21", { weeklyCheckIns: 0, completion: "0%" }),
        daily("Lori", "8/28/2026", "2026-08-28", { weeklyCheckIns: 0, completion: "0%" }),
      ],
      now,
    });
    const dateSerials = plan.values.slice(1).map((row) => row[1]).filter((value) => value !== "");
    assert.deepEqual(dateSerials, [46237]);
    assert.ok(!dateSerials.includes(46255));
    assert.ok(!dateSerials.includes(46262));
    assert.equal(plan.values[2][1], "");
    assert.equal(plan.values[3][1], "");
  });

  it("keeps a hand-written past date and does not clear-and-rewrite the archive", () => {
    const plan = excel.planExcelWorksheetValues({
      owner: "Lori",
      existingGrid: [
        STANDARDS_SHEET_HEADERS,
        ["Lori", "7/1/2026", 12, 12, 12, 12, 4, "100%"],
      ],
      incoming: [work("Lori", "8/3/2026", "2026-08-03", "83%")],
      now,
    });
    assert.equal(plan.values[1][0], "Lori");
    assert.equal(plan.values[1][1], 46204);
    assert.equal(plan.values[1][7], "100%");
    assert.equal(plan.values[2][1], 46237);
    assert.equal(plan.values[2][7], "83%");
  });

  it("uses No activity, never 0, for a past day with no completed work", () => {
    const plan = excel.planExcelWorksheetValues({
      owner: "Lori",
      existingGrid: [STANDARDS_SHEET_HEADERS, ["Lori", 46237, 0, 0, 0, 0, 0, "0%"]],
      incoming: [daily("Lori", "8/4/2026", "2026-08-04", { completion: "0%" })],
      now,
    });
    const written = plan.values.filter((row) => row[0] === "Lori");
    assert.ok(written.length >= 1);
    assert.equal(written[0][7], "No activity");
    assert.ok(written.every((row) => row[7] !== 0 && row[7] !== "0" && row[7] !== "0%"));
    assert.equal(written.some((row) => row[1] === 46238), false);
  });
});

describe("excel-sync route defaults and writer guards", () => {
  it("defaults Excel sync to the current Chicago month and reuses the shared archive helpers", () => {
    const route = readFileSync(fileURLToPath(new URL("../app/api/standards/excel-sync/route.ts", import.meta.url)), "utf8");
    const writer = readFileSync(fileURLToPath(new URL("./microsoft-excel.ts", import.meta.url)), "utf8");
    assert.doesNotMatch(route, /lastCompletedWeekRange/);
    assert.match(route, /currentChicagoMonthRange/);
    assert.match(writer, /planExcelWorksheetValues/);
    assert.match(writer, /numberFormat/);
    assert.doesNotMatch(writer, /clearRows|padRows\(\[\]/);
    assert.match(writer, /collectArchiveRows|upsertDailyRows/);
  });

  it("reports the workbook it wrote to in both the JSON body and the redirect notice", () => {
    const route = readFileSync(fileURLToPath(new URL("../app/api/standards/excel-sync/route.ts", import.meta.url)), "utf8");
    const writer = readFileSync(fileURLToPath(new URL("./microsoft-excel.ts", import.meta.url)), "utf8");
    assert.match(writer, /workbookTarget: config\.workbookLabel/);
    assert.match(writer, /workbookScope: config\.workbookScope/);
    assert.match(route, /NextResponse\.json\(\{ ok: true, \.\.\.result, filters \}\)/);
    assert.match(route, /Excel workbook \$\{result\.workbookTarget\} updated/);
  });
});
