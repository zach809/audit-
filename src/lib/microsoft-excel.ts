import { optionalEnv } from "./config";
import { STANDARD_CASE_MANAGERS, STANDARDS_SHEET_HEADERS, standardsReportRows, type DashboardFilters } from "./dashboard-data";
import {
  activityCompletion,
  collectArchiveRows,
  excelSerialFromDateKey,
  rowsOnOrBeforeToday,
  upsertDailyRows,
  type SheetDailyRow,
} from "./standards-sheet-sync";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const GRAPH_APP_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_DELEGATED_SCOPE = "https://graph.microsoft.com/Files.ReadWrite offline_access";

export class MicrosoftInvalidGrantError extends Error {
  readonly code = "invalid_grant" as const;

  constructor() {
    super(
      "Microsoft Excel refresh token was rejected (invalid_grant). The token was revoked or expired and must be re-issued by a person; retrying will not fix this.",
    );
    this.name = "MicrosoftInvalidGrantError";
  }
}

export function redactMicrosoftSecrets(text: string): string {
  return text
    .replace(/(client_secret=)[^&\s]*/gi, "$1[REDACTED]")
    .replace(/(refresh_token=)[^&\s]*/gi, "$1[REDACTED]")
    .replace(/(access_token=)[^&\s]*/gi, "$1[REDACTED]")
    .replace(/("(?:client_secret|refresh_token|access_token)"\s*:\s*")[^"]*/gi, "$1[REDACTED]");
}

function tokenErrorCode(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    return typeof parsed.error === "string" ? parsed.error.trim() : "";
  } catch {
    return "";
  }
}

type GraphWorksheet = {
  id: string;
  name: string;
};

type GraphWorksheetList = {
  value?: GraphWorksheet[];
};

type GraphAddWorksheetResponse = {
  id?: string;
  name?: string;
};

type GraphWorkbookSessionResponse = {
  id?: string;
};

export type ExcelWorkbookScope = "production" | "preview";

export type ExcelWorkbookTarget = {
  scope: ExcelWorkbookScope;
  itemId: string;
  path: string;
  shareUrl: string;
  webUrl: string;
};

const WORKBOOK_ENV_BY_SCOPE: Record<ExcelWorkbookScope, Record<"itemId" | "path" | "shareUrl" | "webUrl", string>> = {
  production: {
    itemId: "MICROSOFT_EXCEL_WORKBOOK_ITEM_ID",
    path: "MICROSOFT_EXCEL_WORKBOOK_PATH",
    shareUrl: "MICROSOFT_EXCEL_WORKBOOK_SHARE_URL",
    webUrl: "MICROSOFT_EXCEL_WORKBOOK_WEB_URL",
  },
  preview: {
    itemId: "MICROSOFT_EXCEL_WORKBOOK_ITEM_ID_PREVIEW",
    path: "MICROSOFT_EXCEL_WORKBOOK_PATH_PREVIEW",
    shareUrl: "MICROSOFT_EXCEL_WORKBOOK_SHARE_URL_PREVIEW",
    webUrl: "MICROSOFT_EXCEL_WORKBOOK_WEB_URL_PREVIEW",
  },
};

export const PREVIEW_WORKBOOK_REQUIRED_MESSAGE =
  "Excel sync refused: this is a preview deployment and no preview workbook is set. Add MICROSOFT_EXCEL_WORKBOOK_PATH_PREVIEW (or MICROSOFT_EXCEL_WORKBOOK_ITEM_ID_PREVIEW, or MICROSOFT_EXCEL_WORKBOOK_SHARE_URL_PREVIEW) to the Vercel Preview environment. Preview never falls back to the production workbook.";

export function excelWorkbookScope(): ExcelWorkbookScope {
  return optionalEnv("VERCEL_ENV") === "preview" ? "preview" : "production";
}

