import { optionalEnv } from "./config";
import { STANDARD_CASE_MANAGERS, STANDARDS_SHEET_HEADERS, standardsReportRows, type DashboardFilters } from "./dashboard-data";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

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
    userId: optionalEnv("MICROSOFT_EXCEL_USER_ID").trim(),
    workbookItemId: optionalEnv("MICROSOFT_EXCEL_WORKBOOK_ITEM_ID").trim(),
    workbookPath: optionalEnv("MICROSOFT_EXCEL_WORKBOOK_PATH").trim().replace(/^\/+/, ""),
    workbookShareUrl: optionalEnv("MICROSOFT_EXCEL_WORKBOOK_SHARE_URL").trim(),
  };
}

export function microsoftExcelConfigured(): boolean {
  const config = excelPrivateConfig();
  return Boolean(
    config.tenantId &&
      config.clientId &&
      config.clientSecret &&
      config.userId &&
      (config.workbookItemId || config.workbookPath || config.workbookShareUrl),
  );
}

export function microsoftExcelWorkbookUrl(): string {
  return optionalEnv("MICROSOFT_EXCEL_WORKBOOK_WEB_URL").trim();
}

function assertMicrosoftExcelConfig() {
  const config = excelPrivateConfig();
  if (!microsoftExcelConfigured()) {
    throw new Error(
      "Excel Online sync is not configured. Add MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_EXCEL_USER_ID, and MICROSOFT_EXCEL_WORKBOOK_SHARE_URL, MICROSOFT_EXCEL_WORKBOOK_ITEM_ID, or MICROSOFT_EXCEL_WORKBOOK_PATH in Vercel.",
    );
  }
  return config;
}

async function graphAccessToken(): Promise<string> {
  const { tenantId, clientId, clientSecret } = assertMicrosoftExcelConfig();
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: GRAPH_SCOPE,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Microsoft token request failed: ${response.status} ${text.slice(0, 300)}`);
  }
  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Microsoft token response did not include an access token.");
  return json.access_token;
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
    throw new Error("Microsoft Graph could not resolve the Excel workbook sharing link. Confirm the app has Files.ReadWrite.All permission and the workbook link is valid.");
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
    throw new Error(`Microsoft Graph request failed: ${response.status} ${text.slice(0, 500)}`);
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
  assertMicrosoftExcelConfig();
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
    };
  } finally {
    await closeWorkbookSession(base, workbookSessionId).catch(() => undefined);
  }
}
