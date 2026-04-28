import { createClient } from '@/lib/supabase/server'
import type { AuditResult, EmailType, AuditStatus, AttorneyAssignment } from '@/lib/types'

interface EmailThread {
  id: string
  subject: string
  messages: {
    id: string
    from: string
    to: string
    date: string
    body: string
    snippet: string
  }[]
}

async function getAttorneyAssignments(): Promise<Map<string, AttorneyAssignment>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('attorney_assignments').select('*')

  if (error) {
    console.error('Failed to fetch attorney assignments:', error)
  }

  const map = new Map<string, AttorneyAssignment>()

  data?.forEach((assignment) => {
    map.set(assignment.attorney_name.toLowerCase(), assignment)
  })

  return map
}

function lower(value?: string | null): string {
  return value?.toLowerCase() ?? ''
}

function includesAny(text: string, keywords: string[]): boolean {
  const value = lower(text)
  return keywords.some((keyword) => value.includes(keyword))
}

function messageText(message: EmailThread['messages'][number]): string {
  return `${message.from ?? ''} ${message.to ?? ''} ${message.body ?? ''} ${message.snippet ?? ''}`
}

function calculateResponseTime(
  originalTimestamp: string | null,
  replyTimestamp: string | null
): number | null {
  if (!originalTimestamp || !replyTimestamp) return null

  const originalDate = new Date(originalTimestamp)
  const replyDate = new Date(replyTimestamp)

  if (Number.isNaN(originalDate.getTime()) || Number.isNaN(replyDate.getTime())) return null

  return Math.round((replyDate.getTime() - originalDate.getTime()) / (1000 * 60))
}

function extractDate(text: string): string | null {
  const match = text.match(
    /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\w+\s+\d{1,2},?\s+\d{4})\b/i
  )

  if (!match) return null

  const date = new Date(match[0])
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function extractClientName(subject: string, body: string): string | null {
  const text = `${subject}\n${body}`

  const clientMatch = text.match(
    /client[:\s]+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'-]+(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ'-]+){1,4})/i
  )

  if (clientMatch) return clientMatch[1].trim()

  const subjectMatch = subject.match(/(?:re:)?\s*([^|:-]{3,80})/i)
  if (subjectMatch) return subjectMatch[1].trim()

  return null
}

function detectAttorneyFromThread(
  thread: EmailThread,
  assignments: Map<string, AttorneyAssignment>
): string | null {
  const allText = `${thread.subject} ${thread.messages
    .map((message) => `${message.from} ${messageText(message)}`)
    .join(' ')}`.toLowerCase()

  for (const assignment of assignments.values()) {
    if (allText.includes(assignment.attorney_name.toLowerCase())) {
      return assignment.attorney_name
    }
  }

  const firstFrom = thread.messages[0]?.from
  return firstFrom?.split('@')[0]?.replace(/[._]/g, ' ') ?? null
}

function findCaseManagerReply(thread: EmailThread): EmailThread['messages'][number] | null {
  const messages = [...thread.messages].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )

  const first = messages[0]
  if (!first) return null

  return messages.slice(1).find((message) => message.from !== first.from) ?? null
}

function defaultResult(overrides: Partial<AuditResult>): AuditResult {
  return {
    client_name: null,
    attorney: null,
    county: null,
    case_number: null,
    next_court_date: null,
    result_or_onboarding_details: null,
    attorney_instructions: null,
    case_manager_reply: null,
    actual_replier: null,
    is_reply_specific: false,
    missing_or_unclear: null,
    audit_status: 'needs_follow_up',
    flags: [],
    notes_for_zach: null,
    response_time_minutes: null,
    original_email_timestamp: null,
    reply_timestamp: null,
    court_results_details: null,
    confirmation_status: null,
    is_overdue: false,
    people_involved: null,
    onboarding_status: null,
    initial_calendar_entry: null,
    ...overrides,
  }
}

const CONFIRMED_CLIENT_UPDATE = [
  'client notified',
  'notified client',
  'client updated',
  'updated client',
  'spoke with client',
  'called client',
  'left vm',
  'left voicemail',
  'voicemail',
  'left a message',
  'client reached',
  'cliente notificado',
  'cliente actualizado',
  'hable con el cliente',
  'hablé con el cliente',
  'llame al cliente',
  'llamé al cliente',
  'dejé mensaje',
  'deje mensaje',
]

const PENDING_WORDS = [
  'will call',
  'will update',
  'not yet',
  "haven't",
  'pending',
  'trying to reach',
  'voy a llamar',
  'pendiente',
  'todavia no',
  'todavía no',
]

const WELCOME_WORDS = [
  'welcome packet',
  'welcome email',
  'welcome package',
  'sent welcome',
  'packet sent',
  'bienvenido',
  'bienvenida',
  'paquete de bienvenida',
  'correo de bienvenida',
]

