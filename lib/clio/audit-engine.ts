/**
 * Clio Audit Engine
 * 
 * Batched, resumable audit engine for Clio matters.
 * - Processes matters in configurable batches
 * - Persists progress for resumability
 * - Handles rate limits gracefully
 * - Stores audit results per-matter
 */

import { createAdminClient } from '@/lib/supabase/admin'
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
// Audit Run Management
// ============================================

/**
 * Start a new audit run
 * Fetches matters to audit and initializes the run
 */
export async function startAuditRun(
  batchSize = DEFAULT_BATCH_SIZE,
  timeWindowDays = DEFAULT_TIME_WINDOW_DAYS,
  startDateStr?: string | null,
  endDateStr?: string | null
): Promise<ClioAuditRun> {
  console.log('[v0] [startAuditRun] Called with batchSize:', batchSize, 'timeWindowDays:', timeWindowDays, 'startDateStr:', startDateStr, 'endDateStr:', endDateStr)
  const supabase = createAdminClient()
  
  // Calculate date range from explicit dates or time window
  let toDate: Date
  let fromDate: Date
  
  if (startDateStr && endDateStr) {
    fromDate = new Date(startDateStr)
    toDate = new Date(endDateStr)
    // Set to end of day for toDate
    toDate.setHours(23, 59, 59, 999)
  } else {
    toDate = new Date()
    fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - timeWindowDays)
  }
  console.log('[v0] [startAuditRun] Date range - from:', fromDate.toISOString(), 'to:', toDate.toISOString())

  // Get matters created in the time window
  console.log('[v0] [startAuditRun] Fetching matters from Clio...')
  const matters = await getRecentMatters(fromDate, toDate)
  console.log('[v0] [startAuditRun] Fetched', matters.length, 'matters from Clio')
  const matterIds = matters.map(m => String(m.id))

  // Create audit run
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

/**
 * Get the current/latest audit run
 */
export async function getCurrentAuditRun(): Promise<ClioAuditRun | null> {
  const supabase = createAdminClient()
  
  const { data, error } = await supabase
    .from('clio_audit_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    return null
  }

  return data as ClioAuditRun
}

/**
 * Get a specific audit run by ID
 */
export async function getAuditRun(runId: string): Promise<ClioAuditRun | null> {
  const supabase = createAdminClient()
  
  const { data, error } = await supabase
    .from('clio_audit_runs')
    .select('*')
    .eq('id', runId)
    .single()

  if (error || !data) {
    return null
  }

  return data as ClioAuditRun
}

/**
 * Update audit run status
 */
