export type EmailType = 'court_results' | 'add_to_calendar'

export type AuditStatus = 
  | 'needs_follow_up' 
  | 'no_reply' 
  | 'wrong_case_manager' 
  | 'needs_clarification' 
  | 'looks_good'

export interface AttorneyAssignment {
  id: string
  attorney_name: string
  case_manager_name: string | null
  is_unassigned: boolean
  created_at: string
  updated_at: string
}

export interface EmailAudit {
  id: string
  thread_id: string
  message_id: string | null
  email_type: EmailType
  subject: string
  client_name: string | null
  attorney: string | null
  expected_case_manager: string | null
  actual_replier: string | null
  county: string | null
  case_number: string | null
  next_court_date: string | null
  result_or_onboarding_details: string | null
  attorney_instructions: string | null
  case_manager_reply: string | null
  is_reply_specific: boolean | null
  missing_or_unclear: string | null
  audit_status: AuditStatus
  flags: string[] | null
  notes_for_zach: string | null
  raw_thread_json: unknown
  audited_at: string
  created_at: string
}

export interface AuditSummary {
  id: string
  audit_date: string
  total_emails_scanned: number
  needs_follow_up: number
  no_reply: number
  wrong_case_manager: number
  needs_clarification: number
  looks_good: number
  summary_sent: boolean
  summary_sent_at: string | null
  created_at: string
}

export interface GmailToken {
  id: string
  access_token: string
  refresh_token: string
  expiry_date: number
  email: string
  created_at: string
  updated_at: string
}

// OpenAI audit response structure
export interface AuditResult {
  client_name: string | null
  attorney: string | null
  county: string | null
  case_number: string | null
  next_court_date: string | null
  result_or_onboarding_details: string | null
  attorney_instructions: string | null
  case_manager_reply: string | null
  actual_replier: string | null
  is_reply_specific: boolean
  missing_or_unclear: string | null
  audit_status: AuditStatus
  flags: string[]
  notes_for_zach: string | null
}

// Dashboard filter state
export interface DashboardFilters {
  status: AuditStatus | 'all'
  emailType: EmailType | 'all'
  dateRange: 'today' | 'week' | 'month' | 'all'
  attorney: string | 'all'
}
