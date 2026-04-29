export type ClioMatter = {
  id: string | number
  display_number?: string
  description?: string
  status?: string
  created_at?: string
  updated_at?: string

  client?: {
    id?: string | number
    name?: string
    first_name?: string
    last_name?: string
    primary_email_address?: string
    primary_phone_number?: string
  }

  custom_field_values?: any[]
  relationships?: any[]
  calendar_entries?: any[]
  communications?: any[]
  notes?: any[]
  tasks?: any[]
}

export type AuditIssueSeverity = "pass" | "warning" | "critical"

export type AuditIssue = {
  code: string
  title: string
  severity: AuditIssueSeverity
  message: string
}

export type AuditResult = {
  matterId: string
  matterNumber?: string
  clientName: string
  matterDescription?: string
  createdAt?: string
  status?: string
  passed: boolean
  issues: AuditIssue[]
}

export type AuditSummary = {
  totalMatters: number
  passedMatters: number
  flaggedMatters: number
  criticalIssues: number
  warningIssues: number
  totalIssues: number
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return ""
  return String(value).toLowerCase()
}

function getClientName(matter: ClioMatter): string {
  const client = matter.client

  if (!client) return "Unknown Client"

  if (client.name) return client.name

  const fullName = [client.first_name, client.last_name]
    .filter(Boolean)
    .join(" ")
    .trim()

  return fullName || "Unknown Client"
}

