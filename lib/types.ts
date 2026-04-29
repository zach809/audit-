/**
 * Shared types for the Clio Audit application
 * Gmail/OpenAI types removed - this is now Clio-only
 */

// Re-export Clio types for convenience
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
