/**
 * Clio Audit Engine
 *
 * Batched, resumable audit engine for Clio matters.
 * - Processes matters in configurable batches
 * - Persists progress for resumability
 * - Handles rate limits gracefully
 * - Stores audit results per-matter
 */

import { Pool, PoolClient } from 'pg'
import {
  getRecentMatters,
  getMatter,
  getMatterCalendarEntries,
  getMatterCommunications,
  getMatterDocuments,
} from './client'
import {
  ClioMatter,
  ClioCalendarEntry,
  ClioCommunication,
  ClioDocument,
  ClioAuditRun,
  ClioMatterAudit,
  MatterAuditStatus,
  ClioRateLimitError,
} from './types'

// RATE LIMIT SAFE: Process 5 matters per request (3-5 is safe range)
const DEFAULT_BATCH_SIZE = 5
const DEFAULT_TIME_WINDOW_DAYS = 14

// ============================================
// DB Helper — single shared pool factory
// ============================================

function makePool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
}

/**
 * Run a query with automatic connect/release/pool-end lifecycle.
 * Pass a callback that receives the connected PoolClient.
 */
async function withDb<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = makePool()
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
    await pool.end()
  }
}

// ============================================
// Audit Run Management
// ============================================

/**
 * Start a new audit run
 */
export async function startAuditRun(
  batchSize = DEFAULT_BATCH_SIZE,
  timeWindowDays = DEFAULT_TIME_WINDOW_DAYS,
  startDateStr?: string | null,
  endDateStr?: string | null
): Promise<ClioAuditRun> {
  let toDate: Date
  let fromDate: Date

  if (startDateStr && endDateStr) {
    fromDate = new Date(startDateStr)
    toDate = new Date(endDateStr)
    toDate.setHours(23, 59, 59, 999)
  } else {
    toDate = new Date()
    fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - timeWindowDays)
  }

  const matters = await getRecentMatters(fromDate, toDate)
  const matterIds = matters.map((m) => String(m.id))

  return withDb(async (client) => {
    const result = await client.query<ClioAuditRun>(
      `INSERT INTO clio_audit_runs
         (status, total_matters, processed_matters, current_batch, batch_size,
          time_window_days, matter_ids_to_process, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        'pending',
        matterIds.length,
        0,
        0,
        batchSize,
        timeWindowDays,
        JSON.stringify(matterIds),
        new Date().toISOString(),
      ]
    )

    if (!result.rows[0]) {
      throw new Error('Failed to create audit run: no row returned')
    }

    return result.rows[0]
  })
}

/**
 * Get the current/latest audit run
 */
export async function getCurrentAuditRun(): Promise<ClioAuditRun | null> {
  return withDb(async (client) => {
    const result = await client.query<ClioAuditRun>(
      `SELECT * FROM clio_audit_runs
       ORDER BY created_at DESC
       LIMIT 1`
    )
    return result.rows[0] || null
  })
}

/**
 * Get a specific audit run by ID
 */
export async function getAuditRun(runId: string): Promise<ClioAuditRun | null> {
  return withDb(async (client) => {
    const result = await client.query<ClioAuditRun>(
      `SELECT * FROM clio_audit_runs WHERE id = $1`,
      [runId]
    )
    return result.rows[0] || null
  })
}

/**
 * Update audit run fields
 */
async function updateAuditRun(
  runId: string,
  updates: Partial<ClioAuditRun>
): Promise<void> {
  // Build SET clause dynamically from the updates object
  const fields = Object.keys(updates) as (keyof ClioAuditRun)[]
  if (fields.length === 0) return

  const setClauses = fields.map((key, i) => `"${key}" = $${i + 1}`)
  setClauses.push(`updated_at = NOW()`)

  const values = fields.map((key) => {
    const val = updates[key]
    // Serialize arrays/objects to JSON for jsonb columns
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return JSON.stringify(val)
    }
    if (Array.isArray(val)) {
      return JSON.stringify(val)
    }
    return val
  })

  values.push(runId)
  const idPlaceholder = `$${values.length}`

  await withDb(async (client) => {
    await client.query(
      `UPDATE clio_audit_runs SET ${setClauses.join(', ')} WHERE id = ${idPlaceholder}`,
      values
    )
  })
}

// ============================================
// Matter Audit Logic
// ============================================

interface MatterAuditData {
  matter: ClioMatter
  calendarEntries: ClioCalendarEntry[]
  communications: ClioCommunication[]
  documents: ClioDocument[]
}

async function fetchMatterData(
  matterId: string,
  fromDate: Date,
  toDate: Date
): Promise<MatterAuditData | null> {
  const matter = await getMatter(matterId)
  if (!matter) {
    console.error(`[Clio Audit] Matter not found: ${matterId}`)
    return null
  }

  const calendarEntries = await getMatterCalendarEntries(matterId, fromDate, toDate)
  const communications = await getMatterCommunications(matterId, fromDate, toDate)
  const documents = await getMatterDocuments(matterId)

  return { matter, calendarEntries, communications, documents }
}

function checkIntakeCalendar(
  calendarEntries: ClioCalendarEntry[]
): { exists: boolean; date: string | null } {
  const intakeKeywords = [
    'intake',
    'add to calendar',
    'new client',
    'initial consultation',
    'onboarding',
  ]

  const intakeEntry = calendarEntries.find((entry) => {
    const summary = entry.summary?.toLowerCase() || ''
    const description = entry.description?.toLowerCase() || ''
    return intakeKeywords.some(
      (kw) => summary.includes(kw) || description.includes(kw)
    )
  })

  return { exists: !!intakeEntry, date: intakeEntry?.start_at || null }
}

function checkMeetingScheduled(
  calendarEntries: ClioCalendarEntry[],
  matterCreatedAt: string
): { scheduled: boolean; withinDeadline: boolean; date: string | null } {
  const meetingKeywords = [
    'meeting',
    'consultation',
    'call',
    'phone',
    'appointment',
    'conference',
  ]

  const meetings = calendarEntries.filter((entry) => {
    const summary = entry.summary?.toLowerCase() || ''
    return meetingKeywords.some((kw) => summary.includes(kw))
  })

  if (meetings.length === 0) {
    return { scheduled: false, withinDeadline: false, date: null }
  }

  const matterDate = new Date(matterCreatedAt)
  const deadlineDate = new Date(matterDate.getTime() + 48 * 60 * 60 * 1000)

  const firstMeeting = meetings.sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
  )[0]

  const meetingDate = new Date(firstMeeting.start_at)

  return {
    scheduled: true,
    withinDeadline: meetingDate <= deadlineDate,
    date: firstMeeting.start_at,
  }
}

function checkWelcomePacket(
  communications: ClioCommunication[]
): { sent: boolean; date: string | null } {
  const welcomeKeywords = [
    'welcome packet',
    'welcome email',
    'new client packet',
    'intake packet',
  ]

  const welcomeEmail = communications.find((comm) => {
    const subject = comm.subject?.toLowerCase() || ''
    const body = comm.body?.toLowerCase() || ''
    return welcomeKeywords.some(
      (kw) => subject.includes(kw) || body.includes(kw)
    )
  })

  return {
    sent: !!welcomeEmail,
    date: welcomeEmail?.date || welcomeEmail?.created_at || null,
  }
}

function checkAppearanceEmail(
  communications: ClioCommunication[],
  matterCreatedAt: string
): { sent: boolean; withinDeadline: boolean; date: string | null } {
  const appearanceKeywords = [
    'appearance',
    'filed',
    'your appearance has been filed',
  ]

  const appearanceEmail = communications.find((comm) => {
    const subject = comm.subject?.toLowerCase() || ''
    const body = comm.body?.toLowerCase() || ''
    return appearanceKeywords.some(
      (kw) => subject.includes(kw) || body.includes(kw)
    )
  })

  if (!appearanceEmail) {
    return { sent: false, withinDeadline: false, date: null }
  }

  const matterDate = new Date(matterCreatedAt)
  const deadlineDate = new Date(matterDate.getTime() + 48 * 60 * 60 * 1000)
  const emailDate = new Date(
    appearanceEmail.date || appearanceEmail.created_at
  )

  return {
    sent: true,
    withinDeadline: emailDate <= deadlineDate,
    date: appearanceEmail.date || appearanceEmail.created_at,
  }
}

function checkSignedRetainer(
  documents: ClioDocument[]
): { exists: boolean; date: string | null } {
  const retainerKeywords = [
    'retainer',
    'signed retainer',
    'fee agreement',
    'engagement letter',
  ]

  const retainerDoc = documents.find((doc) => {
    const name = doc.name?.toLowerCase() || ''
    return retainerKeywords.some((kw) => name.includes(kw))
  })

  return {
    exists: !!retainerDoc,
    date: retainerDoc?.created_at || null,
  }
}

function determineOverallStatus(
  audit: Partial<ClioMatterAudit>
): MatterAuditStatus {
  const criticalMissing = [
    !audit.intake_calendar_exists,
    !audit.matter_created_in_clio,
    !audit.welcome_packet_sent,
    !audit.signed_retainer_exists,
  ].filter(Boolean).length

  const needsReview = [
    audit.meeting_scheduled_within_48h === false,
    audit.appearance_filed_within_48h === false,
    audit.attorney_correctly_assigned === false,
    audit.client_name_consistent === false,
  ].filter(Boolean).length

  if (criticalMissing >= 2) return 'missing_evidence'
  if (criticalMissing > 0 || needsReview > 0) return 'needs_review'
  return 'pass'
}

async function auditMatter(
  auditRunId: string,
  matterId: string,
  fromDate: Date,
  toDate: Date
): Promise<ClioMatterAudit | null> {
  const matterData = await fetchMatterData(matterId, fromDate, toDate)
  if (!matterData) return null

  const { matter, calendarEntries, communications, documents } = matterData
  const matterCreatedAt = matter.created_at

  const intakeCheck = checkIntakeCalendar(calendarEntries)
  const meetingCheck = checkMeetingScheduled(calendarEntries, matterCreatedAt)
  const welcomeCheck = checkWelcomePacket(communications)
  const appearanceCheck = checkAppearanceEmail(communications, matterCreatedAt)
  const retainerCheck = checkSignedRetainer(documents)

  const missingItems: string[] = []
  const flags: string[] = []

  if (!intakeCheck.exists) missingItems.push('Intake calendar entry')
  if (!meetingCheck.scheduled) missingItems.push('Client-attorney meeting')
  if (meetingCheck.scheduled && !meetingCheck.withinDeadline)
    flags.push('Meeting not scheduled within 48 hours')
  if (!welcomeCheck.sent) missingItems.push('Welcome packet email')
  if (!appearanceCheck.sent) missingItems.push('Appearance filed email')
  if (appearanceCheck.sent && !appearanceCheck.withinDeadline)
    flags.push('Appearance email not sent within 48 hours')
  if (!retainerCheck.exists) missingItems.push('Signed retainer document')

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
    meeting_scheduled_within_48h: meetingCheck.scheduled
      ? meetingCheck.withinDeadline
      : null,
    meeting_date: meetingCheck.date,
    welcome_packet_sent: welcomeCheck.sent,
    welcome_packet_date: welcomeCheck.date,

    appearance_filed_within_48h: appearanceCheck.sent
      ? appearanceCheck.withinDeadline
      : null,
    appearance_date: null,
    appearance_email_sent: appearanceCheck.sent,
    appearance_email_date: appearanceCheck.date,
    attorney_correctly_assigned: !!matter.responsible_attorney,
    client_name_consistent: true,
    signed_retainer_exists: retainerCheck.exists,
    signed_retainer_date: retainerCheck.date,

    evidence: {
      calendar_entries_count: calendarEntries.length,
      communications_count: communications.length,
      documents_count: documents.length,
      intake_entry: intakeCheck.exists
        ? calendarEntries.find((e) =>
            e.summary?.toLowerCase().includes('intake')
          )?.summary
        : null,
      meeting_entry: meetingCheck.scheduled ? meetingCheck.date : null,
      welcome_email_subject: welcomeCheck.sent
        ? communications.find((c) =>
            c.subject?.toLowerCase().includes('welcome')
          )?.subject
        : null,
    },
    flags,
    missing_items: missingItems,
    notes: null,
    overall_status: 'pass',
  }

  auditRecord.overall_status = determineOverallStatus(auditRecord)

  return withDb(async (client) => {
    const result = await client.query<ClioMatterAudit>(
      `INSERT INTO clio_matter_audits
         (audit_run_id, matter_id, matter_display_number, client_name, attorney_name,
          matter_status, matter_created_at, intake_calendar_exists, intake_calendar_date,
          matter_created_in_clio, meeting_scheduled_within_48h, meeting_date,
          welcome_packet_sent, welcome_packet_date, appearance_filed_within_48h,
          appearance_date, appearance_email_sent, appearance_email_date,
          attorney_correctly_assigned, client_name_consistent, signed_retainer_exists,
          signed_retainer_date, evidence, flags, missing_items, notes, overall_status)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
       RETURNING *`,
      [
        auditRecord.audit_run_id,
        auditRecord.matter_id,
        auditRecord.matter_display_number,
        auditRecord.client_name,
        auditRecord.attorney_name,
        auditRecord.matter_status,
        auditRecord.matter_created_at,
        auditRecord.intake_calendar_exists,
        auditRecord.intake_calendar_date,
        auditRecord.matter_created_in_clio,
        auditRecord.meeting_scheduled_within_48h,
        auditRecord.meeting_date,
        auditRecord.welcome_packet_sent,
        auditRecord.welcome_packet_date,
        auditRecord.appearance_filed_within_48h,
        auditRecord.appearance_date,
        auditRecord.appearance_email_sent,
        auditRecord.appearance_email_date,
        auditRecord.attorney_correctly_assigned,
        auditRecord.client_name_consistent,
        auditRecord.signed_retainer_exists,
        auditRecord.signed_retainer_date,
        JSON.stringify(auditRecord.evidence),
        JSON.stringify(auditRecord.flags),
        JSON.stringify(auditRecord.missing_items),
        auditRecord.notes,
        auditRecord.overall_status,
      ]
    )

    if (!result.rows[0]) {
      console.error(
        `[Clio Audit] Failed to save audit for matter ${matterId}: no row returned`
      )
      return null
    }

    return result.rows[0]
  })
}

// ============================================
// Batch Processing
// ============================================

export async function processBatch(
  auditRunId: string
): Promise<{ processed: number; rateLimited: boolean; error?: string }> {
  const auditRun = await getAuditRun(auditRunId)

  if (!auditRun) {
    return { processed: 0, rateLimited: false, error: 'Audit run not found' }
  }

  if (auditRun.status === 'completed' || auditRun.status === 'failed') {
    return {
      processed: 0,
      rateLimited: false,
      error: `Audit run is ${auditRun.status}`,
    }
  }

  const toDate = new Date()
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - auditRun.time_window_days)

  const matterIds: string[] = Array.isArray(auditRun.matter_ids_to_process)
    ? auditRun.matter_ids_to_process
    : JSON.parse((auditRun.matter_ids_to_process as unknown as string) || '[]')

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
        console.error(
          `[Clio Audit] Error auditing matter ${matterId}:`,
          error
        )
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
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'

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

// ============================================
// Results Retrieval
// ============================================

export async function getAuditResults(
  auditRunId: string
): Promise<ClioMatterAudit[]> {
  return withDb(async (client) => {
    const result = await client.query<ClioMatterAudit>(
      `SELECT * FROM clio_matter_audits
       WHERE audit_run_id = $1
       ORDER BY created_at ASC`,
      [auditRunId]
    )
    return result.rows
  })
}

export async function getAuditSummary(
  auditRunId: string
): Promise<{
  total: number
  pass: number
  needs_review: number
  missing_evidence: number
}> {
  const results = await getAuditResults(auditRunId)

  return {
    total: results.length,
    pass: results.filter((r) => r.overall_status === 'pass').length,
    needs_review: results.filter((r) => r.overall_status === 'needs_review')
      .length,
    missing_evidence: results.filter(
      (r) => r.overall_status === 'missing_evidence'
    ).length,
  }
}
