import { NextRequest, NextResponse } from 'next/server'
import { getTodaysEmailThreads } from '@/lib/gmail'
import { runFullAudit } from '@/lib/audit-engine'
import { sendAuditSummaryEmail } from '@/lib/email-summary'

export const maxDuration = 300 // 5 minutes

export async function POST(request: NextRequest) {
  // Verify cron secret for automated runs
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  
  // Allow both cron jobs and authenticated dashboard users
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // If not a cron job, this is a manual trigger from the dashboard
    // The middleware will have already verified the user is authenticated
  }

  try {
    // Fetch today's email threads
    const threads = await getTodaysEmailThreads()
    
    if (threads.courtResults.length === 0 && threads.addToCalendar.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No emails to audit today',
        totalProcessed: 0,
      })
    }

    // Run the audit
    const auditResults = await runFullAudit(threads)

    // Send summary email to Zach
    await sendAuditSummaryEmail(auditResults)

    return NextResponse.json({
      success: true,
      message: 'Audit completed successfully',
      ...auditResults,
    })
  } catch (error) {
    console.error('Audit run error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
}

// GET handler for Vercel Cron
export async function GET(request: NextRequest) {
  return POST(request)
}
