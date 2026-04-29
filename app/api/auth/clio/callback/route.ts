import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function getRedirectUri(request: NextRequest): string {
  if (process.env.CLIO_REDIRECT_URI) {
    return process.env.CLIO_REDIRECT_URI
  }
  
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/clio/callback`
  }
  
  return `${request.nextUrl.origin}/api/auth/clio/callback`
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const origin = request.nextUrl.origin

  if (error) {
    console.error('[Clio OAuth] Auth error:', error)
    return NextResponse.redirect(`${origin}/dashboard/settings?error=clio_auth_failed`)
  }

  if (!code) {
    console.error('[Clio OAuth] No authorization code')
    return NextResponse.redirect(`${origin}/dashboard/settings?error=no_code`)
  }

  const clientId = process.env.CLIO_CLIENT_ID
  const clientSecret = process.env.CLIO_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('[Clio OAuth] Missing credentials')
    return NextResponse.redirect(`${origin}/dashboard/settings?error=clio_not_configured`)
  }

  const redirectUri = getRedirectUri(request)

  try {
    const tokenResponse = await fetch('https://app.clio.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('[Clio OAuth] Token exchange failed:', errorText)
      return NextResponse.redirect(`${origin}/dashboard/settings?error=token_exchange_failed`)
    }

    const tokens = await tokenResponse.json()

    const supabase = createAdminClient()

    const { error: dbError } = await supabase.rpc('upsert_clio_tokens', {
      p_access_token: tokens.access_token,
      p_refresh_token: tokens.refresh_token,
      p_expires_at: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString(),
      p_token_type: tokens.token_type || 'Bearer',
    })

    if (dbError) {
      console.error('[Clio OAuth] Failed to store tokens:', dbError)
      return NextResponse.redirect(`${origin}/dashboard/settings?error=db_error`)
    }

    console.log('[Clio OAuth] Tokens stored successfully')
    return NextResponse.redirect(`${origin}/dashboard/settings?clio=connected`)
  } catch (err) {
    console.error('[Clio OAuth] Error:', err)
    return NextResponse.redirect(`${origin}/dashboard/settings?error=clio_error`)
  }
}
