import crypto from "crypto";
import { optionalEnv } from "./config";
import { STANDARD_CASE_MANAGERS, STANDARDS_SHEET_HEADERS, standardsReportRows, type DashboardFilters } from "./dashboard-data";

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

function sheetRange(sheetName: string, range = "A:G"): string {
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

function rowValues(row: Awaited<ReturnType<typeof standardsReportRows>>[number]): Array<string | number> {
  return [
    row.owner,
    row.date,
    row.newMatters,
    row.attorneyCall,
    row.welcome,
    row.courtDate,
    row.completion,
  ];
}

export async function syncStandardsToGoogleSheets(filters: DashboardFilters = {}) {
  assertGoogleSheetsConfig();
  await ensureCaseManagerSheets();
  const rows = await standardsReportRows(filters);
  const updates = STANDARD_CASE_MANAGERS.map((owner) => {
    const ownerRows = rows.filter((row) => row.owner === owner).sort((a, b) => a.sortDate.localeCompare(b.sortDate));
    return {
      range: sheetRange(owner, "A1:G200"),
      values: [STANDARDS_SHEET_HEADERS, ...ownerRows.map(rowValues)],
    };
  });
  await googleRequest("/values:batchClear", {
    method: "POST",
    body: JSON.stringify({
      ranges: STANDARD_CASE_MANAGERS.map((owner) => sheetRange(owner, "A:G")),
    }),
  });
  await googleRequest("/values:batchUpdate?valueInputOption=USER_ENTERED", {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: updates,
    }),
  });
  return {
    spreadsheetId: optionalEnv("GOOGLE_SHEETS_SPREADSHEET_ID").trim(),
    sheetsUpdated: STANDARD_CASE_MANAGERS.length,
    rowsSynced: rows.length,
  };
}
