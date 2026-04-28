/**
 * Clio Audit Engine
 *
 * Batched, resumable audit engine for Clio matters.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  getRecentMatters,
  getMatter,
  getMatterCalendarEntries,
  getMatterCommunications,
  getMatterDocuments,
} from './client'
import type {
  ClioMatter,
  ClioCalendarEntry,
  ClioAuditRun,
  ClioMatterAudit,
  MatterAuditStatus,
} from './types'
import { ClioRateLimitError } from './types'

interface ClioCommunication {
  id?: string | number
  type?: string | null
  subject?: string | null
  body?: string | null
  date?: string | null
  created_at?: string | null
  received_at?: string | null
  senders?: Array<{
    name?: string | null
    type?: string | null
    identifier?: string | null
  }> | null
  receivers?: Array<{
    name?: string | null
    type?: string | null
    identifier?: string | null
  }> | null
}

interface ClioDocument {
  id?: string | number
  name?: string | null
  filename?: string | null
  description?: string | null
  created_at?: string | null
  updated_at?: string | null
}

const DEFAULT_BATCH_SIZE = 20
const DEFAULT_TIME_WINDOW_DAYS = 14

const WELCOME_KEYWORDS = [
  'welcome packet',
  'welcome email',
  'welcome package',
  'client portal',
  'portal invite',
  'bienvenido',
  'bienvenida',
  'paquete de bienvenida',
  'correo de bienvenida',
]

const MEETING_KEYWORDS = [
  'phone',
  'call',
  'client-attorney',
  'attorney call',
  'meeting',
  'consultation',
  'zoom',
  'llamada',
  'telefono',
  'teléfono',
  'consulta',
  'reunion',
  'reunión',
]

const APPEARANCE_KEYWORDS = [
  'appearance filed',
  'your appearance has been filed',
  'notice of appearance',
  'filed appearance',
  'appearance',
  'court appearance has been filed',
  'notificacion de presentancion de corte',
  'notificación de presentación de corte',
  'comparecencia',
  'notificación de comparecencia',
]

const COURT_KEYWORDS = [
  'court',
  'hearing',
  'arraignment',
  'pretrial',
  'pre-trial',
  'trial',
  'status',
  'zoom',
  'in-person',
  'in person',
  'corte',
  'audiencia',
  'tribunal',
]

const COURT_REMINDER_KEYWORDS = [
  'inperson court reminder',
  'in-person court reminder',
  'zoom court reminder',
  'zoom court reminder & instructions',
  'recordatorio de audiencia presencial',
  'recordatorio de ausencia presencial',
  'recordatori e instrucciones para la audiencia por zoom',
  'recordatorio e instrucciones para la audiencia por zoom',
]

const RESULT_KEYWORDS = [
  'court result and next court date',
  'court results',
  'court result',
  'court update',
  'hearing update',
  'case update',
  'next court date',
  'final court result',
  'final court result - your representation has ended',
  'continued',
  'dismissed',
  'plea',
  'sentencing',
  'supervision',
  'motion',
  'order entered',
  'judge',
  'disposition',
  'resultado del juicio y proxima fecha de audiencia',
  'resultado del juicio y próxima fecha de audiencia',
  'resultado del juicio',
  'resultados de corte',
  'resultado de corte',
  'actualización de corte',
  'proxima corte',
  'próxima corte',
  'siguiente corte',
  'recordatorio final del caso',
  'recordatorio final del caso: su representacion a terminado',
  'recordatorio final del caso: su representación a terminado',
]

const RETAINER_KEYWORDS = [
  'retainer',
  'signed retainer',
  'fee agreement',
  'engagement letter',
  'contrato',
  'acuerdo de honorarios',
]

function safeDate(value?: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

function addDays(date: Date, days: number): Date {
  return addHours(date, days * 24)
}

function hoursDiff(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 36e5
}

function isWithinRange(date: Date | null, start: Date, end: Date): boolean {
  if (!date) return false
  return date >= start && date <= end
}

function includesAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase()
  return keywords.some((keyword) => lower.includes(keyword))
}

function communicationText(comm: ClioCommunication): string {
  return [
    comm.type,
    comm.subject,
    comm.body,
    comm.date,
    comm.created_at,
    comm.received_at,
    ...(comm.senders ?? []).map((p) => `${p.name ?? ''} ${p.type ?? ''} ${p.identifier ?? ''}`),
    ...(comm.receivers ?? []).map((p) => `${p.name ?? ''} ${p.type ?? ''} ${p.identifier ?? ''}`),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function calendarText(entry: ClioCalendarEntry): string {
  return `${entry.summary ?? ''} ${entry.description ?? ''}`.toLowerCase()
}

function communicationDate(comm: ClioCommunication): Date | null {
  return safeDate(comm.received_at ?? comm.created_at ?? comm.date)
}

function communicationDateString(comm?: ClioCommunication | null): string | null {
  if (!comm) return null
  return comm.received_at ?? comm.created_at ?? comm.date ?? null
}

function isCall(comm: ClioCommunication): boolean {
  const text = communicationText(comm)
  return (
    text.includes('call') ||
    text.includes('dialpad') ||
    text.includes('phone') ||
    text.includes('phonecommunication') ||
    text.includes('llamada')
  )
}

function isOutboundCall(comm: ClioCommunication): boolean {
  const text = communicationText(comm)
  return (
    text.includes('outbound call') ||
    text.includes('outbound via dialpad') ||
    text.includes('outbound') ||
    text.includes('outgoing') ||
    text.includes('called') ||
    text.includes('call duration') ||
    (isCall(comm) && !text.includes('inbound'))
  )
}

function isSms(comm: ClioCommunication): boolean {
  const text = communicationText(comm)
  return (
    text.includes('sms') ||
    text.includes('text message') ||
    text.includes('text') ||
    text.includes('mensaje')
  )
}

function isOutboundSms(comm: ClioCommunication): boolean {
  const text = communicationText(comm)
  return text.includes('outbound sms') || (isSms(comm) && (text.includes('outbound') || text.includes('sent')))
}

function isEmail(comm: ClioCommunication): boolean {
  const text = communicationText(comm)
  return text.includes('email') || text.includes('emailcommunication') || Boolean(comm.subject)
}

function isAttorneyPhoneEvent(entry: ClioCalendarEntry): boolean {
  const summary = entry.summary ?? ''
  const text = calendarText(entry)

  return (
    /^[A-Z]{2,4}\s*[-–—]\s*(PHONE|CALL|ZOOM|LLAMADA|TEL)/i.test(summary) ||
    includesAny(text, MEETING_KEYWORDS)
  )
}

function isCourtEvent(entry: ClioCalendarEntry): boolean {
  return includesAny(calendarText(entry), COURT_KEYWORDS)
}

function findCommunication(
  communications: ClioCommunication[],
  keywords: string[],
  start?: Date,
  end?: Date
): ClioCommunication | undefined {
  return communications.find((comm) => {
    const date = communicationDate(comm)
    if (start && end && !isWithinRange(date, start, end)) return false
    return includesAny(communicationText(comm), keywords)
  })
}

function findFirstOutboundCall(
  communications: ClioCommunication[],
  start: Date,
  end: Date
): ClioCommunication | undefined {
  return communications.find((comm) => {
    const date = communicationDate(comm)
    return isWithinRange(date, start, end) && isOutboundCall(comm)
  })
}

function findAnyClientContact(
  communications: ClioCommunication[],
  start: Date,
  end: Date
): ClioCommunication | undefined {
  return communications.find((comm) => {
    const date = communicationDate(comm)
    return isWithinRange(date, start, end)
  })
}

function findReminderBeforeCourt(
  courtDate: Date,
  communications: ClioCommunication[]
): ClioCommunication | undefined {
  const start = addDays(courtDate, -7)

  return communications.find((comm) => {
    const date = communicationDate(comm)
    return (
      isWithinRange(date, start, courtDate) &&
      (
        isOutboundCall(comm) ||
        isOutboundSms(comm) ||
        includesAny(communicationText(comm), COURT_REMINDER_KEYWORDS)
      )
    )
  })
}

function isLikelyResult(comm: ClioCommunication): boolean {
  const text = communicationText(comm)

  return (
    includesAny(text, RESULT_KEYWORDS) ||
    (
      isEmail(comm) &&
      (
        text.includes('court') ||
        text.includes('corte') ||
        text.includes('result') ||
        text.includes('resultado') ||
        text.includes('next court') ||
        text.includes('proxima') ||
        text.includes('próxima')
      )
    )
  )
}

function findResultsAfterCourt(
  courtDate: Date,
  communications: ClioCommunication[],
  maxDays = 14
): ClioCommunication | undefined {
  const end = addDays(courtDate, maxDays)

  return communications.find((comm) => {
    const date = communicationDate(comm)
    return isWithinRange(date, courtDate, end) && isLikelyResult(comm)
  })
}

function findCallAfter(
  afterDate: Date,
  communications: ClioCommunication[],
  hours = 48
): ClioCommunication | undefined {
  const end = addHours(afterDate, hours)

  return communications.find((comm) => {
    const date = communicationDate(comm)
    return isWithinRange(date, afterDate, end) && isOutboundCall(comm)
  })
}

export async function startAuditRun(
  batchSize = DEFAULT_BATCH_SIZE,
  timeWindowDays = DEFAULT_TIME_WINDOW_DAYS
): Promise<ClioAuditRun> {
  const supabase = createAdminClient()

  const toDate = new Date()
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - timeWindowDays)

  const matters = await getRecentMatters(fromDate, toDate)
  const matterIds = matters.map((m) => String(m.id))

  const { data, error } = await supabase
    .from('clio_audit_runs')
    .insert({
      status: 'pending',
      total_matters: matterIds.length,
      processed_matters: 0,
      current_batch: 0,
      batch_size: batchSize,
      time_window_days: timeWindowDays,
      matter_ids_to_process: matterIds,
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error || !data) {
    throw new Error(`Failed to create audit run: ${error?.message}`)
  }

  return data as ClioAuditRun
}

export async function getCurrentAuditRun(): Promise<ClioAuditRun | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('clio_audit_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) return null
  return data as ClioAuditRun
}

export async function getAuditRun(runId: string): Promise<ClioAuditRun | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('clio_audit_runs')
    .select('*')
    .eq('id', runId)
    .single()

  if (error || !data) return null
  return data as ClioAuditRun
}

async function updateAuditRun(runId: string, updates: Partial<ClioAuditRun>): Promise<void> {
  const supabase = createAdminClient()

  await supabase
    .from('clio_audit_runs')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
}

interface MatterAuditData {
  matter: ClioMatter
  calendarEntries: ClioCalendarEntry[]
  communications: ClioCommunication[]
  documents: ClioDocument[]
}

async function fetchMatterData(matterId: string, fromDate: Date, toDate: Date): Promise<MatterAuditData | null> {
  const matter = await getMatter(matterId)

  if (!matter) {
    console.error(`[Clio Audit] Matter not found: ${matterId}`)
    return null
  }

  const matterCreated = safeDate(matter.created_at) ?? fromDate
  const expandedFrom = addDays(matterCreated, -14)
  const expandedTo = addDays(new Date(), 30)

  const [calendarEntries, communications, documents] = await Promise.all([
    getMatterCalendarEntries(matterId, expandedFrom, expandedTo),
    getMatterCommunications(matterId, expandedFrom, expandedTo),
    getMatterDocuments(matterId),
  ])

  return {
    matter,
    calendarEntries: calendarEntries as ClioCalendarEntry[],
    communications: communications as ClioCommunication[],
    documents: documents as ClioDocument[],
  }
}

function checkIntakeCalendar(calendarEntries: ClioCalendarEntry[]): { exists: boolean; date: string | null } {
  const intakeKeywords = ['intake', 'add to calendar', 'new client', 'initial consultation', 'onboarding', 'nuevo cliente']

  const intakeEntry = calendarEntries.find((entry) => includesAny(calendarText(entry), intakeKeywords))

  return {
    exists: Boolean(intakeEntry),
    date: intakeEntry?.start_at || null,
  }
}

function checkMeetingScheduled(
  calendarEntries: ClioCalendarEntry[],
  matterCreatedAt: string
): { scheduled: boolean; withinDeadline: boolean; date: string | null; late: boolean } {
  const matterDate = safeDate(matterCreatedAt)
  if (!matterDate) return { scheduled: false, withinDeadline: false, date: null, late: false }

  const meetings = calendarEntries
    .filter((entry) => isAttorneyPhoneEvent(entry) && !isCourtEvent(entry))
    .sort((a, b) => (safeDate(a.start_at)?.getTime() ?? 0) - (safeDate(b.start_at)?.getTime() ?? 0))

  const firstMeeting = meetings[0]
  if (!firstMeeting) return { scheduled: false, withinDeadline: false, date: null, late: false }

  const meetingDate = safeDate(firstMeeting.start_at)
  const diff = meetingDate ? hoursDiff(matterDate, meetingDate) : null
  const withinDeadline = diff !== null && diff >= 0 && diff <= 48

  return {
    scheduled: true,
    withinDeadline,
    late: !withinDeadline,
    date: firstMeeting.start_at,
  }
}

function checkWelcomePacket(
  communications: ClioCommunication[],
  matterCreatedAt: string
): { sent: boolean; withinDeadline: boolean; late: boolean; date: string | null } {
  const matterDate = safeDate(matterCreatedAt)
  const email = findCommunication(communications, WELCOME_KEYWORDS)

  if (!email) return { sent: false, withinDeadline: false, late: false, date: null }

  const date = communicationDate(email)
  const diff = matterDate && date ? hoursDiff(matterDate, date) : null
  const withinDeadline = diff !== null && diff >= 0 && diff <= 72

  return {
    sent: true,
    withinDeadline,
    late: !withinDeadline,
    date: communicationDateString(email),
  }
}

function checkAppearanceEmail(
  communications: ClioCommunication[],
  matterCreatedAt: string
): { sent: boolean; withinDeadline: boolean; late: boolean; date: string | null } {
  const matterDate = safeDate(matterCreatedAt)
  const email = findCommunication(communications, APPEARANCE_KEYWORDS)

  if (!email) return { sent: false, withinDeadline: false, late: false, date: null }

  const date = communicationDate(email)
  const diff = matterDate && date ? hoursDiff(matterDate, date) : null
  const withinDeadline = diff !== null && diff >= 0 && diff <= 48

  return {
    sent: true,
    withinDeadline,
    late: !withinDeadline,
    date: communicationDateString(email),
  }
}

function checkFirstClientContact(
  communications: ClioCommunication[],
  matterCreatedAt: string
): { found: boolean; outboundCall: boolean; withinDeadline: boolean; date: string | null } {
  const matterDate = safeDate(matterCreatedAt)
  if (!matterDate) return { found: false, outboundCall: false, withinDeadline: false, date: null }

  const deadline = addHours(matterDate, 48)
  const anyContact = findAnyClientContact(communications, matterDate, deadline)
  const outboundCall = findFirstOutboundCall(communications, matterDate, deadline)

  return {
    found: Boolean(anyContact),
    outboundCall: Boolean(outboundCall),
    withinDeadline: Boolean(anyContact),
    date: communicationDateString(outboundCall ?? anyContact),
  }
}

function checkSignedRetainer(documents: ClioDocument[]): { exists: boolean; date: string | null } {
  const doc = documents.find((document) => {
    const text = [
      document.name,
      document.filename,
      document.description,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return includesAny(text, RETAINER_KEYWORDS)
  })

  return {
    exists: Boolean(doc),
    date: doc?.created_at || null,
  }
}

function auditCourtEvents(
  calendarEntries: ClioCalendarEntry[],
  communications: ClioCommunication[],
  flags: string[],
  missingItems: string[]
) {
  const courtEntries = calendarEntries.filter(isCourtEvent)

  courtEntries.forEach((entry) => {
    const courtDate = safeDate(entry.start_at)
    if (!courtDate) return

    const reminder = findReminderBeforeCourt(courtDate, communications)
    const results = findResultsAfterCourt(courtDate, communications, 14)
    const resultsDate = results ? communicationDate(results) : null
    const resultsWithin24h = resultsDate ? hoursDiff(courtDate, resultsDate) >= 0 && hoursDiff(courtDate, resultsDate) <= 24 : false
    const callAfterResults = resultsDate ? findCallAfter(resultsDate, communications, 48) : undefined

    if (!reminder) missingItems.push(`No reminder call/text before court date ${entry.start_at}`)

    if (!results) {
      missingItems.push(`Court results not found after court date ${entry.start_at}`)
    } else if (!resultsWithin24h) {
      flags.push(`Court results were sent late after court date ${entry.start_at}`)
    }

    if (results && !callAfterResults) {
      flags.push(`No outbound client call found after court results for ${entry.start_at}`)
    }
  })
}

function determineOverallStatus(audit: Partial<ClioMatterAudit>): MatterAuditStatus {
  const missing = audit.missing_items?.length ?? 0
  const flags = audit.flags?.length ?? 0

  if (missing >= 2) return 'missing_evidence'
  if (missing > 0 || flags > 0) return 'needs_review'
  return 'pass'
}

async function auditMatter(
  auditRunId: string,
  matterId: string,
  fromDate: Date,
  toDate: Date
): Promise<ClioMatterAudit | null> {
  const supabase = createAdminClient()

  const matterData = await fetchMatterData(matterId, fromDate, toDate)
  if (!matterData) return null

  const { matter, calendarEntries, communications, documents } = matterData
  const matterCreatedAt = matter.created_at

  const intakeCheck = checkIntakeCalendar(calendarEntries)
  const meetingCheck = checkMeetingScheduled(calendarEntries, matterCreatedAt)
  const welcomeCheck = checkWelcomePacket(communications, matterCreatedAt)
  const appearanceCheck = checkAppearanceEmail(communications, matterCreatedAt)
  const contactCheck = checkFirstClientContact(communications, matterCreatedAt)
  const retainerCheck = checkSignedRetainer(documents)

  const missingItems: string[] = []
  const flags: string[] = []

  if (!intakeCheck.exists) missingItems.push('Intake calendar entry not found')
  if (!meetingCheck.scheduled) missingItems.push('Client-attorney meeting not found')
  if (meetingCheck.scheduled && meetingCheck.late) flags.push('Client-attorney meeting scheduled late')
  if (!welcomeCheck.sent) missingItems.push('Welcome packet email not found')
  if (welcomeCheck.sent && welcomeCheck.late) flags.push('Welcome packet sent late')
  if (!contactCheck.found) missingItems.push('No client communication found within 48 hours')
  if (contactCheck.found && !contactCheck.outboundCall) flags.push('Client contact found within 48 hours, but no clear outbound call found')
  if (!appearanceCheck.sent) missingItems.push('Appearance filed email not found')
  if (appearanceCheck.sent && appearanceCheck.late) flags.push('Appearance email sent late')
  if (!retainerCheck.exists) missingItems.push('Signed retainer document not found')

  auditCourtEvents(calendarEntries, communications, flags, missingItems)

  const auditRecord: Partial<ClioMatterAudit> = {
    audit_run_id: auditRunId,
    matter_id: String(matter.id),
    matter_display_number: matter.display_number,
    client_name: matter.client?.name || null,
    attorney_name: matter.responsible_attorney?.name || null,
    matter_status: matter.status,
    matter_created_at: matterCreatedAt,

    intake_calendar_exists: intakeCheck.exists,
    intake_calendar_date: intakeCheck.date,
    matter_created_in_clio: true,

    meeting_scheduled_within_48h: meetingCheck.scheduled ? meetingCheck.withinDeadline : null,
    meeting_date: meetingCheck.date,

    welcome_packet_sent: welcomeCheck.sent,
    welcome_packet_date: welcomeCheck.date,

    appearance_filed_within_48h: appearanceCheck.sent ? appearanceCheck.withinDeadline : null,
    appearance_date: null,
    appearance_email_sent: appearanceCheck.sent,
    appearance_email_date: appearanceCheck.date,

    attorney_correctly_assigned: Boolean(matter.responsible_attorney),
    client_name_consistent: true,

    signed_retainer_exists: retainerCheck.exists,
    signed_retainer_date: retainerCheck.date,

    evidence: {
      calendar_entries_count: calendarEntries.length,
      communications_count: communications.length,
      documents_count: documents.length,
      intake_date: intakeCheck.date,
      meeting_date: meetingCheck.date,
      welcome_date: welcomeCheck.date,
      appearance_email_date: appearanceCheck.date,
      first_client_contact_date: contactCheck.date,
      retainer_date: retainerCheck.date,
      calendar_samples: calendarEntries.slice(0, 5).map((e) => e.summary),
      communication_samples: communications.slice(0, 5).map((c) => c.subject || c.type || c.body?.slice(0, 80)),
    },

    flags,
    missing_items: missingItems,
    notes: null,
    overall_status: 'pass',
  }

  auditRecord.overall_status = determineOverallStatus(auditRecord)

  const { data, error } = await supabase
    .from('clio_matter_audits')
    .insert(auditRecord)
    .select()
    .single()

  if (error) {
    console.error(`[Clio Audit] Failed to save audit for matter ${matterId}:`, error)
    return null
  }

  return data as ClioMatterAudit
}

export async function processBatch(
  auditRunId: string
): Promise<{ processed: number; rateLimited: boolean; error?: string }> {
  const auditRun = await getAuditRun(auditRunId)

  if (!auditRun) {
    return { processed: 0, rateLimited: false, error: 'Audit run not found' }
  }

  if (auditRun.status === 'completed' || auditRun.status === 'failed') {
    return { processed: 0, rateLimited: false, error: `Audit run is ${auditRun.status}` }
  }

  const toDate = new Date()
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - auditRun.time_window_days)

  const matterIds = auditRun.matter_ids_to_process || []
  const startIdx = auditRun.processed_matters
  const endIdx = Math.min(startIdx + auditRun.batch_size, matterIds.length)
  const batchMatterIds = matterIds.slice(startIdx, endIdx)

  if (batchMatterIds.length === 0) {
    await updateAuditRun(auditRunId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    return { processed: 0, rateLimited: false }
  }

  await updateAuditRun(auditRunId, { status: 'in_progress' })

  let processedCount = 0

  try {
    for (const matterId of batchMatterIds) {
      try {
        await auditMatter(auditRunId, matterId, fromDate, toDate)
        processedCount++

        await updateAuditRun(auditRunId, {
          processed_matters: startIdx + processedCount,
          last_processed_matter_id: matterId,
          current_batch: auditRun.current_batch + 1,
        })
      } catch (error) {
        if (error instanceof ClioRateLimitError) {
          await updateAuditRun(auditRunId, {
            status: 'rate_limited',
            rate_limit_reset_at: error.resetAt?.toISOString() || null,
            error_message: 'Clio API rate limit exceeded',
          })
          return { processed: processedCount, rateLimited: true }
        }

        console.error(`[Clio Audit] Error auditing matter ${matterId}:`, error)
      }
    }

    const newProcessedCount = startIdx + processedCount

    if (newProcessedCount >= matterIds.length) {
      await updateAuditRun(auditRunId, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        processed_matters: newProcessedCount,
      })
    }

    return { processed: processedCount, rateLimited: false }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    if (error instanceof ClioRateLimitError) {
      await updateAuditRun(auditRunId, {
        status: 'rate_limited',
        rate_limit_reset_at: error.resetAt?.toISOString() || null,
        error_message: 'Clio API rate limit exceeded',
      })
      return { processed: processedCount, rateLimited: true }
    }

    await updateAuditRun(auditRunId, {
      status: 'failed',
      error_message: errorMessage,
    })

    return { processed: processedCount, rateLimited: false, error: errorMessage }
  }
}

export async function getAuditResults(auditRunId: string): Promise<ClioMatterAudit[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('clio_matter_audits')
    .select('*')
    .eq('audit_run_id', auditRunId)
    .order('created_at', { ascending: true })

  if (error || !data) return []
  return data as ClioMatterAudit[]
}

export async function getAuditSummary(
  auditRunId: string
): Promise<{ total: number; pass: number; needs_review: number; missing_evidence: number }> {
  const results = await getAuditResults(auditRunId)

  return {
    total: results.length,
    pass: results.filter((r) => r.overall_status === 'pass').length,
    needs_review: results.filter((r) => r.overall_status === 'needs_review').length,
    missing_evidence: results.filter((r) => r.overall_status === 'missing_evidence').length,
  }
}