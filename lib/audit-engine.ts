import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'
import type { AuditResult, EmailType, AuditStatus, AttorneyAssignment } from '@/lib/types'

// Lazy initialization to avoid build-time errors when OPENAI_API_KEY is not set
let openaiClient: OpenAI | null = null

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }
  return openaiClient
}

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

// Get attorney assignments from database
async function getAttorneyAssignments(): Promise<Map<string, AttorneyAssignment>> {
  const supabase = await createClient()
  const { data } = await supabase.from('attorney_assignments').select('*')
  
  const map = new Map<string, AttorneyAssignment>()
  data?.forEach((assignment) => {
    map.set(assignment.attorney_name.toLowerCase(), assignment)
  })
  return map
}

export async function auditEmailThread(
  thread: EmailThread,
  emailType: EmailType
): Promise<AuditResult> {
  const assignments = await getAttorneyAssignments()
  
  const threadContent = thread.messages
    .map((msg) => `From: ${msg.from}\nTo: ${msg.to}\nDate: ${msg.date}\n\n${msg.body}`)
    .join('\n\n---\n\n')

  const assignmentsList = Array.from(assignments.values())
    .map((a) => `${a.attorney_name} → ${a.case_manager_name || 'UNASSIGNED (review manually)'}`)
    .join('\n')

  const courtResultsPrompt = `You are an email audit assistant for a law firm. You analyze COURT RESULTS email threads.

ATTORNEY TO CASE MANAGER ASSIGNMENTS:
${assignmentsList}

SPECIAL RULE: Zach handles Lori's Spanish calls.

YOUR TASK:
1. Find the FIRST court-results email from the attorney in the thread
2. Extract: exact timestamp, client name, and court results provided
3. Check if the case manager replied confirming the client was updated with court results

CLASSIFICATION RULES for confirmation_status:
- "confirmed": Reply CLEARLY states client was updated with court results (e.g., "Client notified", "Spoke with client about results", "Left VM with results")
- "not_confirmed": Reply says task is still pending or client has NOT been updated yet
- "inconclusive": Reply is unclear, vague (just "done", "handled"), or doesn't mention updating the client

DEADLINE RULE:
- Use CDT timezone
- If case manager has NOT confirmed completion by 5:00 PM CDT today, mark is_overdue as true

IMPORTANT:
- Do NOT assume anything was completed unless explicitly stated
- Extract the exact court results text from the attorney's email
- If no case manager replied, audit_status should be "no_reply"
- If wrong case manager replied, flag it

Return JSON with these fields:
{
  "client_name": string or null,
  "attorney": string or null,
  "county": string or null,
  "case_number": string or null,
  "next_court_date": string (ISO format) or null,
  "court_results_details": string (exact court results from attorney's email),
  "attorney_instructions": string or null,
  "case_manager_reply": string or null (brief summary of case manager's response),
  "actual_replier": string or null,
  "confirmation_status": "confirmed" | "not_confirmed" | "inconclusive",
  "is_overdue": boolean (true if not confirmed by 5PM CDT),
  "missing_or_unclear": string or null,
  "audit_status": "needs_follow_up" | "no_reply" | "wrong_case_manager" | "needs_clarification" | "looks_good",
  "flags": string[],
  "notes_for_zach": string or null,
  "original_email_timestamp": string (ISO timestamp of attorney's court results email),
  "reply_timestamp": string or null (ISO timestamp of case manager's reply),
  "result_or_onboarding_details": null,
  "is_reply_specific": boolean,
  "people_involved": null,
  "onboarding_status": null,
  "initial_calendar_entry": null
}`

  const addToCalendarPrompt = `You are an email audit assistant for a law firm. You analyze ADD TO CALENDAR email threads.

ATTORNEY TO CASE MANAGER ASSIGNMENTS:
${assignmentsList}

SPECIAL RULE: Zach handles Lori's Spanish calls.

YOUR TASK:
1. Find ONLY the INITIAL "Add to Calendar" email entry (ignore duplicate entries or follow-ups)
2. Extract: names of two people involved, relevant attorney, relevant case manager
3. Extract any notes/details the attorney says are relevant
4. Check if case manager confirmed onboarding was completed

OUTPUT FORMAT - Keep it simple, text-message style:
- Names of the two people involved
- Relevant attorney
- Relevant case manager  
- Initial Add to Calendar entry details
- Attorney's relevant notes

CLASSIFICATION for onboarding_status:
- "welcome_packet_sent_meeting_scheduled": Case manager confirmed BOTH welcome packet sent AND meeting/call scheduled
- "meeting_not_confirmed": Unclear if meeting was confirmed, or only partial completion

IMPORTANT:
- Do NOT include unnecessary thread history
- Do NOT include unrelated replies
- Do NOT include duplicate calendar entries
- Use ONLY the initial Add to Calendar email as the trigger
- If onboarding confirmation is unclear, use "meeting_not_confirmed"

Return JSON with these fields:
{
  "client_name": string or null,
  "attorney": string or null,
  "people_involved": string[] (names of the two people involved),
  "initial_calendar_entry": string (the initial Add to Calendar entry, brief),
  "attorney_instructions": string or null (relevant notes from attorney),
  "case_manager_reply": string or null (brief summary),
  "actual_replier": string or null,
  "onboarding_status": "welcome_packet_sent_meeting_scheduled" | "meeting_not_confirmed",
  "missing_or_unclear": string or null,
  "audit_status": "needs_follow_up" | "no_reply" | "wrong_case_manager" | "needs_clarification" | "looks_good",
  "flags": string[],
  "notes_for_zach": string or null,
  "original_email_timestamp": string (ISO timestamp),
  "reply_timestamp": string or null,
  "result_or_onboarding_details": string or null,
  "is_reply_specific": boolean,
  "county": null,
  "case_number": null,
  "next_court_date": null,
  "court_results_details": null,
  "confirmation_status": null,
  "is_overdue": false
}`

  const systemPrompt = emailType === 'court_results' ? courtResultsPrompt : addToCalendarPrompt

  try {
    const response = await getOpenAIClient().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this email thread:\n\nSubject: ${thread.subject}\n\n${threadContent}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    })

    const content = response.choices[0].message.content
    if (!content) {
      throw new Error('No response from OpenAI')
    }

    const result = JSON.parse(content) as AuditResult

    // Verify the expected case manager based on the attorney
    if (result.attorney) {
      const attorneyKey = result.attorney.toLowerCase()
      const assignment = assignments.get(attorneyKey)
      
      if (assignment?.is_unassigned) {
        result.flags = [...(result.flags || []), 'UNASSIGNED ATTORNEY - Review manually']
      }
    }

    return result
  } catch (error) {
    console.error('OpenAI audit error:', error)
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
      missing_or_unclear: 'Failed to analyze email thread',
      audit_status: 'needs_follow_up',
      flags: ['AUDIT ERROR'],
      notes_for_zach: 'OpenAI analysis failed - manual review required',
      response_time_minutes: null,
      original_email_timestamp: null,
      reply_timestamp: null,
      court_results_details: null,
      confirmation_status: null,
      is_overdue: false,
      people_involved: null,
      onboarding_status: null,
      initial_calendar_entry: null,
    }
  }
}

