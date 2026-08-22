import { optionalEnv } from "./config";
import { STANDARD_CASE_MANAGERS, STANDARDS_SHEET_HEADERS, standardsReportRows, type DashboardFilters } from "./dashboard-data";
import {
  activityCompletion,
  chicagoDateKey,
  eachChicagoDateKey,
  excelSerialFromDateKey,
  formatSheetStamp,
  sheetDateKey,
  type SheetDailyRow,
} from "./standards-sheet-sync";

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const GRAPH_APP_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_DELEGATED_SCOPE = "https://graph.microsoft.com/Files.ReadWrite offline_access";
const MONTH_TOKEN = "{month}";
const COPY_POLL_INTERVAL_MS = 1000;
const COPY_POLL_TIMEOUT_MS = 30000;
const DATE_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export class MicrosoftInvalidGrantError extends Error {
  readonly code = "invalid_grant" as const;

  constructor() {
    super(
      "Microsoft Excel refresh token was rejected (invalid_grant). The token was revoked or expired and must be re-issued by a person; retrying will not fix this.",
    );
    this.name = "MicrosoftInvalidGrantError";
  }
}

export class ExcelTemplateMissingError extends Error {
  constructor(templatePath: string) {
    super(
      `Microsoft Graph could not find the Excel template at ${templatePath}. Point MICROSOFT_EXCEL_TEMPLATE_PATH at a workbook that exists and holds a Data worksheet. Nothing was written.`,
    );
    this.name = "ExcelTemplateMissingError";
  }
}

export class ExcelWorkbookCopyError extends Error {
  constructor(detail: string) {
    super(`Microsoft Graph could not create this month's workbook from the template: ${detail}. Nothing was written.`);
    this.name = "ExcelWorkbookCopyError";
  }
}

