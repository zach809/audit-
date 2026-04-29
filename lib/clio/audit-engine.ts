// lib/clio/audit-engine.ts

import {
  ClioMatter,
  ClioCalendarEntry,
  ClioCommunication,
  ClioNote,
} from "./types"

export type AuditStatus = "Pass" | "Flag"
export type YesNoNA = "Yes" | "No" | "N/A"

export type MissingItemType =
  | "Attorney Call"
  | "Court Reminder/Court Date"
  | "Welcome Packet"
  | "Client Contact"
  | "Appearance Filing Email"
  | "Court Results Email"
  | "Court Results Notes"
  | "Next Court Date"
  | "Late Court Results"
  | "Matter Data"
  | "Attorney-Client Meeting"
  | "Scheduled Call"

export type MatterAuditBundle = {
  matter: ClioMatter
  calendarEntries: ClioCalendarEntry[]
  communications: ClioCommunication[]
  notes: ClioNote[]
}

export type ScheduledEvent = {
  id: string
  summary: string
  startAt: string
  endAt: string
  attendees: string[]
  type: 'meeting' | 'call' | 'court' | 'other'
}

export type AuditRow = {
  id: string

  clientName: string
  matterNumber: string
  responsibleAttorney: string
  matterCreatedAt: string

  attorneyCallScheduledWithin15Minutes: YesNoNA
  courtDateWithin15Minutes: YesNoNA
  welcomePacketSentWithin15Minutes: YesNoNA

  clientContactWithin24Hours: YesNoNA
  appearanceFilingEmailWithin24Hours: YesNoNA

  courtDate: string
  courtResultsEmailSent: YesNoNA
  courtResultsSentWithin24Hours: YesNoNA
  courtResultsDocumentedInNotes: YesNoNA
  resultSentTimestamp: string
  nextCourtDateAdded: YesNoNA

  // New calendar tracking fields
  hasAttorneyClientMeeting: YesNoNA
  hasScheduledCall: YesNoNA
  scheduledEvents: ScheduledEvent[]
  upcomingMeetings: ScheduledEvent[]
  upcomingCalls: ScheduledEvent[]

  status: AuditStatus
  missingItemTypes: MissingItemType[]
  notes: string
}

const FIFTEEN_MIN = 15 * 60 * 1000
const DAY_24 = 24 * 60 * 60 * 1000

const lower = (v: any) => (v ? String(v).toLowerCase() : "")