function daysSince(dateValue?: string): number | null {
  if (!dateValue) return null

  const date = new Date(dateValue)

  if (Number.isNaN(date.getTime())) return null

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()

  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

function hoursSince(dateValue?: string): number | null {
  if (!dateValue) return null

  const date = new Date(dateValue)

  if (Number.isNaN(date.getTime())) return null

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()

  return Math.floor(diffMs / (1000 * 60 * 60))
}

function arrayText(items?: any[]): string {
  if (!Array.isArray(items)) return ""

  return items
    .map((item) => JSON.stringify(item))
    .join(" ")
    .toLowerCase()
}

function hasCalendarEvent(matter: ClioMatter, keywords: string[]): boolean {
  const text = arrayText(matter.calendar_entries)

  return keywords.some((keyword) => text.includes(keyword.toLowerCase()))
}

function hasCommunication(matter: ClioMatter, keywords: string[]): boolean {
  const text = arrayText(matter.communications)

  return keywords.some((keyword) => text.includes(keyword.toLowerCase()))
}

function hasNote(matter: ClioMatter, keywords: string[]): boolean {
  const text = arrayText(matter.notes)

  return keywords.some((keyword) => text.includes(keyword.toLowerCase()))
}

function hasTask(matter: ClioMatter, keywords: string[]): boolean {
  const text = arrayText(matter.tasks)

  return keywords.some((keyword) => text.includes(keyword.toLowerCase()))
}

function addIssue(
  issues: AuditIssue[],
  code: string,
  title: string,
  severity: AuditIssueSeverity,
  message: string
) {
  issues.push({
    code,
    title,
    severity,
    message,
  })
}

export function auditMatter(matter: ClioMatter): AuditResult {
  const issues: AuditIssue[] = []

  const matterId = String(matter.id)
  const clientName = getClientName(matter)

  const createdHoursAgo = hoursSince(matter.created_at)
  const createdDaysAgo = daysSince(matter.created_at)

  const statusText = toText(matter.status)

  const hasWelcomePacket = hasCommunication(matter, [
    "welcome packet",
    "welcome email",
    "bienvenido",
    "paquete de bienvenida",
  ])

  const hasAttorneyCall = hasCalendarEvent(matter, [
    "phone",
    "call",
    "client-attorney",
    "attorney call",
    "mf-phone",
    "meeting",
    "consulta",
    "llamada",
  ])

  const hasCourtDate = hasCalendarEvent(matter, [
    "court",
    "hearing",
    "zoom",
    "trial",
    "pretrial",
    "arraignment",
    "status",
    "corte",
    "audiencia",
  ])

  const hasCourtReminder = hasCalendarEvent(matter, [
    "court",
    "hearing",
    "zoom",
    "corte",
    "audiencia",
  ])

  const hasAppearanceFiled = hasCommunication(matter, [
    "appearance",
    "filed appearance",
    "notice of appearance",
    "entry of appearance",
    "comparecencia",
  ])

  const hasCourtResultSent = hasCommunication(matter, [
    "court result",
    "results from court",
    "resultado",
    "resultados de corte",
  ])

  const hasCourtResultNote = hasNote(matter, [
    "court result",
    "results from court",
    "resultado",
    "resultados de corte",
  ])

  const hasClientContact = hasCommunication(matter, [
    "called client",
    "spoke with client",
    "left voicemail",
    "voicemail",
    "client contacted",
    "llamé",
    "llamada",
    "mensaje de voz",
  ])

  if (!matter.id) {
    addIssue(
      issues,
      "MISSING_MATTER_ID",
      "Missing matter ID",
      "critical",
      "This matter is missing an ID."
    )
  }

  if (clientName === "Unknown Client") {
    addIssue(
      issues,
      "MISSING_CLIENT_NAME",
      "Missing client name",
      "critical",
      "No client name was found on this matter."
    )
  }

  if (!matter.created_at) {
    addIssue(
      issues,
      "MISSING_CREATED_DATE",
      "Missing created date",
      "warning",
      "This matter does not have a created date."
    )
  }

  if (statusText && !["open", "active", "pending"].some((s) => statusText.includes(s))) {
    addIssue(
      issues,
      "MATTER_NOT_OPEN",
      "Matter may not be open",
      "warning",
      `Matter status is "${matter.status}".`
    )
  }

  if (createdHoursAgo !== null && createdHoursAgo >= 0 && createdHoursAgo <= 24) {
    if (!hasWelcomePacket) {
      addIssue(
        issues,
        "WELCOME_PACKET_MISSING",
        "Welcome packet not found",
        "critical",
        "No welcome packet or welcome email was found in communications."
      )
    }

    if (!hasAttorneyCall) {
      addIssue(
        issues,
        "ATTORNEY_CALL_MISSING",
        "Client-attorney call not scheduled",
        "critical",
        "No client-attorney call/calendar meeting was found."
      )
    }

    if (!hasCourtReminder) {
      addIssue(
        issues,
        "COURT_REMINDER_MISSING",
        "Court reminder/date missing",
        "critical",
        "No court date, hearing, Zoom, or court reminder was found on the calendar."
      )
    }
  }

  if (createdHoursAgo !== null && createdHoursAgo >= 24) {
    if (!hasClientContact) {
      addIssue(
        issues,
        "CLIENT_CONTACT_MISSING",
        "Client contact not confirmed",
        "warning",
        "No communication showing client contact, call, or voicemail was found within the expected workflow."
      )
    }

    if (!hasAppearanceFiled) {
      addIssue(
        issues,
        "APPEARANCE_NOT_FILED",
        "Appearance filing not found",
        "critical",
        "No communication/template showing that the appearance was filed was found."
      )
    }
  }

  if (createdHoursAgo !== null && createdHoursAgo >= 48 && !hasAppearanceFiled) {
    addIssue(
      issues,
      "APPEARANCE_OVERDUE_48_HOURS",
      "Appearance overdue",
      "critical",
      "This matter appears to be more than 48 hours old and no appearance filing was found."
    )
  }

  if (hasCourtDate && !hasCourtResultSent) {
    addIssue(
      issues,
      "COURT_RESULT_NOT_SENT",
      "Court result email not found",
      "warning",
      "A court date exists, but no court result email/template was found."
    )
  }

  if (hasCourtDate && !hasCourtResultNote) {
    addIssue(
      issues,
      "COURT_RESULT_NOTE_MISSING",
      "Court result not in matter notes",
      "warning",
      "A court date exists, but no matching court result note was found in matter notes."
    )
  }

  if (hasCourtResultSent && !hasCourtResultNote) {
    addIssue(
      issues,
      "RESULT_SENT_BUT_NOT_NOTED",
      "Court result sent but not noted",
      "warning",
      "Court result communication exists, but the result was not found in matter notes."
    )
  }

  if (hasCourtResultNote && !hasCourtResultSent) {
    addIssue(
      issues,
      "RESULT_NOTED_BUT_NOT_SENT",
      "Court result noted but not sent",
      "warning",
      "Court result appears in notes, but no client-facing result communication was found."
    )
  }

  return {
    matterId,
    matterNumber: matter.display_number,
    clientName,
    matterDescription: matter.description,
    createdAt: matter.created_at,
    status: matter.status,
    passed: issues.length === 0,
    issues,
  }
}

export function runAudit(matters: ClioMatter[]): AuditResult[] {
  if (!Array.isArray(matters)) return []

  return matters.map(auditMatter)
}

export function summarizeAudit(results: AuditResult[]): AuditSummary {
  const safeResults = Array.isArray(results) ? results : []

  let criticalIssues = 0
  let warningIssues = 0

  for (const result of safeResults) {
    for (const issue of result.issues || []) {
      if (issue.severity === "critical") criticalIssues += 1
      if (issue.severity === "warning") warningIssues += 1
    }
  }

  return {
    totalMatters: safeResults.length,
    passedMatters: safeResults.filter((result) => result.passed).length,
    flaggedMatters: safeResults.filter((result) => !result.passed).length,
    criticalIssues,
    warningIssues,
    totalIssues: criticalIssues + warningIssues,
  }
}

export function getFlaggedResults(results: AuditResult[]): AuditResult[] {
  if (!Array.isArray(results)) return []

  return results.filter((result) => !result.passed)
}

export function getCriticalResults(results: AuditResult[]): AuditResult[] {
  if (!Array.isArray(results)) return []

  return results.filter((result) =>
    result.issues.some((issue) => issue.severity === "critical")
  )
}

export function getWarningResults(results: AuditResult[]): AuditResult[] {
  if (!Array.isArray(results)) return []

  return results.filter((result) =>
    result.issues.some((issue) => issue.severity === "warning")
  )
}