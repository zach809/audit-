import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isClioConnected } from '@/lib/clio/client'
import { startAuditRun, getCurrentAuditRun } from '@/lib/clio/audit-engine'
import type { StartAuditRequest, StartAuditResponse } from '@/lib/clio/types'

export async function POST(request: NextRequest) {
  try {
    // -----------------------------
    // Auth check
    // -----------------------------
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // -----------------------------
    // Clio connection check
    // -----------------------------
    const connected = await isClioConnected()

    if (!connected) {
      return NextResponse.json(
        { success: false, error: 'Clio not connected' },
        { status: 400 }
      )
    }

    // -----------------------------
    // Resume existing audit if active
    // -----------------------------
    const currentRun = await getCurrentAuditRun()

    if (
      currentRun &&
      (currentRun.status === 'pending' || currentRun.status === 'in_progress')
    ) {
      return NextResponse.json({
        success: true,
        audit_run_id: currentRun.id,
        message: 'Resuming existing audit run',
      } satisfies StartAuditResponse)
    }

    // -----------------------------
    // Parse request body safely
    // -----------------------------
    let body: StartAuditRequest = {}

    try {
      const parsed = await request.json()
      if (parsed && typeof parsed === 'object') {
        body = parsed
      }
    } catch {
      // ignore empty/invalid body
    }

    const batchSize = body.batch_size ?? 5
    const startDate = body.start_date ?? null
    const endDate = body.end_date ?? null

    // -----------------------------
    // Calculate time window
    // -----------------------------
    let timeWindowDays = 14

    if (startDate && endDate) {
      const start = new Date(startDate)
      const end = new Date(endDate)

      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const diffMs = end.getTime() - start.getTime()

        timeWindowDays =
          Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1
      }
    }

    // -----------------------------
    // Start audit run
    // -----------------------------
    const auditRun = await startAuditRun(
      batchSize,
      timeWindowDays,
      startDate,
      endDate
    )

    return NextResponse.json({
      success: true,
      audit_run_id: auditRun.id,
      message: `Started new audit with ${auditRun.total_matters} matters`,
    } satisfies StartAuditResponse)
  } catch (error) {
    console.error('[Clio Audit Start] Error:', error)

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