const toDate = (v?: string) => {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

const format = (v?: string) => {
  const d = toDate(v)
  return d ? d.toLocaleString() : ""
}

const getClient = (m: ClioMatter) =>
  m.client?.name ||
  [m.client?.first_name, m.client?.last_name].filter(Boolean).join(" ") ||
  "Unknown Client"

const getMatterNum = (m: ClioMatter) =>
  m.display_number || String(m.id || "")

const getAttorney = (m: ClioMatter) =>
  m.responsible_attorney?.name || "Unassigned"

const textCalendar = (e: ClioCalendarEntry) =>
  [e.summary, e.description].map(lower).join(" ")

const textComm = (c: ClioCommunication) =>
  [c.subject, c.body].map(lower).join(" ")

const textNote = (n: ClioNote) =>
  [n.detail, (n as any).subject].map(lower).join(" ")

const hasKeyword = (text: string, keys: string[]) =>
  keys.some(k => text.includes(k))

const within = (target?: string, base?: Date, ms?: number) => {
  const d = toDate(target)
  if (!d || !base || !ms) return false
  const diff = d.getTime() - base.getTime()
  return diff >= 0 && diff <= ms
}

const findComm = (comms: ClioCommunication[], keys: string[], base?: Date, ms?: number) => {
  return comms.find(c => {
    if (!hasKeyword(textComm(c), keys)) return false
    if (base && ms) return within(c.created_at, base, ms)
    return true
  }) || null
}

const findCal = (cal: ClioCalendarEntry[], keys: string[], base?: Date, ms?: number) => {
  return cal.find(e => {
    if (!hasKeyword(textCalendar(e), keys)) return false
    if (base && ms) return within(e.start_at, base, ms)
    return true
  }) || null
}

const findNote = (notes: ClioNote[], keys: string[]) => {
  return notes.find(n => hasKeyword(textNote(n), keys)) || null
}

const getCourtEvents = (cal: ClioCalendarEntry[]) =>
  cal.filter(e =>
    hasKeyword(textCalendar(e), [
      "court",
      "hearing",
      "trial",
      "corte",
    ])
  )

// Detect attorney-client meetings
const getMeetingEvents = (cal: ClioCalendarEntry[]) =>
  cal.filter(e =>
    hasKeyword(textCalendar(e), [
      "meeting",
      "consultation",
      "consult",
      "intake",
      "appointment",
      "reunion",
      "cita",
      "zoom",
      "teams",
      "video",
    ])
  )

// Detect scheduled calls (phone calls, callbacks)
const getCallEvents = (cal: ClioCalendarEntry[]) =>
  cal.filter(e =>
    hasKeyword(textCalendar(e), [
      "call",
      "phone",
      "callback",
      "llamada",
      "telefono",
      "follow-up call",
      "follow up call",
    ])
  )

// Categorize calendar event type
const categorizeEvent = (e: ClioCalendarEntry): ScheduledEvent['type'] => {
  const text = textCalendar(e)
  if (hasKeyword(text, ["court", "hearing", "trial", "corte"])) return 'court'
  if (hasKeyword(text, ["meeting", "consultation", "consult", "intake", "appointment", "reunion", "cita", "zoom", "teams", "video"])) return 'meeting'
  if (hasKeyword(text, ["call", "phone", "callback", "llamada", "telefono"])) return 'call'
  return 'other'
}

// Convert ClioCalendarEntry to ScheduledEvent
const toScheduledEvent = (e: ClioCalendarEntry): ScheduledEvent => ({
  id: String(e.id),
  summary: e.summary || 'Untitled Event',
  startAt: e.start_at || '',
  endAt: e.end_at || '',
  attendees: (e.attendees || []).map(a => a.name || 'Unknown').filter(Boolean),
  type: categorizeEvent(e),
})

// Get upcoming events (future only)
const getUpcomingEvents = (events: ClioCalendarEntry[]): ScheduledEvent[] => {
  const now = new Date()
  return events
    .filter(e => {
      const start = toDate(e.start_at)
      return start && start > now
    })
    .map(toScheduledEvent)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
}

export function auditMatterBundle(bundle: MatterAuditBundle): AuditRow[] {
  const m = bundle.matter
  const created = toDate(m.created_at)

  if (!created) {
    return [{
      id: `${m?.id || "unknown"}-missing-created`,
      clientName: getClient(m),
      matterNumber: getMatterNum(m),
      responsibleAttorney: getAttorney(m),
      matterCreatedAt: "",
      attorneyCallScheduledWithin15Minutes: "N/A",
      courtDateWithin15Minutes: "N/A",
      welcomePacketSentWithin15Minutes: "N/A",
      clientContactWithin24Hours: "N/A",
      appearanceFilingEmailWithin24Hours: "N/A",
      courtDate: "",
      courtResultsEmailSent: "N/A",
      courtResultsSentWithin24Hours: "N/A",
      courtResultsDocumentedInNotes: "N/A",
      resultSentTimestamp: "",
      nextCourtDateAdded: "N/A",
      hasAttorneyClientMeeting: "N/A",
      hasScheduledCall: "N/A",
      scheduledEvents: [],
      upcomingMeetings: [],
      upcomingCalls: [],
      status: "Flag",
      missingItemTypes: ["Matter Data"],
      notes: "Missing created_at",
    }]
  }

  const cal = bundle.calendarEntries
  const comm = bundle.communications
  const notes = bundle.notes

  const attorneyCall = findCal(cal, ["call", "phone"], created, FIFTEEN_MIN)
  const courtEarly = findCal(cal, ["court", "hearing"], created, FIFTEEN_MIN)
  const welcome = findComm(comm, ["welcome"], created, FIFTEEN_MIN)

  const contact = findComm(comm, ["call", "voicemail"], created, DAY_24)
  const appearance = findComm(comm, ["appearance"], created, DAY_24)

  // Get all meeting and call events
  const meetingEvents = getMeetingEvents(cal)
  const callEvents = getCallEvents(cal)
  const courtEvents = getCourtEvents(cal)
  
  // Get upcoming meetings and calls
  const upcomingMeetings = getUpcomingEvents(meetingEvents)
  const upcomingCalls = getUpcomingEvents(callEvents)
  
  // All scheduled events for display
  const allScheduledEvents = cal.map(toScheduledEvent)
  
  const hasMeeting = meetingEvents.length > 0
  const hasCall = callEvents.length > 0

  const baseMissing: MissingItemType[] = []

  if (!attorneyCall) baseMissing.push("Attorney Call")
  if (!courtEarly) baseMissing.push("Court Reminder/Court Date")
  if (!welcome) baseMissing.push("Welcome Packet")
  if (!contact) baseMissing.push("Client Contact")
  if (!appearance) baseMissing.push("Appearance Filing Email")
  if (!hasMeeting) baseMissing.push("Attorney-Client Meeting")
  if (!hasCall) baseMissing.push("Scheduled Call")

  if (!courtEvents.length) {
    return [{
      id: `${m.id}-base`,
      clientName: getClient(m),
      matterNumber: getMatterNum(m),
      responsibleAttorney: getAttorney(m),
      matterCreatedAt: format(m.created_at),
      attorneyCallScheduledWithin15Minutes: attorneyCall ? "Yes" : "No",
      courtDateWithin15Minutes: courtEarly ? "Yes" : "No",
      welcomePacketSentWithin15Minutes: welcome ? "Yes" : "No",
      clientContactWithin24Hours: contact ? "Yes" : "No",
      appearanceFilingEmailWithin24Hours: appearance ? "Yes" : "No",
      courtDate: "",
      courtResultsEmailSent: "N/A",
      courtResultsSentWithin24Hours: "N/A",
      courtResultsDocumentedInNotes: "N/A",
      resultSentTimestamp: "",
      nextCourtDateAdded: "N/A",
      hasAttorneyClientMeeting: hasMeeting ? "Yes" : "No",
      hasScheduledCall: hasCall ? "Yes" : "No",
      scheduledEvents: allScheduledEvents,
      upcomingMeetings,
      upcomingCalls,
      status: baseMissing.length ? "Flag" : "Pass",
      missingItemTypes: baseMissing,
      notes: baseMissing.join(", ") || "OK",
    }]
  }

  return courtEvents.map((e, i) => {
    const courtDate = toDate(e.start_at)

    const resultEmail = findComm(comm, ["result", "resultado"])
    const resultNote = findNote(notes, ["result", "resultado"])

    const late =
      resultEmail && courtDate
        ? !within(resultEmail.created_at, courtDate, DAY_24)
        : true

    const missing = [...baseMissing]

    if (!resultEmail) missing.push("Court Results Email")
    if (!resultNote) missing.push("Court Results Notes")
    if (late) missing.push("Late Court Results")

    return {
      id: `${m.id}-court-${i}`,
      clientName: getClient(m),
      matterNumber: getMatterNum(m),
      responsibleAttorney: getAttorney(m),
      matterCreatedAt: format(m.created_at),

      attorneyCallScheduledWithin15Minutes: attorneyCall ? "Yes" : "No",
      courtDateWithin15Minutes: courtEarly ? "Yes" : "No",
      welcomePacketSentWithin15Minutes: welcome ? "Yes" : "No",

      clientContactWithin24Hours: contact ? "Yes" : "No",
      appearanceFilingEmailWithin24Hours: appearance ? "Yes" : "No",

      courtDate: format(e.start_at),
      courtResultsEmailSent: resultEmail ? "Yes" : "No",
      courtResultsSentWithin24Hours: late ? "No" : "Yes",
      courtResultsDocumentedInNotes: resultNote ? "Yes" : "No",
      resultSentTimestamp: format(resultEmail?.created_at),
      nextCourtDateAdded: "N/A",

      hasAttorneyClientMeeting: hasMeeting ? "Yes" : "No",
      hasScheduledCall: hasCall ? "Yes" : "No",
      scheduledEvents: allScheduledEvents,
      upcomingMeetings,
      upcomingCalls,

      status: missing.length ? "Flag" : "Pass",
      missingItemTypes: missing,
      notes: missing.join(", ") || "OK",
    }
  })
}

export function auditMatterBundles(bundles: MatterAuditBundle[]): AuditRow[] {
  return bundles.flatMap(bundle => auditMatterBundle(bundle))
}

export type AuditSummary = {
  total: number
  passed: number
  flagged: number
  missingByType: Record<MissingItemType, number>
}

export function summarizeAuditRows(rows: AuditRow[]): AuditSummary {
  const missingByType: Record<string, number> = {}

  for (const row of rows) {
    for (const item of row.missingItemTypes) {
      missingByType[item] = (missingByType[item] || 0) + 1
    }
  }

  return {
    total: rows.length,
    passed: rows.filter(r => r.status === "Pass").length,
    flagged: rows.filter(r => r.status === "Flag").length,
    missingByType: missingByType as Record<MissingItemType, number>,
  }
}
