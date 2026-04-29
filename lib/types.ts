export * from './clio/types'

export type AuditSummary = {
  id: string
  audit_date: string
  total_emails_scanned: number
  looks_good: number
  needs_follow_up: number
  no_reply: number
  needs_clarification: number
  summary_sent: boolean
  summary_sent_at: string | null
}

export type EmailAudit = {
  id: string
  thread_id: string
  message_id?: string
  email_type: 'court_results' | 'add_to_calendar'
  subject: string
  client_name?: string
  attorney?: string
  expected_case_manager?: string
  actual_replier?: string
  county?: string
  case_number?: string
  next_court_date?: string
  audit_status: string
  flags?: string[]
  missing_or_unclear?: string
  case_manager_reply?: string
  attorney_instructions?: string
  audited_at?: string
  created_at?: string
}
