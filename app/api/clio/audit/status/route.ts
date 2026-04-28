import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuditRun, getCurrentAuditRun } from '@/lib/clio/audit-engine'
import type { AuditStatusResponse } from '@/lib/clio/types'

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

    let auditRun

    if (auditRunId) {
      auditRun = await getAuditRun(auditRunId)
    } else {
      auditRun = await getCurrentAuditRun()
    }

    if (!auditRun) {
      return NextResponse.json({
        success: true,
        audit_run: null,
      } as AuditStatusResponse)
    }

    return NextResponse.json({
      success: true,
      audit_run: auditRun,
    } as AuditStatusResponse)
  } catch (error) {
    console.error('[Clio Audit Status] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
