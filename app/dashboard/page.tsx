import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DashboardStats } from '@/components/dashboard/dashboard-stats'
import { AuditSection } from '@/components/dashboard/audit-section'
import { GmailConnectionStatus } from '@/components/dashboard/gmail-connection-status'
import type { EmailAudit, AuditSummary } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createClient()
  
  // Get today's date in the correct format
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  
  // Fetch today's audits
  const { data: audits } = await supabase
    .from('email_audits')
    .select('*')
    .gte('audited_at', today.toISOString())
    .order('audited_at', { ascending: false })
  
  // Fetch today's summary
  const { data: summary } = await supabase
    .from('audit_summaries')
    .select('*')
    .eq('audit_date', today.toISOString().split('T')[0])
    .single()

  // Check if Gmail is connected - use admin client to bypass RLS
  const supabaseAdmin = createAdminClient()
  const { data: gmailToken } = await supabaseAdmin
    .from('gmail_tokens')
    .select('email, updated_at')
    .limit(1)
    .single()

  // Group audits by status
  const needsFollowUp = audits?.filter((a: EmailAudit) => a.audit_status === 'needs_follow_up') || []
  const noReply = audits?.filter((a: EmailAudit) => a.audit_status === 'no_reply') || []
  const wrongCaseManager = audits?.filter((a: EmailAudit) => a.audit_status === 'wrong_case_manager' || a.audit_status === 'needs_clarification') || []
  const looksGood = audits?.filter((a: EmailAudit) => a.audit_status === 'looks_good') || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">End of Day Email Audit</h1>
          <p className="text-muted-foreground">
            {today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <GmailConnectionStatus 
          isConnected={!!gmailToken} 
          email={gmailToken?.email}
          lastSync={gmailToken?.updated_at}
        />
      </div>

      <DashboardStats summary={summary as AuditSummary | null} />

      <div className="grid gap-6">
        <AuditSection 
          title="Clients Needing Follow-Up" 
          description="These clients require immediate attention"
          audits={needsFollowUp}
          variant="warning"
        />
        
        <AuditSection 
          title="No Case Manager Reply Found" 
          description="No response detected in the email thread"
          audits={noReply}
          variant="error"
        />
        
        <AuditSection 
          title="Wrong or Unclear Case Manager" 
          description="Reply from unexpected person or needs clarification"
          audits={wrongCaseManager}
          variant="warning"
        />
        
        <AuditSection 
          title="Looks Good" 
          description="These threads appear to be properly handled"
          audits={looksGood}
          variant="success"
          defaultCollapsed
        />
      </div>
    </div>
  )
}