export class ExcelWorkbookBusyError extends Error {
  constructor(workbookPath: string, reason: string) {
    super(
      `Microsoft Graph would not write ${workbookPath}: ${reason}. Nothing was written. Every sync rebuilds the whole month from the database, so no numbers were lost; the next run restates them.`,
    );
    this.name = "ExcelWorkbookBusyError";
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

export type ExcelWorkbookScope = "production" | "preview";

export type ExcelWorkbookTarget = {
  scope: ExcelWorkbookScope;
  path: string;
  webUrl: string;
};

// The month workbook is the only destination, so the scope only has to redirect where the copy
// lands. The template is a read-only source shared by both scopes, and Graph copies it into its own
// folder, which is why a preview workbook path names a different file in the same folder.
const WORKBOOK_ENV_BY_SCOPE: Record<ExcelWorkbookScope, Record<"path" | "webUrl", string>> = {
  production: {
    path: "MICROSOFT_EXCEL_WORKBOOK_PATH",
    webUrl: "MICROSOFT_EXCEL_WORKBOOK_WEB_URL",
  },
  preview: {
    path: "MICROSOFT_EXCEL_WORKBOOK_PATH_PREVIEW",
    webUrl: "MICROSOFT_EXCEL_WORKBOOK_WEB_URL_PREVIEW",
  },
};

export const PREVIEW_WORKBOOK_REQUIRED_MESSAGE =
  "Excel sync refused: this is a preview deployment and no preview workbook is set. Add MICROSOFT_EXCEL_WORKBOOK_PATH_PREVIEW to the Vercel Preview environment. Preview never falls back to the production workbook.";

export function excelWorkbookScope(): ExcelWorkbookScope {
  return optionalEnv("VERCEL_ENV") === "preview" ? "preview" : "production";
}

export function excelWorkbookTarget(scope: ExcelWorkbookScope = excelWorkbookScope()): ExcelWorkbookTarget {
  const keys = WORKBOOK_ENV_BY_SCOPE[scope];
  return {
    scope,
    path: optionalEnv(keys.path).trim().replace(/^\/+/, ""),
    webUrl: optionalEnv(keys.webUrl).trim(),
  };
}

function scopedLabel(location: string, scope: ExcelWorkbookScope): string {
  return `${location || "unspecified"} (${scope})`;
}

export function excelWorkbookLabel(target: ExcelWorkbookTarget = excelWorkbookTarget()): string {
  return scopedLabel(target.path, target.scope);
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
    workbookPath: target.path,
    workbookLabel: excelWorkbookLabel(target),
    templatePath: optionalEnv("MICROSOFT_EXCEL_TEMPLATE_PATH").trim().replace(/^\/+/, ""),
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
  const common = Boolean(config.tenantId && config.clientId && config.userId && config.workbookPath && config.templatePath);
  if (!common) return false;
  return excelAuthDisclosure(config).authMode === "delegated" ? Boolean(config.refreshToken) : Boolean(config.clientSecret);
}

export function microsoftExcelWorkbookUrl(): string {
  return excelWorkbookTarget().webUrl;
}

function parentFolder(itemPath: string): string {
  const cut = itemPath.lastIndexOf("/");
  return cut === -1 ? "" : itemPath.slice(0, cut);
}

function fileName(itemPath: string): string {
  return itemPath.slice(itemPath.lastIndexOf("/") + 1);
}

function assertMicrosoftExcelConfig(): ExcelPrivateConfig {
  const config = excelPrivateConfig();
  const workbookPathKey = WORKBOOK_ENV_BY_SCOPE[config.workbookScope].path;
  // First, and before any network call, so an unconfigured preview can never be told to look at a
  // production path and can never reach Graph holding production's credentials.
  if (config.workbookScope === "preview" && !config.workbookPath) {
    throw new Error(PREVIEW_WORKBOOK_REQUIRED_MESSAGE);
  }
  const missing = (
    [
      ["MICROSOFT_TENANT_ID", config.tenantId],
      ["MICROSOFT_CLIENT_ID", config.clientId],
      ["MICROSOFT_EXCEL_USER_ID", config.userId],
      [workbookPathKey, config.workbookPath],
      ["MICROSOFT_EXCEL_TEMPLATE_PATH", config.templatePath],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => String(name));
  if (excelAuthDisclosure(config).authMode === "application" && !config.clientSecret) {
    missing.push("MICROSOFT_EXCEL_REFRESH_TOKEN (delegated) or MICROSOFT_CLIENT_SECRET (application)");
  }
  if (missing.length) {
    throw new Error(`Excel Online sync is not configured. Set ${missing.join(", ")} in Vercel.`);
  }
  if (!config.workbookPath.includes(MONTH_TOKEN)) {
    throw new Error(
      `${workbookPathKey} must contain the literal ${MONTH_TOKEN} token, for example "CWCA/Standards ${MONTH_TOKEN}.xlsx". Without it every month resolves to the same workbook.`,
    );
  }
  if (parentFolder(config.templatePath) !== parentFolder(config.workbookPath)) {
    throw new Error(
      `MICROSOFT_EXCEL_TEMPLATE_PATH and ${workbookPathKey} must name files in the same folder. Graph copies the template into the template's own folder, so the month workbook cannot land anywhere else.`,
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

export type MonthRange = {
  monthKey: string;
  from: string;
  to: string;
  daysInMonth: number;
};

function requestedDateKey(value: string | undefined, label: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (!DATE_KEY.test(trimmed)) throw new Error(`Excel sync needs a YYYY-MM-DD ${label} date, received ${trimmed}.`);
  return trimmed;
}

/** Resolved once per run. Every path below derives from the result, so a run that straddles
 *  midnight or a month boundary still writes one month into one workbook. */
export function resolveMonthRange(filters: DashboardFilters, now: Date): MonthRange {
  const today = chicagoDateKey(now);
  const from = requestedDateKey(filters.from, "from") || `${today.slice(0, 7)}-01`;
  const monthKey = from.slice(0, 7);
  const currentMonthKey = today.slice(0, 7);
  if (monthKey > currentMonthKey) {
    throw new Error(`Excel sync will not open a workbook for ${monthKey}: the current Chicago month is ${currentMonthKey}.`);
  }
  const daysInMonth = new Date(Date.UTC(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)), 0)).getUTCDate();
  const lastDayOfMonth = `${monthKey}-${String(daysInMonth).padStart(2, "0")}`;
  const requestedTo = requestedDateKey(filters.to, "to") || lastDayOfMonth;
  if (requestedTo.slice(0, 7) !== monthKey) {
    throw new Error(`Excel sync writes one month per workbook, so ${from} and ${requestedTo} cannot be synced in one run.`);
  }
  return {
    monthKey,
    from: `${monthKey}-01`,
    to: [requestedTo, today, lastDayOfMonth].sort()[0],
    daysInMonth,
  };
}

/** "CWCA/Standards {month}.xlsx" + "2026-08" -> "CWCA/Standards 2026-08.xlsx" */
export function monthWorkbookPath(pattern: string, monthKey: string): string {
  return pattern.split(MONTH_TOKEN).join(monthKey);
}

export const EXCEL_DATE_NUMBER_FORMAT = "yyyy-mm-dd";
const DATA_COLUMNS = "ABCDEFGHIJ";
const STAMP_COLUMN = DATA_COLUMNS.indexOf("J");

function blankRow(): Array<string | number> {
  return Array.from({ length: DATA_COLUMNS.length }, () => "");
}

function zeroRow(owner: string, dateKey: string): SheetDailyRow {
  return {
    owner,
    date: dateKey,
    sortDate: dateKey,
    newMatters: 0,
    attorneyCall: 0,
    welcome: 0,
    courtDate: 0,
    weeklyCheckIns: 0,
    completion: "",
  };
}

function dataRowValues(row: SheetDailyRow): Array<string | number> {
  const values = blankRow();
  values[0] = row.owner;
  values[1] = excelSerialFromDateKey(row.sortDate || row.date);
  values[2] = row.newMatters;
  values[3] = row.attorneyCall;
  values[4] = row.welcome;
  values[5] = row.courtDate;
  values[6] = row.weeklyCheckIns;
  values[7] = activityCompletion(row);
  return values;
}

/** The whole Data worksheet, regenerated from the database rows alone. The footprint is fixed for
 *  the month, so every case manager keeps the same block of rows from the 1st to the 31st and the
 *  template's formulas can address them. Same rows, range and now produce byte-identical output. */
export function buildDataSheet(
  rows: SheetDailyRow[],
  range: MonthRange,
  now: Date,
): { address: string; values: Array<Array<string | number>>; numberFormat: string[][] } {
  const byOwnerAndDate = new Map<string, SheetDailyRow>();
  for (const row of rows) {
    const dateKey = sheetDateKey(row.sortDate || row.date);
    if (dateKey) byOwnerAndDate.set(`${dateKey} ${row.owner}`, row);
  }
  const lastDayOfMonth = `${range.monthKey}-${String(range.daysInMonth).padStart(2, "0")}`;
  const monthDays = eachChicagoDateKey(range.from, lastDayOfMonth);
  const elapsed = new Set(eachChicagoDateKey(range.from, range.to));

  const header = blankRow();
  STANDARDS_SHEET_HEADERS.forEach((label, column) => {
    header[column] = label;
  });
  header[STAMP_COLUMN] = formatSheetStamp(now);

  const values: Array<Array<string | number>> = [header];
  for (const owner of STANDARD_CASE_MANAGERS) {
    for (const dateKey of monthDays) {
      if (!elapsed.has(dateKey)) {
        values.push(blankRow());
        continue;
      }
      values.push(dataRowValues(byOwnerAndDate.get(`${dateKey} ${owner}`) ?? zeroRow(owner, dateKey)));
    }
  }
  const numberFormat = values.map((row) =>
    row.map((_, column) => (column === 1 && typeof row[1] === "number" ? EXCEL_DATE_NUMBER_FORMAT : "General")),
  );
  return { address: `A1:${DATA_COLUMNS[DATA_COLUMNS.length - 1]}${values.length}`, values, numberFormat };
}

async function graphFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await requestMicrosoftExcelAccessToken();
  return fetch(`${GRAPH_ROOT}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

/** Everything the destination probe needs to decide the item is this month's workbook. */
const PROBE_SELECT = "?$select=id,name,file,size,remoteItem";

/** The item itself. Graph documents this bare form for reading an item by path, and `$select` is
 *  documented on it. Keep it separate from driveItemPath: a trailing colon is what introduces a
 *  relationship, and putting one immediately before a query string is not a shape Graph documents. */
function driveItemSelfPath(userId: string, itemPath: string): string {
  const encoded = itemPath.split("/").map(encodeURIComponent).join("/");
  return `/users/${encodeURIComponent(userId)}/drive/root:/${encoded}`;
}

/** The item, ready for a relationship to be appended: `:/copy`, `:/workbook/...`. */
function driveItemPath(userId: string, itemPath: string): string {
  return `${driveItemSelfPath(userId, itemPath)}:`;
}

type GraphErrorBody = {
  code?: string;
  message?: string;
  innerError?: GraphErrorBody;
  innererror?: GraphErrorBody;
  details?: GraphErrorBody[];
};

type GraphCopyMonitor = {
  status?: string;
  error?: GraphErrorBody;
};

/** Every code Graph nested anywhere in one error body, lowercased. Graph's own error guidance is to
 *  walk all the nested codes and use the most specific one understood, and it spells the nested
 *  object both `innerError` (in its examples) and `innererror` (in its schema), so read both. */
function graphErrorCodes(error: GraphErrorBody | undefined): string[] {
  if (!error) return [];
  return [
    String(error.code ?? "").toLowerCase(),
    ...graphErrorCodes(error.innerError),
    ...graphErrorCodes(error.innererror),
    ...(error.details ?? []).flatMap((detail) => graphErrorCodes(detail)),
  ].filter((code) => code !== "");
}

function copyHitAnExistingName(monitor: GraphCopyMonitor): boolean {
  return graphErrorCodes(monitor.error).includes("namealreadyexists");
}

/** Graph reports "a person has this workbook open for editing" as a SECOND-LEVEL code,
 *  `accessConflict` nested under a 409, which is precisely the shape a top-level `error.code` check
 *  cannot see. */
const WORKBOOK_LOCK_CODES = ["accessconflict", "invalidsessionaccessconflict"];

/** Why the workbook would not take the write, or "" if this was not a lock at all.
 *
 *  A matched code says a live editor. A bare 423 does not: OneDrive returns it for retention holds,
 *  sensitivity-label locks and checkouts too, and telling the operator to go and close a file they do
 *  not have open would send them the wrong way. Say what we actually know in each case.
 *
 *  Deliberately NOT treated as a lock: `genericFileOpenError`, which arrives as a 500 and is the
 *  common shape for a corrupt, unsupported or oversized workbook as well. Nothing documents it as a
 *  lock, so claiming one would be wrong more often than right. */
function workbookLockReason(status: number, body: string): string {
  let parsed: { error?: GraphErrorBody } = {};
  try {
    parsed = JSON.parse(body) as { error?: GraphErrorBody };
  } catch {
    parsed = {};
  }
  const matched = graphErrorCodes(parsed.error).find((code) => WORKBOOK_LOCK_CODES.includes(code));
  if (matched) return `another editor has it open (Graph answered ${status} ${matched})`;
  if (status === 423) {
    return "Graph answered 423, so the workbook is locked. That is usually a live editor, but a retention hold, a sensitivity label or a checkout reports the same way and will not clear on its own";
  }
  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A copy that did not plainly succeed leaves the workbook's existence UNKNOWN, and the old code read
 *  every such answer as "the workbook is missing". On 2026-08-22 the POST came back
 *  `500 generalException` while the month workbook was sitting in the drive, so the run failed with
 *  nothing wrong. Graph never said the workbook was absent; it said nothing about it at all.
 *
 *  Do not read the 500 as a disguised name conflict. Graph documents `generalException` as an
 *  unspecified error, and OneDrive for Business does report a real conflict plainly, as a 409 or as a
 *  monitor `nameAlreadyExists`. What the 500 meant is still unknown. What matters is that it is not
 *  evidence of absence, and neither is a monitor we cannot read or a poll that ran out of time. So
 *  resolve the unknown by asking the destination directly, and let the answer decide.
 *
 *  This is NOT the check-then-copy race that made the copy itself the existence check. That race
 *  needs the check to GATE the copy: two runs both read "absent", both copy, and the month ends up
 *  with two workbooks splitting the numbers. Here the probe runs only AFTER this run's single copy
 *  attempt has already failed, and nothing it returns can start a copy. One run still issues exactly
 *  one copy, so Graph's name uniqueness is still the only lock.
 *
 *  Absent, or an answer we cannot read, keeps the original failure: we never write into a workbook we
 *  could not confirm. */
async function monthWorkbookSurvivedAFailedCopy(
  config: ExcelPrivateConfig,
  workbookPath: string,
  failure: string,
): Promise<boolean> {
  const probe = await graphFetch(`${driveItemSelfPath(config.userId, workbookPath)}${PROBE_SELECT}`);
  if (!probe.ok) throw new ExcelWorkbookCopyError(failure);
  const item = (await probe.json().catch(() => ({}))) as { file?: unknown; remoteItem?: unknown; size?: unknown };
  // A real workbook sitting on this drive, not a folder, not a shortcut pointing at some other
  // drive's file, and not an empty stub left by a half-finished copy. Anything else and we cannot say
  // this is the month workbook, which is the one thing we must be sure of before writing into it.
  const isTheMonthWorkbook = Boolean(item.file) && !item.remoteItem && typeof item.size === "number" && item.size > 0;
  if (!isTheMonthWorkbook) throw new ExcelWorkbookCopyError(failure);
  console.info(`Excel sync: the copy of ${workbookPath} reported "${failure}", but the workbook is already there, so this run used it.`);
  return false;
}

async function awaitCopy(config: ExcelPrivateConfig, monitorUrl: string, workbookPath: string): Promise<boolean> {
  const deadline = Date.now() + COPY_POLL_TIMEOUT_MS;
  for (;;) {
    // The monitor lives on the drive's own SharePoint host, so the Graph bearer must not go with it.
    const response = await fetch(monitorUrl);
    if (!response.ok) {
      return monthWorkbookSurvivedAFailedCopy(config, workbookPath, `the copy monitor for ${workbookPath} answered ${response.status}`);
    }
    const monitor = (await response.json().catch(() => ({}))) as GraphCopyMonitor;
    const status = String(monitor.status ?? "").toLowerCase();
    if (status === "completed") return true;
    if (status === "failed") {
      if (copyHitAnExistingName(monitor)) return false;
      return monthWorkbookSurvivedAFailedCopy(
        config,
        workbookPath,
        `the copy of ${workbookPath} failed with ${monitor.error?.code ?? "an unnamed error"}`,
      );
    }
    if (Date.now() >= deadline) {
      return monthWorkbookSurvivedAFailedCopy(
        config,
        workbookPath,
        `the copy of ${workbookPath} was still ${status || "unreported"} after ${COPY_POLL_TIMEOUT_MS / 1000}s`,
      );
    }
    await sleep(COPY_POLL_INTERVAL_MS);
  }
}

/** Returns whether this run created the workbook. The copy is still the existence check, and this run
 *  still issues exactly one copy: asking first and then copying is a race, and two workbooks for one
 *  month split the numbers silently. Graph's own name uniqueness is the lock, and a name that is
 *  already taken is success — however Graph chooses to word that. A 404 names the template, because
 *  the POST addresses the template's own path; every other refusal is ambiguous about the
 *  destination, so it goes to the probe rather than straight to a hard failure. */
async function ensureMonthWorkbook(config: ExcelPrivateConfig, workbookPath: string): Promise<boolean> {
  const response = await graphFetch(`${driveItemPath(config.userId, config.templatePath)}/copy?@microsoft.graph.conflictBehavior=fail`, {
    method: "POST",
    body: JSON.stringify({ name: fileName(workbookPath) }),
  });
  if (response.status === 404) throw new ExcelTemplateMissingError(config.templatePath);
  if (!response.ok) {
    const failure = `Graph answered ${response.status} ${redactMicrosoftSecrets(await response.text()).slice(0, 300)}`;
    return monthWorkbookSurvivedAFailedCopy(config, workbookPath, failure);
  }
  const monitorUrl = response.headers.get("location") ?? "";
  if (!monitorUrl) {
    return monthWorkbookSurvivedAFailedCopy(config, workbookPath, `Graph accepted the copy of ${workbookPath} without a Location monitor URL`);
  }
  return awaitCopy(config, monitorUrl, workbookPath);
}

async function writeDataSheet(
  config: ExcelPrivateConfig,
  workbookPath: string,
  sheet: { address: string; values: Array<Array<string | number>>; numberFormat: string[][] },
): Promise<void> {
  const response = await graphFetch(
    `${driveItemPath(config.userId, workbookPath)}/workbook/worksheets('Data')/range(address='${sheet.address}')`,
    { method: "PATCH", body: JSON.stringify({ values: sheet.values, numberFormat: sheet.numberFormat }) },
  );
  if (!response.ok) {
    const body = redactMicrosoftSecrets(await response.text()).slice(0, 500);
    // The notice this reaches the operator through is cut at 240 characters, so a raw status plus a
    // JSON blob tells them nothing. Name the cause when we can actually identify it.
    const lockReason = workbookLockReason(response.status, body);
    if (lockReason) throw new ExcelWorkbookBusyError(workbookPath, lockReason);
    throw new Error(`Microsoft Graph could not write the Data worksheet of ${workbookPath}: ${response.status} ${body}`);
  }
}

export type ExcelSyncDeps = { reportRows?: typeof standardsReportRows; now?: Date };

export async function syncStandardsToMicrosoftExcel(
  filters: DashboardFilters = {},
  deps: ExcelSyncDeps = {},
): Promise<{
  workbookUrl: string;
  workbookPath: string;
  workbookScope: ExcelWorkbookScope;
  workbookTarget: string;
  workbookCreated: boolean;
  rowsSynced: number;
  month: string;
  authMode: ExcelAuthMode;
  authAccount: string;
}> {
  const config = assertMicrosoftExcelConfig();
  const disclosure = excelAuthDisclosure(config);
  if (disclosure.authMode === "delegated") {
    console.info(`Excel sync using delegated auth as ${disclosure.authAccount}`);
  } else {
    console.info("Excel sync using application client-credentials auth");
  }
  const now = deps.now ?? new Date();
  const range = resolveMonthRange(filters, now);
  const workbookPath = monthWorkbookPath(config.workbookPath, range.monthKey);
  const workbookCreated = await ensureMonthWorkbook(config, workbookPath);
  const rows = await (deps.reportRows ?? standardsReportRows)({ ...filters, from: range.from, to: range.to });
  const sheet = buildDataSheet(rows, range, now);
  await writeDataSheet(config, workbookPath, sheet);
  return {
    workbookUrl: microsoftExcelWorkbookUrl(),
    workbookPath,
    workbookScope: config.workbookScope,
    workbookTarget: scopedLabel(workbookPath, config.workbookScope),
    workbookCreated,
    rowsSynced: sheet.values.slice(1).filter((row) => row[0] !== "").length,
    month: range.monthKey,
    authMode: disclosure.authMode,
    authAccount: disclosure.authAccount,
  };
}
