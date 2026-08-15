import { optionalEnv } from "./config";
import { STANDARD_CASE_MANAGERS, STANDARDS_SHEET_HEADERS, standardsReportRows, type DashboardFilters } from "./dashboard-data";

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

function excelPrivateConfig() {
  return {
    tenantId: optionalEnv("MICROSOFT_TENANT_ID").trim(),
    clientId: optionalEnv("MICROSOFT_CLIENT_ID").trim(),
    clientSecret: optionalEnv("MICROSOFT_CLIENT_SECRET").trim(),
    refreshToken: optionalEnv("MICROSOFT_EXCEL_REFRESH_TOKEN").trim(),
    userId: optionalEnv("MICROSOFT_EXCEL_USER_ID").trim(),
    workbookItemId: optionalEnv("MICROSOFT_EXCEL_WORKBOOK_ITEM_ID").trim(),
    workbookPath: optionalEnv("MICROSOFT_EXCEL_WORKBOOK_PATH").trim().replace(/^\/+/, ""),
    workbookShareUrl: optionalEnv("MICROSOFT_EXCEL_WORKBOOK_SHARE_URL").trim(),
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
  return optionalEnv("MICROSOFT_EXCEL_WORKBOOK_WEB_URL").trim();
}

function assertMicrosoftExcelConfig() {
  const config = excelPrivateConfig();
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

function rowValues(row: Awaited<ReturnType<typeof standardsReportRows>>[number]): Array<string | number> {
  return [
    row.owner,
    row.date,
    row.newMatters,
    row.attorneyCall,
    row.welcome,
    row.courtDate,
    row.weeklyCheckIns,
    row.completion,
  ];
}

function rangeAddress(rowCount: number, columnCount: number): string {
  const columns = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const endColumn = columns[columnCount - 1] ?? "H";
  return `A1:${endColumn}${Math.max(1, rowCount)}`;
}

function padRows(values: Array<Array<string | number>>, targetRows: number, columnCount: number): Array<Array<string | number>> {
  const emptyRow = Array.from({ length: columnCount }, () => "");
  const padded = values.map((row) => [...row, ...emptyRow].slice(0, columnCount));
  while (padded.length < targetRows) padded.push([...emptyRow]);
  return padded;
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

async function updateWorksheetRange(base: string, worksheetId: string, values: Array<Array<string | number>>, workbookSessionId: string) {
  const columnCount = STANDARDS_SHEET_HEADERS.length;
  const clearRows = Math.max(200, values.length + 10);
  const clearValues = padRows([], clearRows, columnCount);

  await graphRequest(`${base}/worksheets/${encodeURIComponent(worksheetId)}/range(address='${rangeAddress(clearRows, columnCount)}')`, {
    method: "PATCH",
    body: JSON.stringify({ values: clearValues }),
  }, workbookSessionId);

  await graphRequest(`${base}/worksheets/${encodeURIComponent(worksheetId)}/range(address='${rangeAddress(values.length, columnCount)}')`, {
    method: "PATCH",
    body: JSON.stringify({ values }),
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
    const rows = await standardsReportRows(filters);

    for (const owner of STANDARD_CASE_MANAGERS) {
      const worksheetId = worksheets.get(owner);
      if (!worksheetId) throw new Error(`Worksheet ${owner} was not found or created.`);
      const ownerRows = rows
        .filter((row) => row.owner === owner)
        .sort((a, b) => a.sortDate.localeCompare(b.sortDate));
      await updateWorksheetRange(base, worksheetId, [STANDARDS_SHEET_HEADERS, ...ownerRows.map(rowValues)], workbookSessionId);
    }

    return {
      workbookUrl: microsoftExcelWorkbookUrl(),
      sheetsUpdated: STANDARD_CASE_MANAGERS.length,
      rowsSynced: rows.length,
      authMode: disclosure.authMode,
      authAccount: disclosure.authAccount,
    };
  } finally {
    await closeWorkbookSession(base, workbookSessionId).catch(() => undefined);
  }
}
