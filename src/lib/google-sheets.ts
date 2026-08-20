import crypto from "crypto";
import { optionalEnv } from "./config";
import { STANDARD_CASE_MANAGERS, STANDARDS_SHEET_HEADERS, standardsReportRows, type DashboardFilters } from "./dashboard-data";
import { initDb, db } from "./db";
import { publishOwnerTab, shouldPublishPeriod, type SheetValuesClient } from "./standards-sheet-sync";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

type GoogleSheet = {
  properties?: {
    sheetId?: number;
    title?: string;
  };
};

type GoogleSpreadsheet = {
  sheets?: GoogleSheet[];
};

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function privateKey(): string {
  return optionalEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY").replace(/\\n/g, "\n").trim();
}

export function googleSheetsConfigured(): boolean {
  return Boolean(
    optionalEnv("GOOGLE_SHEETS_SPREADSHEET_ID") &&
      optionalEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL") &&
      privateKey(),
  );
}

// GOOGLE_SHEETS_SPREADSHEET_ID is not scoped by environment, and a Vercel preview deployment inherits
// it from production, so every deployment resolves the firm's real Sheet. rejectNonProductionWrite()
// on /api/standards/google-sync is the only thing standing between a preview and that Sheet. Opening
// this sync to preview the way #42 opened Excel therefore takes a scoped destination first: give the
// id a per-scope table like WORKBOOK_ENV_BY_SCOPE in microsoft-excel.ts, and refuse before the first
// request when preview has no Sheet of its own. google-sheets.test.ts fails if the guard goes without
// the scoping.
function assertGoogleSheetsConfig() {
  const spreadsheetId = optionalEnv("GOOGLE_SHEETS_SPREADSHEET_ID").trim();
  const clientEmail = optionalEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL").trim();
  const key = privateKey();
  if (!spreadsheetId || !clientEmail || !key) {
    throw new Error("Google Sheets sync is not configured. Add GOOGLE_SHEETS_SPREADSHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY in Vercel.");
  }
  return { spreadsheetId, clientEmail, key };
}

async function googleAccessToken(): Promise<string> {
  const { clientEmail, key } = assertGoogleSheetsConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  }));
  const unsigned = `${header}.${claim}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(key);
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token request failed: ${response.status} ${text.slice(0, 300)}`);
  }
  const json = await response.json() as { access_token?: string };
  if (!json.access_token) throw new Error("Google token response did not include an access token.");
  return json.access_token;
}

function sheetRange(sheetName: string, range = "A:H"): string {
  return `'${sheetName.replace(/'/g, "''")}'!${range}`;
}

async function googleRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { spreadsheetId } = assertGoogleSheetsConfig();
  const token = await googleAccessToken();
  const response = await fetch(`${SHEETS_API}/${spreadsheetId}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheets request failed: ${response.status} ${text.slice(0, 300)}`);
  }
  if (response.status === 204) return {} as T;
  return await response.json() as T;
}

async function ensureCaseManagerSheets() {
  const spreadsheet = await googleRequest<GoogleSpreadsheet>("?fields=sheets.properties(sheetId,title)");
  const existing = new Set((spreadsheet.sheets ?? []).map((sheet) => sheet.properties?.title).filter(Boolean));
  const missing = STANDARD_CASE_MANAGERS.filter((name) => !existing.has(name));
  if (!missing.length) return;
  await googleRequest(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: missing.map((name) => ({
        addSheet: {
          properties: {
            title: name,
            gridProperties: {
              rowCount: 200,
              columnCount: STANDARDS_SHEET_HEADERS.length,
            },
          },
        },
      })),
    }),
  });
}

function liveSheetsClient(): SheetValuesClient {
  return {
    async getValues(sheetName, a1) {
      const encoded = encodeURIComponent(sheetRange(sheetName, a1));
      const json = await googleRequest<{ values?: string[][] }>(`/values/${encoded}`);
      return json.values ?? [];
    },
    async updateValues(sheetName, data) {
      await googleRequest("/values:batchUpdate?valueInputOption=USER_ENTERED", {
        method: "POST",
        body: JSON.stringify({
          valueInputOption: "USER_ENTERED",
          data: data.map((part) => ({
            range: sheetRange(sheetName, part.a1),
            values: part.values,
          })),
        }),
      });
    },
  };
}

async function latestAuditRunStatus(): Promise<string | null> {
  await initDb();
  const rows = await db()`select status from audit_run order by started_at desc limit 1`;
  return rows[0]?.status ? String(rows[0].status) : null;
}

function displayPeriodDate(value: string | undefined): string {
  const key = String(value ?? "").trim();
  const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return key;
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

export async function syncStandardsToGoogleSheets(filters: DashboardFilters = {}) {
  assertGoogleSheetsConfig();
  await ensureCaseManagerSheets();
  const auditStatus = await latestAuditRunStatus();
  if (!shouldPublishPeriod(auditStatus)) {
    return {
      spreadsheetId: optionalEnv("GOOGLE_SHEETS_SPREADSHEET_ID").trim(),
      sheetsUpdated: 0,
      rowsSynced: 0,
      skipped: "incomplete-audit" as const,
    };
  }
  const rows = await standardsReportRows(filters);
  const period = { from: displayPeriodDate(filters.from), to: displayPeriodDate(filters.to) };
  const now = new Date();
  const client = liveSheetsClient();
  for (const owner of STANDARD_CASE_MANAGERS) {
    await publishOwnerTab(client, {
      owner,
      incoming: rows.filter((row) => row.owner === owner),
      period,
      auditStatus,
      now,
    });
  }
  return {
    spreadsheetId: optionalEnv("GOOGLE_SHEETS_SPREADSHEET_ID").trim(),
    sheetsUpdated: STANDARD_CASE_MANAGERS.length,
    rowsSynced: rows.length,
  };
}