async function updateAuditRun(
  runId: string,
  updates: Partial<ClioAuditRun>
): Promise<void> {
  const supabase = createAdminClient()
  
  await supabase
    .from('clio_audit_runs')
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('id', runId)
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

/**
 * Fetch all data needed for a matter audit
 * RATE LIMIT SAFE: Sequential requests, not parallel
 * Only fetches what's needed, minimal fields
 */
async function fetchMatterData(
  matterId: string,
  fromDate: Date,
  toDate: Date
): Promise<MatterAuditData | null> {
  // Sequential requests to avoid rate limiting
  const matter = await getMatter(matterId)
  if (!matter) {
    console.error(`[Clio Audit] Matter not found: ${matterId}`)
    return null
  }

  // Fetch calendar first - most important for audit
  const calendarEntries = await getMatterCalendarEntries(matterId, fromDate, toDate)
  
  // Fetch communications - needed for email checks
  const communications = await getMatterCommunications(matterId, fromDate, toDate)
  
  // Fetch documents - needed for retainer check
  const documents = await getMatterDocuments(matterId)

  return {
    matter,
    calendarEntries,
    communications,
    documents,
  }
}

/**
 * Check if an intake/add-to-calendar entry exists
 */
function checkIntakeCalendar(
  calendarEntries: ClioCalendarEntry[]
): { exists: boolean; date: string | null } {
  const intakeKeywords = ['intake', 'add to calendar', 'new client', 'initial consultation', 'onboarding']
  
  const intakeEntry = calendarEntries.find(entry => {
    const summary = entry.summary?.toLowerCase() || ''
    const description = entry.description?.toLowerCase() || ''
    return intakeKeywords.some(kw => summary.includes(kw) || description.includes(kw))
  })

  return {
    exists: !!intakeEntry,
    date: intakeEntry?.start_at || null,
  }
}

/**
 * Check if a client-attorney meeting is scheduled within 48 hours of intake
 */
function checkMeetingScheduled(
  calendarEntries: ClioCalendarEntry[],
  matterCreatedAt: string
): { scheduled: boolean; withinDeadline: boolean; date: string | null } {
  const meetingKeywords = ['meeting', 'consultation', 'call', 'phone', 'appointment', 'conference']
  
  const meetings = calendarEntries.filter(entry => {
    const summary = entry.summary?.toLowerCase() || ''
    return meetingKeywords.some(kw => summary.includes(kw))
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
  const withinDeadline = meetingDate <= deadlineDate

  return {
    scheduled: true,
    withinDeadline,
    date: firstMeeting.start_at,
  }
}

/**
 * Check if welcome packet email was sent
 */
function checkWelcomePacket(
  communications: ClioCommunication[]
): { sent: boolean; date: string | null } {
  const welcomeKeywords = ['welcome packet', 'welcome email', 'new client packet', 'intake packet']
  
  const welcomeEmail = communications.find(comm => {
    const subject = comm.subject?.toLowerCase() || ''
    const body = comm.body?.toLowerCase() || ''
    return welcomeKeywords.some(kw => subject.includes(kw) || body.includes(kw))
  })

  return {
    sent: !!welcomeEmail,
    date: welcomeEmail?.date || welcomeEmail?.created_at || null,
  }
}

/**
 * Check if appearance filed email was sent
 */
function checkAppearanceEmail(
  communications: ClioCommunication[],
  matterCreatedAt: string
): { sent: boolean; withinDeadline: boolean; date: string | null } {
  const appearanceKeywords = ['appearance', 'filed', 'your appearance has been filed']
  
  const appearanceEmail = communications.find(comm => {
    const subject = comm.subject?.toLowerCase() || ''
    const body = comm.body?.toLowerCase() || ''
    return appearanceKeywords.some(kw => subject.includes(kw) || body.includes(kw))
  })

  if (!appearanceEmail) {
    return { sent: false, withinDeadline: false, date: null }
  }

  const matterDate = new Date(matterCreatedAt)
  const deadlineDate = new Date(matterDate.getTime() + 48 * 60 * 60 * 1000)
  const emailDate = new Date(appearanceEmail.date || appearanceEmail.created_at)
  const withinDeadline = emailDate <= deadlineDate

  return {
    sent: true,
    withinDeadline,
    date: appearanceEmail.date || appearanceEmail.created_at,
  }
}

/**
 * Check if signed retainer exists
 */
function checkSignedRetainer(
  documents: ClioDocument[]
): { exists: boolean; date: string | null } {
  const retainerKeywords = ['retainer', 'signed retainer', 'fee agreement', 'engagement letter']
  
  const retainerDoc = documents.find(doc => {
    const name = doc.name?.toLowerCase() || ''
    return retainerKeywords.some(kw => name.includes(kw))
  })

  return {
    exists: !!retainerDoc,
    date: retainerDoc?.created_at || null,
  }
}

/**
 * Determine overall status based on checks
 */
function determineOverallStatus(audit: Partial<ClioMatterAudit>): MatterAuditStatus {
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

  if (criticalMissing >= 2) {
    return 'missing_evidence'
  }
  
  if (criticalMissing > 0 || needsReview > 0) {
    return 'needs_review'
  }

  return 'pass'
}

/**
 * Audit a single matter
 */
async function auditMatter(
  auditRunId: string,
  matterId: string,
  fromDate: Date,
  toDate: Date
): Promise<ClioMatterAudit | null> {
  const supabase = createAdminClient()
  
  // Fetch all matter data
  const matterData = await fetchMatterData(matterId, fromDate, toDate)
  if (!matterData) {
    return null
  }

  const { matter, calendarEntries, communications, documents } = matterData
  const matterCreatedAt = matter.created_at

  // Run all checks
  const intakeCheck = checkIntakeCalendar(calendarEntries)
  const meetingCheck = checkMeetingScheduled(calendarEntries, matterCreatedAt)
  const welcomeCheck = checkWelcomePacket(communications)
  const appearanceCheck = checkAppearanceEmail(communications, matterCreatedAt)
  const retainerCheck = checkSignedRetainer(documents)

  // Build missing items and flags
  const missingItems: string[] = []
  const flags: string[] = []

  if (!intakeCheck.exists) missingItems.push('Intake calendar entry')
  if (!meetingCheck.scheduled) missingItems.push('Client-attorney meeting')
  if (meetingCheck.scheduled && !meetingCheck.withinDeadline) flags.push('Meeting not scheduled within 48 hours')
  if (!welcomeCheck.sent) missingItems.push('Welcome packet email')
  if (!appearanceCheck.sent) missingItems.push('Appearance filed email')
  if (appearanceCheck.sent && !appearanceCheck.withinDeadline) flags.push('Appearance email not sent within 48 hours')
  if (!retainerCheck.exists) missingItems.push('Signed retainer document')

  // Build audit record
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
    appearance_date: null, // Would need separate check
    appearance_email_sent: appearanceCheck.sent,
    appearance_email_date: appearanceCheck.date,
    attorney_correctly_assigned: !!matter.responsible_attorney,
    client_name_consistent: true, // Would need cross-reference check
    signed_retainer_exists: retainerCheck.exists,
    signed_retainer_date: retainerCheck.date,

    evidence: {
      calendar_entries_count: calendarEntries.length,
      communications_count: communications.length,
      documents_count: documents.length,
      intake_entry: intakeCheck.exists ? calendarEntries.find(e => 
        e.summary?.toLowerCase().includes('intake')
      )?.summary : null,
      meeting_entry: meetingCheck.scheduled ? meetingCheck.date : null,
      welcome_email_subject: welcomeCheck.sent ? communications.find(c =>
        c.subject?.toLowerCase().includes('welcome')
      )?.subject : null,
    },
    flags,
    missing_items: missingItems,
    notes: null,
    overall_status: 'pass', // Will be calculated
  }

  auditRecord.overall_status = determineOverallStatus(auditRecord)

  // Save to database
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

// ============================================
// Batch Processing
// ============================================

/**
 * Process a single batch of matters
 * Returns the number of matters processed and whether rate-limited
 */
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

  // Calculate date range
  const toDate = new Date()
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - auditRun.time_window_days)

  // Get matters to process in this batch
  const matterIds = auditRun.matter_ids_to_process || []
  const startIdx = auditRun.processed_matters
  const endIdx = Math.min(startIdx + auditRun.batch_size, matterIds.length)
  const batchMatterIds = matterIds.slice(startIdx, endIdx)

  if (batchMatterIds.length === 0) {
    // No more matters to process
    await updateAuditRun(auditRunId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    return { processed: 0, rateLimited: false }
  }

  // Update status to in_progress
  await updateAuditRun(auditRunId, { status: 'in_progress' })

  let processedCount = 0

  try {
    for (const matterId of batchMatterIds) {
      try {
        await auditMatter(auditRunId, matterId, fromDate, toDate)
        processedCount++

        // Update progress after each matter
        await updateAuditRun(auditRunId, {
          processed_matters: startIdx + processedCount,
          last_processed_matter_id: matterId,
          current_batch: auditRun.current_batch + 1,
        })
      } catch (error) {
        if (error instanceof ClioRateLimitError) {
          // Rate limited - save progress and stop
          await updateAuditRun(auditRunId, {
            status: 'rate_limited',
            rate_limit_reset_at: error.resetAt?.toISOString() || null,
            error_message: 'Clio API rate limit exceeded',
          })
          return { processed: processedCount, rateLimited: true }
        }
        
        // Log error but continue with next matter
        console.error(`[Clio Audit] Error auditing matter ${matterId}:`, error)
      }
    }

    // Check if all matters are processed
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

// ============================================
// Results Retrieval
// ============================================

/**
 * Get all matter audits for a run
 */
export async function getAuditResults(
  auditRunId: string
): Promise<ClioMatterAudit[]> {
  const supabase = createAdminClient()
  
  const { data, error } = await supabase
    .from('clio_matter_audits')
    .select('*')
    .eq('audit_run_id', auditRunId)
    .order('created_at', { ascending: true })

  if (error || !data) {
    return []
  }

  return data as ClioMatterAudit[]
}

/**
 * Get audit summary stats
 */
export async function getAuditSummary(
  auditRunId: string
): Promise<{ total: number; pass: number; needs_review: number; missing_evidence: number }> {
  const results = await getAuditResults(auditRunId)
  
  return {
    total: results.length,
    pass: results.filter(r => r.overall_status === 'pass').length,
    needs_review: results.filter(r => r.overall_status === 'needs_review').length,
    missing_evidence: results.filter(r => r.overall_status === 'missing_evidence').length,
  }
}
