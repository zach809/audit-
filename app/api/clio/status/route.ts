import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isClioConnected } from '@/lib/clio/client'

export async function GET() {
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

    const connected = await isClioConnected()

    return NextResponse.json({
      success: true,
      connected,
    })
  } catch (error) {
    console.error('[Clio Status] Error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