const MEETING_WORDS = [
  'meeting set',
  'scheduled',
  'call scheduled',
  'appointment',
  'booked',
  'confirmed',
  'phone',
  'zoom',
  'llamada',
  'reunión',
  'reunion',
  'consulta',
]

function checkWrongCaseManager(
  attorney: string | null,
  actualReplier: string | null,
  assignments: Map<string, AttorneyAssignment>,
  flags: string[]
): AuditStatus | null {
  if (!attorney) return null

  const assignment = assignments.get(attorney.toLowerCase())

  if (assignment?.is_unassigned) {
    flags.push('UNASSIGNED ATTORNEY - Review manually')
  }

  if (!assignment?.case_manager_name || !actualReplier) return null

  const expectedFirst = assignment.case_manager_name.toLowerCase().split(' ')[0]
  const actualFirst = actualReplier.toLowerCase().split(' ')[0]

  if (expectedFirst && actualFirst && expectedFirst !== actualFirst) {
    flags.push(`Wrong case manager replied. Expected: ${assignment.case_manager_name}`)
    return 'wrong_case_manager'
  }

  return null
}

export async function auditEmailThread(
  thread: EmailThread,
  emailType: EmailType
): Promise<AuditResult> {
  const assignments = await getAttorneyAssignments()

  const messages = [...thread.messages].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )

  const firstMsg = messages[0]
  const fullText = messages.map(messageText).join('\n')
  const reply = findCaseManagerReply(thread)

  const attorney = detectAttorneyFromThread(thread, assignments)
  const actualReplier = reply?.from?.split('@')[0]?.replace(/[._]/g, ' ') ?? null
  const clientName = extractClientName(thread.subject, fullText)

  const flags: string[] = []
  let auditStatus: AuditStatus = 'needs_follow_up'

  const wrongCaseManagerStatus = checkWrongCaseManager(
    attorney,
    actualReplier,
    assignments,
    flags
  )

  if (wrongCaseManagerStatus) {
    auditStatus = wrongCaseManagerStatus
  }

  if (emailType === 'court_results') {
    const replyText = reply ? messageText(reply) : ''
    const confirmed = includesAny(replyText, CONFIRMED_CLIENT_UPDATE)
    const pending = includesAny(replyText, PENDING_WORDS)

    let confirmationStatus: AuditResult['confirmation_status'] = null

    if (!reply) {
      auditStatus = auditStatus === 'wrong_case_manager' ? auditStatus : 'no_reply'
      flags.push('No case manager reply found')
      confirmationStatus = 'not_confirmed'
    } else if (confirmed) {
      confirmationStatus = 'confirmed'
      if (auditStatus !== 'wrong_case_manager') auditStatus = 'looks_good'
    } else if (pending) {
      confirmationStatus = 'not_confirmed'
      if (auditStatus !== 'wrong_case_manager') auditStatus = 'needs_follow_up'
      flags.push('Case manager reply says client update is still pending')
    } else {
      confirmationStatus = 'inconclusive'
      if (auditStatus !== 'wrong_case_manager') auditStatus = 'needs_clarification'
      flags.push('Reply does not clearly confirm client was updated')
    }

    const responseTime = calculateResponseTime(firstMsg?.date ?? null, reply?.date ?? null)
    const isLate = responseTime !== null && responseTime > 24 * 60

    if (confirmed && isLate) {
      flags.push('Client update was completed late')
      if (auditStatus !== 'wrong_case_manager') auditStatus = 'needs_follow_up'
    }

    return defaultResult({
      client_name: clientName,
      attorney,
      next_court_date: extractDate(fullText),
      court_results_details: firstMsg ? messageText(firstMsg).slice(0, 1000) : null,
      case_manager_reply: reply ? messageText(reply).slice(0, 300) : null,
      actual_replier: actualReplier,
      confirmation_status: confirmationStatus,
      is_overdue: !confirmed,
      missing_or_unclear: flags.length ? flags.join('; ') : null,
      audit_status: auditStatus,
      flags,
      notes_for_zach: flags.length ? flags.join('; ') : null,
      response_time_minutes: responseTime,
      original_email_timestamp: firstMsg?.date ?? null,
      reply_timestamp: reply?.date ?? null,
      result_or_onboarding_details: firstMsg ? messageText(firstMsg).slice(0, 1000) : null,
      is_reply_specific: confirmed,
    })
  }

  const replyText = reply ? messageText(reply) : ''
  const sentWelcome = includesAny(replyText, WELCOME_WORDS)
  const scheduledMeeting = includesAny(replyText, MEETING_WORDS)

  if (!reply) {
    auditStatus = auditStatus === 'wrong_case_manager' ? auditStatus : 'no_reply'
    flags.push('No case manager reply found')
  } else if (sentWelcome && scheduledMeeting) {
    if (auditStatus !== 'wrong_case_manager') auditStatus = 'looks_good'
  } else {
    if (auditStatus !== 'wrong_case_manager') auditStatus = 'needs_follow_up'
    if (!sentWelcome) flags.push('Welcome packet not confirmed sent')
    if (!scheduledMeeting) flags.push('Meeting/call not confirmed scheduled')
  }

  const responseTime = calculateResponseTime(firstMsg?.date ?? null, reply?.date ?? null)
  const isLate = responseTime !== null && responseTime > 48 * 60

  if (reply && isLate) {
    flags.push('Case manager reply/completion was late')
    if (auditStatus !== 'wrong_case_manager') auditStatus = 'needs_follow_up'
  }

  return defaultResult({
    client_name: clientName,
    attorney,
    people_involved: clientName ? [clientName] : null,
    initial_calendar_entry: firstMsg ? messageText(firstMsg).slice(0, 1000) : null,
    case_manager_reply: reply ? messageText(reply).slice(0, 300) : null,
    actual_replier: actualReplier,
    onboarding_status:
      sentWelcome && scheduledMeeting
        ? 'welcome_packet_sent_meeting_scheduled'
        : 'meeting_not_confirmed',
    missing_or_unclear: flags.length ? flags.join('; ') : null,
    audit_status: auditStatus,
    flags,
    notes_for_zach: flags.length ? flags.join('; ') : null,
    response_time_minutes: responseTime,
    original_email_timestamp: firstMsg?.date ?? null,
    reply_timestamp: reply?.date ?? null,
    result_or_onboarding_details: firstMsg ? messageText(firstMsg).slice(0, 1000) : null,
    is_reply_specific: Boolean(sentWelcome && scheduledMeeting),
  })
}