export function excelWorkbookTarget(scope: ExcelWorkbookScope = excelWorkbookScope()): ExcelWorkbookTarget {
  const keys = WORKBOOK_ENV_BY_SCOPE[scope];
  return {
    scope,
    itemId: optionalEnv(keys.itemId).trim(),
    path: optionalEnv(keys.path).trim().replace(/^\/+/, ""),
    shareUrl: optionalEnv(keys.shareUrl).trim(),
    webUrl: optionalEnv(keys.webUrl).trim(),
  };
}

export function excelWorkbookLabel(target: ExcelWorkbookTarget = excelWorkbookTarget()): string {
  const location = target.shareUrl ? "shared link" : target.itemId || target.path || "unspecified";
  return `${location} (${target.scope})`;
}

function excelPrivateConfig() {
  const target = excelWorkbookTarget();
  return {
    tenantId: optionalEnv("MICROSOFT_TENANT_ID").trim(),
    clientId: optionalEnv("MICROSOFT_CLIENT_ID").trim(),
    clientSecret: optionalEnv("MICROSOFT_CLIENT_SECRET").trim(),
    refreshToken: optionalEnv("MICROSOFT_EXCEL_REFRESH_TOKEN").trim(),
    userId: optionalEnv("MICROSOFT_EXCEL_USER_ID").trim(),
    workbookScope: target.scope,
    workbookItemId: target.itemId,
    workbookPath: target.path,
    workbookShareUrl: target.shareUrl,
    workbookLabel: excelWorkbookLabel(target),
  };
}

type ExcelPrivateConfig = ReturnType<typeof excelPrivateConfig>;
export type ExcelAuthMode = "delegated" | "application";

export function excelAuthDisclosure(config: ExcelPrivateConfig = excelPrivateConfig()): {
  authMode: ExcelAuthMode;
  authAccount: string;
} {
  const authMode: ExcelAuthMode = config.refreshToken ? "delegated" : "application";
  return {
    authMode,
    authAccount: authMode === "delegated" ? config.userId : "application",
  };
}

export function microsoftExcelConfigured(): boolean {
  const config = excelPrivateConfig();
  const common = Boolean(
    config.tenantId &&
      config.clientId &&
      config.userId &&
      (config.workbookItemId || config.workbookPath || config.workbookShareUrl),
  );
  if (!common) return false;
  return excelAuthDisclosure(config).authMode === "delegated" ? Boolean(config.refreshToken) : Boolean(config.clientSecret);
}

export function microsoftExcelWorkbookUrl(): string {
  return excelWorkbookTarget().webUrl;
}

function assertMicrosoftExcelConfig() {
  const config = excelPrivateConfig();
  if (config.workbookScope === "preview" && !config.workbookItemId && !config.workbookPath && !config.workbookShareUrl) {
    throw new Error(PREVIEW_WORKBOOK_REQUIRED_MESSAGE);
  }
  if (!microsoftExcelConfigured()) {
    throw new Error(
      "Excel Online sync is not configured. Add MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_EXCEL_USER_ID, a workbook location, and either MICROSOFT_EXCEL_REFRESH_TOKEN (delegated) or MICROSOFT_CLIENT_SECRET (application) in Vercel.",
    );
  }
  return config;
}

function microsoftTokenGrantParams(config: ExcelPrivateConfig): URLSearchParams {
  if (excelAuthDisclosure(config).authMode === "delegated") {
    return new URLSearchParams({
      client_id: config.clientId,
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      scope: GRAPH_DELEGATED_SCOPE,
    });
  }
  return new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "client_credentials",
    scope: GRAPH_APP_SCOPE,
  });
}

export async function requestMicrosoftExcelAccessToken(): Promise<string> {
  const config = assertMicrosoftExcelConfig();
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: microsoftTokenGrantParams(config),
  });
  const text = await response.text();
  if (!response.ok) {
    if (tokenErrorCode(text) === "invalid_grant") throw new MicrosoftInvalidGrantError();
    throw new Error(`Microsoft token request failed: ${response.status} ${redactMicrosoftSecrets(text).slice(0, 300)}`);
  }
  const json = JSON.parse(text) as { access_token?: string };
  if (!json.access_token) throw new Error("Microsoft token response did not include an access token.");
  return json.access_token;
}

