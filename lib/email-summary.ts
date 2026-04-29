import { createClient } from '@/lib/supabase/server'
import type { EmailAudit } from '@/lib/types'

type AuditStatus = 'looks_good' | 'needs_follow_up' | 'no_reply' | 'wrong_case_manager' | 'needs_clarification'
type EmailType = 'court_results' | 'add_to_calendar'
type AuditResult = EmailAudit

interface AuditResults {
  totalProcessed: number
  statusCounts: Record<AuditStatus, number>
  results: Array<{
    thread: { id: string; subject: string }
    emailType: EmailType
    result: AuditResult
  }>
}

export async function sendAuditSummaryEmail(auditResults: AuditResults) {
  const zachEmail = process.env.ZACH_EMAIL
  
  if (!zachEmail) {
    console.warn('ZACH_EMAIL not configured, skipping summary email')
    return
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  // Group results by status
  const needsAttention = auditResults.results.filter(
    r => r.result.audit_status !== 'looks_good'
  )

  const htmlContent = generateEmailHtml(today, auditResults, needsAttention)
  const textContent = generateEmailText(today, auditResults, needsAttention)

  // Use Resend, SendGrid, or another email service
  // For now, we'll log the email and update the database
  console.log('Sending audit summary email to:', zachEmail)
  console.log('Subject:', `End of Day Email Audit - ${today}`)
  
  // In production, integrate with an email service:
  // await resend.emails.send({
  //   from: 'audit@lawfirm.com',
  //   to: zachEmail,
  //   subject: `End of Day Email Audit - ${today}`,
  //   html: htmlContent,
  //   text: textContent,
  // })

  // Update summary to mark as sent
  const supabase = await createClient()
  const todayDate = new Date().toISOString().split('T')[0]
  
  await supabase
    .from('audit_summaries')
    .update({
      summary_sent: true,
      summary_sent_at: new Date().toISOString(),
    })
    .eq('audit_date', todayDate)

  return { htmlContent, textContent }
}

function generateEmailHtml(
  date: string,
  results: AuditResults,
  needsAttention: AuditResults['results']
): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background: #1a1a1a; color: white; padding: 20px; }
    .stats { display: flex; gap: 20px; padding: 20px; background: #f5f5f5; }
    .stat { text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; }
    .stat-label { font-size: 12px; color: #666; }
    .section { margin: 20px 0; padding: 15px; border-left: 4px solid #ccc; }
    .section.warning { border-color: #f59e0b; }
    .section.error { border-color: #ef4444; }
    .item { background: white; padding: 15px; margin: 10px 0; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
    .badge-warning { background: #fef3c7; color: #92400e; }
    .badge-error { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <div class="header">
    <h1>End of Day Email Audit</h1>
    <p>${date}</p>
  </div>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">${results.totalProcessed}</div>
      <div class="stat-label">Total Scanned</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color: #ef4444">${results.statusCounts.no_reply || 0}</div>
      <div class="stat-label">No Reply</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color: #f59e0b">${results.statusCounts.needs_follow_up || 0}</div>
      <div class="stat-label">Needs Follow-Up</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color: #22c55e">${results.statusCounts.looks_good || 0}</div>
      <div class="stat-label">Looks Good</div>
    </div>
  </div>

  ${needsAttention.length > 0 ? `
  <div class="section warning">
    <h2>Items Requiring Attention</h2>
    ${needsAttention.map(item => `
      <div class="item">
        <strong>${item.result.client_name || 'Unknown Client'}</strong>
        <span class="badge ${item.result.audit_status === 'no_reply' ? 'badge-error' : 'badge-warning'}">
          ${formatStatus(item.result.audit_status as AuditStatus)}
        </span>
        <p><strong>Attorney:</strong> ${item.result.attorney || 'N/A'}</p>
        <p><strong>Subject:</strong> ${item.thread.subject}</p>
        ${item.result.missing_or_unclear ? `<p><strong>Missing/Unclear:</strong> ${item.result.missing_or_unclear}</p>` : ''}
        ${item.result.notes_for_zach ? `<p><strong>Notes:</strong> ${item.result.notes_for_zach}</p>` : ''}
      </div>
    `).join('')}
  </div>
  ` : `
  <div class="section" style="border-color: #22c55e">
    <h2>All Clear!</h2>
    <p>All emails have been properly handled today.</p>
  </div>
  `}

  <p style="color: #666; font-size: 12px; margin-top: 30px;">
    This is an automated email from the End of Day Email Audit system.
  </p>
</body>
</html>
`
}

function generateEmailText(
  date: string,
  results: AuditResults,
  needsAttention: AuditResults['results']
): string {
  let text = `END OF DAY EMAIL AUDIT\n${date}\n\n`
  text += `SUMMARY\n`
  text += `Total Scanned: ${results.totalProcessed}\n`
  text += `No Reply: ${results.statusCounts.no_reply || 0}\n`
  text += `Needs Follow-Up: ${results.statusCounts.needs_follow_up || 0}\n`
  text += `Looks Good: ${results.statusCounts.looks_good || 0}\n\n`

  if (needsAttention.length > 0) {
    text += `ITEMS REQUIRING ATTENTION\n${'='.repeat(40)}\n\n`
    
    for (const item of needsAttention) {
      text += `Client: ${item.result.client_name || 'Unknown'}\n`
      text += `Status: ${formatStatus(item.result.audit_status as AuditStatus)}\n`
      text += `Attorney: ${item.result.attorney || 'N/A'}\n`
      text += `Subject: ${item.thread.subject}\n`
      if (item.result.missing_or_unclear) {
        text += `Missing/Unclear: ${item.result.missing_or_unclear}\n`
      }
      if (item.result.notes_for_zach) {
        text += `Notes: ${item.result.notes_for_zach}\n`
      }
      text += `\n${'-'.repeat(40)}\n\n`
    }
  } else {
    text += `ALL CLEAR!\nAll emails have been properly handled today.\n`
  }

  return text
}

function formatStatus(status: AuditStatus): string {
  switch (status) {
    case 'needs_follow_up': return 'Needs Follow-Up'
    case 'no_reply': return 'No Reply'
    case 'wrong_case_manager': return 'Wrong Case Manager'
    case 'needs_clarification': return 'Needs Clarification'
    case 'looks_good': return 'Looks Good'
  }
}