// Calculate response time in minutes from timestamps
function calculateResponseTime(originalTimestamp: string | null, replyTimestamp: string | null): number | null {
  if (!originalTimestamp || !replyTimestamp) return null
  
  const originalDate = new Date(originalTimestamp)
  const replyDate = new Date(replyTimestamp)
  
  if (isNaN(originalDate.getTime()) || isNaN(replyDate.getTime())) return null
  
  const diffMs = replyDate.getTime() - originalDate.getTime()
  return Math.round(diffMs / (1000 * 60)) // Convert to minutes
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

  // Audit Court Results emails
  for (const thread of threads.courtResults) {
    const result = await auditEmailThread(thread, 'court_results')
    results.push({ thread, emailType: 'court_results', result })
  }

  // Audit Add to Calendar emails
  for (const thread of threads.addToCalendar) {
    const result = await auditEmailThread(thread, 'add_to_calendar')
    results.push({ thread, emailType: 'add_to_calendar', result })
  }

  // Store results in database
  for (const { thread, emailType, result } of results) {
    const attorneyKey = result.attorney?.toLowerCase()
    const assignment = attorneyKey ? assignments.get(attorneyKey) : undefined

    const responseTime = calculateResponseTime(result.original_email_timestamp, result.reply_timestamp)
    
    await supabase.from('email_audits').upsert({
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
      response_time_minutes: responseTime,
      original_email_timestamp: result.original_email_timestamp,
      reply_timestamp: result.reply_timestamp,
      court_results_details: result.court_results_details,
      confirmation_status: result.confirmation_status,
      is_overdue: result.is_overdue,
      people_involved: result.people_involved,
      onboarding_status: result.onboarding_status,
      initial_calendar_entry: result.initial_calendar_entry,
    }, {
      onConflict: 'thread_id',
    })
  }

  // Update daily summary
  const today = new Date().toISOString().split('T')[0]
  const statusCounts = results.reduce(
    (acc, { result }) => {
      acc[result.audit_status] = (acc[result.audit_status] || 0) + 1
      return acc
    },
    {} as Record<AuditStatus, number>
  )

  await supabase.from('audit_summaries').upsert({
    audit_date: today,
    total_emails_scanned: results.length,
    needs_follow_up: statusCounts.needs_follow_up || 0,
    no_reply: statusCounts.no_reply || 0,
    wrong_case_manager: statusCounts.wrong_case_manager || 0,
    needs_clarification: statusCounts.needs_clarification || 0,
    looks_good: statusCounts.looks_good || 0,
  }, {
    onConflict: 'audit_date',
  })

  return {
    totalProcessed: results.length,
    statusCounts,
    results,
  }
}
