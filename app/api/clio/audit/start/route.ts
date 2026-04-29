import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isClioConnected } from '@/lib/clio/client'
import { startAuditRun, getCurrentAuditRun } from '@/lib/clio/audit-engine'
import type { StartAuditRequest, StartAuditResponse } from '@/lib/clio/types'

export async function POST(request: NextRequest) {
  console.log('[v0] [Clio Audit Start] POST called')
  try {
    // Verify user is authenticated
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      console.log('[v0] [Clio Audit Start] Unauthorized - no user')
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.log('[v0] [Clio Audit Start] User authenticated:', user.email)

    // Check if Clio is connected
    const connected = await isClioConnected()
    console.log('[v0] [Clio Audit Start] Clio connected:', connected)
    if (!connected) {
      return NextResponse.json(
        { success: false, error: 'Clio not connected' },
        { status: 400 }
      )
    }

    // Check if there's an in-progress audit (only resume truly in-progress ones)
    const currentRun = await getCurrentAuditRun()
    console.log('[v0] [Clio Audit Start] Current run:', currentRun?.id, 'status:', currentRun?.status)
    if (currentRun && (currentRun.status === 'pending' || currentRun.status === 'in_progress')) {
      console.log('[v0] [Clio Audit Start] Resuming existing audit run:', currentRun.id)
      return NextResponse.json({
        success: true,
        audit_run_id: currentRun.id,
        message: 'Resuming existing audit run',
      } satisfies StartAuditResponse)
    }

    // Parse request body
    let body: StartAuditRequest = {}
    try {
      body = await request.json()
    } catch {
      // Empty body is fine
    }
    console.log('[v0] [Clio Audit Start] Request body:', body)

    const batchSize = body.batch_size || 5  // Small batches to avoid rate limits
    const startDate = body.start_date || null
    const endDate = body.end_date || null

    // Calculate time window days from dates, or default to 14
    let timeWindowDays = 14
    if (startDate && endDate) {
      const start = new Date(startDate)
      const end = new Date(endDate)
      timeWindowDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
    }
    console.log('[v0] [Clio Audit Start] Starting audit with batchSize:', batchSize, 'timeWindowDays:', timeWindowDays, 'startDate:', startDate, 'endDate:', endDate)

    // Start new audit run
    const auditRun = await startAuditRun(batchSize, timeWindowDays, startDate, endDate)
    console.log('[v0] [Clio Audit Start] New audit run created:', auditRun.id, 'total_matters:', auditRun.total_matters)

    return NextResponse.json({
      success: true,
      audit_run_id: auditRun.id,
      message: `Started new audit with ${auditRun.total_matters} matters`,
    } satisfies StartAuditResponse)
  } catch (error) {
    console.error('[v0] [Clio Audit Start] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

