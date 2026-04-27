import OpenAI from 'openai'
import { createClient } from '@/lib/supabase/server'
import type { AuditResult, EmailType, AuditStatus, AttorneyAssignment } from '@/lib/types'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

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

  const systemPrompt = `You are an email audit assistant for a law firm. You analyze email threads to verify case manager follow-up.

ATTORNEY TO CASE MANAGER ASSIGNMENTS:
${assignmentsList}

SPECIAL RULE: Zach handles Lori's Spanish calls.

EMAIL TYPE: ${emailType === 'court_results' ? 'Court Results' : 'Add to Calendar'}

${emailType === 'court_results' ? `
FOR COURT RESULTS EMAILS, check whether the case manager reply confirms:
- Result sent to client
- Client called or call attempted
- Voicemail left if applicable
- Attorney instructions completed
- Next court date communicated, if applicable
` : `
FOR ADD TO CALENDAR EMAILS, check whether the case manager reply confirms:
- Welcome packet sent
- Client called
- Client-attorney meeting or phone call scheduled
- Attorney instructions completed
`}

AUDIT RULES:
- Do NOT check Clio
- Do NOT assume anything was completed unless the email reply clearly says it
- If no case manager replied, mark "No case manager reply found"
- If the wrong case manager replied, flag it
- If the reply only says "done," "handled," or "completed," mark as "Needs clarification"
- If the email says "welcome packet sent," count only welcome packet as completed
- If the email says "scheduled a call/meeting," count only scheduling as completed
- If something is not clearly confirmed, mark it as missing or unclear

Return a JSON object with these exact fields:
{
  "client_name": string or null,
  "attorney": string or null,
  "county": string or null,
  "case_number": string or null,
  "next_court_date": string (ISO format) or null,
  "result_or_onboarding_details": string or null,
  "attorney_instructions": string or null,
  "case_manager_reply": string or null (the actual reply text from case manager),
  "actual_replier": string or null (name of person who replied),
  "is_reply_specific": boolean,
  "missing_or_unclear": string or null (list what is missing or unclear),
  "audit_status": "needs_follow_up" | "no_reply" | "wrong_case_manager" | "needs_clarification" | "looks_good",
  "flags": string[] (any important flags or warnings),
  "notes_for_zach": string or null (any special notes for Zach),
  "original_email_timestamp": string or null (ISO timestamp of the first email in thread),
  "reply_timestamp": string or null (ISO timestamp of the case manager's reply)
}`

  try {
    const response = await openai.chat.completions.create({
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