export async function runFullAudit(threads: {
  courtResults: EmailThread[]
  addToCalendar: EmailThread[]
}) {
  const supabase = await createClient()
  const assignments = await getAttorneyAssignments()

  const results: Array<{
    thread: EmailThread
    emailType: EmailType
    result: AuditResult
  }> = []

  for (const thread of threads.courtResults) {
    const result = await auditEmailThread(thread, 'court_results')
    results.push({ thread, emailType: 'court_results', result })
  }

  for (const thread of threads.addToCalendar) {
    const result = await auditEmailThread(thread, 'add_to_calendar')
    results.push({ thread, emailType: 'add_to_calendar', result })
  }

  for (const { thread, emailType, result } of results) {
    const attorneyKey = result.attorney?.toLowerCase()
    const assignment = attorneyKey ? assignments.get(attorneyKey) : undefined

    const { error } = await supabase.from('email_audits').upsert(
      {
        thread_id: thread.id,
        email_type: emailType,
        subject: thread.subject,
        client_name: result.client_name,
        attorney: result.attorney,
        expected_case_manager: assignment?.case_manager_name || null,
        actual_replier: result.actual_replier,
        county: result.county,
        case_number: result.case_number,
        next_court_date: result.next_court_date,
        result_or_onboarding_details: result.result_or_onboarding_details,
        attorney_instructions: result.attorney_instructions,
        case_manager_reply: result.case_manager_reply,
        is_reply_specific: result.is_reply_specific,
        missing_or_unclear: result.missing_or_unclear,
        audit_status: result.audit_status,
        flags: result.flags,
        notes_for_zach: result.notes_for_zach,
        raw_thread_json: thread,
        audited_at: new Date().toISOString(),
        response_time_minutes: result.response_time_minutes,
        original_email_timestamp: result.original_email_timestamp,
        reply_timestamp: result.reply_timestamp,
        court_results_details: result.court_results_details,
        confirmation_status: result.confirmation_status,
        is_overdue: result.is_overdue,
        people_involved: result.people_involved,
        onboarding_status: result.onboarding_status,
        initial_calendar_entry: result.initial_calendar_entry,
      },
      { onConflict: 'thread_id' }
    )

    if (error) {
      console.error(`Failed to save email audit for thread ${thread.id}:`, error)
    }
  }

  const today = new Date().toISOString().split('T')[0]

  const statusCounts = results.reduce(
    (acc, { result }) => {
      acc[result.audit_status] = (acc[result.audit_status] || 0) + 1
      return acc
    },
    {} as Record<AuditStatus, number>
  )

  const { error: summaryError } = await supabase.from('audit_summaries').upsert(
    {
      audit_date: today,
      total_emails_scanned: results.length,
      needs_follow_up: statusCounts.needs_follow_up || 0,
      no_reply: statusCounts.no_reply || 0,
      wrong_case_manager: statusCounts.wrong_case_manager || 0,
      needs_clarification: statusCounts.needs_clarification || 0,
      looks_good: statusCounts.looks_good || 0,
    },
    { onConflict: 'audit_date' }
  )

  if (summaryError) {
    console.error('Failed to save audit summary:', summaryError)
  }

  return {
    totalProcessed: results.length,
    statusCounts,
    results,
  }
}