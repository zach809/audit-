import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { processBatch, getAuditRun } from '@/lib/clio/audit-engine'
import type { ProcessBatchRequest, ProcessBatchResponse } from '@/lib/clio/types'

export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Parse request body
    const body: ProcessBatchRequest = await request.json()

    if (!body.audit_run_id) {
      return NextResponse.json(
        { success: false, error: 'audit_run_id is required' },
        { status: 400 }
      )
    }

    // Process batch
    const result = await processBatch(body.audit_run_id)

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      )
    }

    // Get updated run status
    const auditRun = await getAuditRun(body.audit_run_id)

    if (!auditRun) {
      return NextResponse.json(
        { success: false, error: 'Audit run not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      audit_run_id: auditRun.id,
      status: auditRun.status,
      processed_in_batch: result.processed,
      total_processed: auditRun.processed_matters,
      total_matters: auditRun.total_matters,
      rate_limited: result.rateLimited,
    } satisfies ProcessBatchResponse)
  } catch (error) {
    console.error('[Clio Audit Batch] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
