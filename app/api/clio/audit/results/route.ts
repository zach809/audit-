import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuditRun, getAuditResults, getAuditSummary } from '@/lib/clio/audit-engine'
import type { AuditResultsResponse } from '@/lib/clio/types'

export async function GET(request: NextRequest) {
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

    // Get audit run ID from query params
    const { searchParams } = request.nextUrl
    const auditRunId = searchParams.get('audit_run_id')

    if (!auditRunId) {
      return NextResponse.json(
        { success: false, error: 'audit_run_id is required' },
        { status: 400 }
      )
    }

    const auditRun = await getAuditRun(auditRunId)

    if (!auditRun) {
      return NextResponse.json(
        { success: false, error: 'Audit run not found' },
        { status: 404 }
      )
    }

    // Get results and summary
    const [results, summary] = await Promise.all([
      getAuditResults(auditRunId),
      getAuditSummary(auditRunId),
    ])

    return NextResponse.json({
      success: true,
      audit_run: auditRun,
      results,
      summary,
    } as AuditResultsResponse)
  } catch (error) {
    console.error('[Clio Audit Results] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