async function graphAccessToken(): Promise<string> {
  return requestMicrosoftExcelAccessToken();
}

function workbookGraphBasePath(): string {
  const { userId, workbookItemId, workbookPath } = assertMicrosoftExcelConfig();
  const userPart = `/users/${encodeURIComponent(userId)}/drive`;
  if (workbookItemId) return `${userPart}/items/${encodeURIComponent(workbookItemId)}/workbook`;
  const cleanPath = workbookPath.split("/").map(encodeURIComponent).join("/");
  return `${userPart}/root:/${cleanPath}:/workbook`;
}

function shareIdFromUrl(url: string): string {
  return `u!${Buffer.from(url).toString("base64url").replace(/=+$/g, "")}`;
}

async function workbookGraphBasePathAsync(): Promise<string> {
  const { workbookShareUrl } = assertMicrosoftExcelConfig();
  if (!workbookShareUrl) return workbookGraphBasePath();
  const driveItem = await graphRequest<{ id?: string; parentReference?: { driveId?: string } }>(
    `/shares/${shareIdFromUrl(workbookShareUrl)}/driveItem?$select=id,parentReference`,
  );
  const driveId = driveItem.parentReference?.driveId;
  const itemId = driveItem.id;
  if (!driveId || !itemId) {
    throw new Error("Microsoft Graph could not resolve the Excel workbook sharing link. Confirm the signed-in account or app can edit the workbook and the link is valid.");
  }
  return `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook`;
}

async function graphRequest<T>(path: string, init: RequestInit = {}, workbookSessionId = ""): Promise<T> {
  const token = await graphAccessToken();
  const response = await fetch(`${GRAPH_ROOT}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(workbookSessionId ? { "workbook-session-id": workbookSessionId } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft Graph request failed: ${response.status} ${redactMicrosoftSecrets(text).slice(0, 500)}`);
  }
  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
}

async function createWorkbookSession(base: string): Promise<string> {
  const session = await graphRequest<GraphWorkbookSessionResponse>(`${base}/createSession`, {
    method: "POST",
    body: JSON.stringify({ persistChanges: true }),
  });
  if (!session.id) throw new Error("Microsoft Graph did not create a persistent Excel workbook session.");
  return session.id;
}

async function closeWorkbookSession(base: string, workbookSessionId: string): Promise<void> {
  await graphRequest(`${base}/closeSession`, { method: "POST" }, workbookSessionId);
}

export const EXCEL_DATE_NUMBER_FORMAT = "yyyy-mm-dd";

function dailyRowValues(row: SheetDailyRow): Array<string | number> {
  return [
    row.owner,
    excelSerialFromDateKey(row.sortDate || row.date),
    row.newMatters,
    row.attorneyCall,
    row.welcome,
    row.courtDate,
    row.weeklyCheckIns,
    activityCompletion(row),
  ];
}

function rangeAddress(rowCount: number, columnCount: number): string {
  const columns = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const endColumn = columns[columnCount - 1] ?? "H";
  return `A1:${endColumn}${Math.max(1, rowCount)}`;
}

export function planExcelWorksheetValues(input: {
  owner: string;
  existingGrid: Array<Array<string | number | undefined>>;
  incoming: SheetDailyRow[];
  now?: Date;
}): { values: Array<Array<string | number>>; numberFormat: string[][] } {
  const now = input.now ?? new Date();
  const existingAll = collectArchiveRows(input.existingGrid, input.owner);
  const kept = upsertDailyRows(rowsOnOrBeforeToday(existingAll, now), rowsOnOrBeforeToday(input.incoming, now));
  const leftover = Math.max(0, existingAll.length - kept.length);
  const emptyRow = Array.from({ length: STANDARDS_SHEET_HEADERS.length }, () => "");
  const values = [STANDARDS_SHEET_HEADERS, ...kept.map(dailyRowValues), ...Array.from({ length: leftover }, () => [...emptyRow])];
  const numberFormat = values.map((row, index) =>
    row.map((_, column) => (index > 0 && column === 1 && row[1] !== "" ? EXCEL_DATE_NUMBER_FORMAT : "General")),
  );
  return { values, numberFormat };
}

