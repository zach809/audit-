// Clio API Types

export interface ClioTokens {
  id: string
  access_token: string
  refresh_token: string
  expiry_date: number
  token_type: string
  updated_at?: string
}

export interface ClioMatter {
  id: number
  display_number: string
  description: string
  status: string
  open_date: string
  close_date?: string
  pending_date?: string
  created_at: string
  updated_at: string
  client?: {
    id: number
    name: string
    type: string
  }
  responsible_attorney?: {
    id: number
    name: string
  }
}

export interface ClioCalendarEntry {
  id: number
  etag: string
  summary: string
  description?: string
  location?: string
  start_at: string
  end_at: string
  all_day: boolean
  created_at: string
  updated_at: string
  matter?: {
    id: number
    display_number: string
  }
  attendees?: Array<{
    id: number
    name: string
    type: string
  }>
}

export interface ClioCommunication {
  id: number
  subject: string
  body?: string
  type: string
  date: string
  created_at: string
  updated_at: string
  matter?: {
    id: number
    display_number: string
  }
  senders?: Array<{
    id: number
    name: string
    type: string
  }>
  receivers?: Array<{
    id: number
    name: string
    type: string
  }>
}

export interface ClioDocument {
  id: number
  name: string
  content_type: string
  created_at: string
  updated_at: string
  matter?: {
    id: number
    display_number: string
  }
}

export interface ClioPaginatedResponse<T> {
  data: T[]
  meta: {
    paging?: {
      next?: string
      previous?: string
    }
    records?: number
  }
}

// Audit Types

export type AuditRunStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'rate_limited'
export type MatterAuditStatus = 'pass' | 'needs_review' | 'missing_evidence'

export interface ClioAuditRun {
  id: string
  status: AuditRunStatus
  total_matters: number
  processed_matters: number
  current_batch: number
  batch_size: number
  time_window_days: number
  last_processed_matter_id: string | null
  matter_ids_to_process: string[] | null
  started_at: string
  completed_at: string | null
  error_message: string | null
  rate_limit_reset_at: string | null
  created_at: string
  updated_at: string
}

export interface ClioMatterAudit {
  id: string
  audit_run_id: string
  matter_id: string
  matter_display_number: string | null
  client_name: string | null
  attorney_name: string | null
  matter_status: string | null
  matter_created_at: string | null
  overall_status: MatterAuditStatus
  
  // Intake checks
  intake_calendar_exists: boolean
  intake_calendar_date: string | null
  matter_created_in_clio: boolean
  response_time_hours: number | null
  response_time_met: boolean | null
  meeting_scheduled_within_48h: boolean | null
  meeting_date: string | null
  welcome_packet_sent: boolean
  welcome_packet_date: string | null
  
  // Appearance checks
  appearance_filed_within_48h: boolean | null
  appearance_date: string | null
  appearance_email_sent: boolean
  appearance_email_date: string | null
  attorney_correctly_assigned: boolean | null
  client_name_consistent: boolean | null
  signed_retainer_exists: boolean
  signed_retainer_date: string | null
  
  // Evidence and flags
  evidence: Record<string, unknown>
  flags: string[]
  missing_items: string[]
  notes: string | null
  
  created_at: string
  updated_at: string
}

export interface ClioAuditCache {
  id: string
  cache_key: string
  endpoint: string
  params: Record<string, unknown> | null
  response: unknown
  expires_at: string
  created_at: string
}

// API Request/Response types

export interface StartAuditRequest {
  batch_size?: number
  time_window_days?: number
  start_date?: string
  end_date?: string
}

export interface StartAuditResponse {
  success: boolean
  audit_run_id?: string
  message?: string
  error?: string
}

export interface ProcessBatchRequest {
  audit_run_id: string
}

export interface ProcessBatchResponse {
  success: boolean
  audit_run_id: string
  status: AuditRunStatus
  processed_in_batch: number
  total_processed: number
  total_matters: number
  rate_limited?: boolean
  error?: string
}

export interface AuditStatusResponse {
  success: boolean
  audit_run?: ClioAuditRun
  error?: string
}

export interface AuditResultsResponse {
  success: boolean
  audit_run?: ClioAuditRun
  results?: ClioMatterAudit[]
  summary?: {
    total: number
    pass: number
    needs_review: number
    missing_evidence: number
  }
  error?: string
}

// Rate limit error
export class ClioRateLimitError extends Error {
  resetAt: Date | null

  constructor(message: string, resetAt?: Date) {
    super(message)
    this.name = 'ClioRateLimitError'
    this.resetAt = resetAt || null
  }
}