async function ensureCaseManagerWorksheets(base: string, workbookSessionId: string): Promise<Map<string, string>> {
  const workbook = await graphRequest<GraphWorksheetList>(`${base}/worksheets`, {}, workbookSessionId);
  const worksheets = new Map((workbook.value ?? []).map((sheet) => [sheet.name, sheet.id]));

  for (const name of STANDARD_CASE_MANAGERS) {
    if (worksheets.has(name)) continue;
    const created = await graphRequest<GraphAddWorksheetResponse>(`${base}/worksheets/add`, {
      method: "POST",
      body: JSON.stringify({ name }),
    }, workbookSessionId);
    if (!created.id) throw new Error(`Microsoft Graph did not return an id for worksheet ${name}.`);
    worksheets.set(name, created.id);
  }

  return worksheets;
}

async function readWorksheetValues(base: string, worksheetId: string, workbookSessionId: string): Promise<Array<Array<string | number>>> {
  const columnCount = STANDARDS_SHEET_HEADERS.length;
  const json = await graphRequest<{ values?: Array<Array<string | number | null>> }>(
    `${base}/worksheets/${encodeURIComponent(worksheetId)}/range(address='${rangeAddress(200, columnCount)}')?$select=values`,
    {},
    workbookSessionId,
  );
  return (json.values ?? []).map((row) => (row ?? []).map((cell) => (cell == null ? "" : cell)));
}

async function writeOwnerWorksheet(
  base: string,
  worksheetId: string,
  owner: string,
  incoming: SheetDailyRow[],
  now: Date,
  workbookSessionId: string,
) {
  const existingGrid = await readWorksheetValues(base, worksheetId, workbookSessionId);
  const plan = planExcelWorksheetValues({ owner, existingGrid, incoming, now });
  await graphRequest(`${base}/worksheets/${encodeURIComponent(worksheetId)}/range(address='${rangeAddress(plan.values.length, STANDARDS_SHEET_HEADERS.length)}')`, {
    method: "PATCH",
    body: JSON.stringify({ values: plan.values, numberFormat: plan.numberFormat }),
  }, workbookSessionId);
}

export async function syncStandardsToMicrosoftExcel(filters: DashboardFilters = {}) {
  const config = assertMicrosoftExcelConfig();
  const disclosure = excelAuthDisclosure(config);
  if (disclosure.authMode === "delegated") {
    console.info(`Excel sync using delegated auth as ${disclosure.authAccount}`);
  } else {
    console.info("Excel sync using application client-credentials auth");
  }
  const base = await workbookGraphBasePathAsync();
  const workbookSessionId = await createWorkbookSession(base);
  try {
    const worksheets = await ensureCaseManagerWorksheets(base, workbookSessionId);
    const now = new Date();
    const rows = rowsOnOrBeforeToday(await standardsReportRows(filters), now);

    for (const owner of STANDARD_CASE_MANAGERS) {
      const worksheetId = worksheets.get(owner);
      if (!worksheetId) throw new Error(`Worksheet ${owner} was not found or created.`);
      const ownerRows = rows.filter((row) => row.owner === owner);
      await writeOwnerWorksheet(base, worksheetId, owner, ownerRows, now, workbookSessionId);
    }

    return {
      workbookUrl: microsoftExcelWorkbookUrl(),
      workbookScope: config.workbookScope,
      workbookTarget: config.workbookLabel,
      sheetsUpdated: STANDARD_CASE_MANAGERS.length,
      rowsSynced: rows.length,
      authMode: disclosure.authMode,
      authAccount: disclosure.authAccount,
    };
  } finally {
    await closeWorkbookSession(base, workbookSessionId).catch(() => undefined);
  }
}
