import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function getRedirectUri(request: NextRequest): string {
  // First try explicit redirect URI env var
  if (process.env.GOOGLE_REDIRECT_URI) {
    console.log('[v0] Callback using GOOGLE_REDIRECT_URI:', process.env.GOOGLE_REDIRECT_URI)
    return process.env.GOOGLE_REDIRECT_URI
  }
  
  // Then try app URL env var
  if (process.env.NEXT_PUBLIC_APP_URL) {
    const uri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/gmail/callback`
    console.log('[v0] Callback using NEXT_PUBLIC_APP_URL redirect:', uri)
    return uri
  }
  
  // Use request origin as fallback
  const uri = `${request.nextUrl.origin}/api/auth/gmail/callback`
  console.log('[v0] Callback using request origin redirect:', uri)
  return uri
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const origin = request.nextUrl.origin

  if (error) {
    return NextResponse.redirect(`${origin}/dashboard/settings?error=gmail_auth_failed`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/dashboard/settings?error=no_code`)
  }

  try {
    const redirectUri = getRedirectUri(request)
    console.log('[v0] Callback OAuth redirect URI:', redirectUri)
    
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    )
    
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    // Get user email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: userInfo } = await oauth2.userinfo.get()

    const supabase = createAdminClient()

    console.log('[v0] Storing Gmail tokens for:', userInfo.email)
    console.log('[v0] Has access_token:', !!tokens.access_token)
    console.log('[v0] Has refresh_token:', !!tokens.refresh_token)

    // Store tokens in database
    const { error: dbError } = await supabase
      .from('gmail_tokens')
      .upsert({
        access_token: tokens.access_token!,
        refresh_token: tokens.refresh_token!,
        expiry_date: tokens.expiry_date!,
        email: userInfo.email!,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'email',
      })

    if (dbError) {
      console.error('[v0] Failed to store Gmail tokens:', dbError)
      console.error('[v0] DB Error details:', JSON.stringify(dbError))
      return NextResponse.redirect(`${origin}/dashboard/settings?error=db_error`)
    }

    console.log('[v0] Gmail tokens stored successfully!')
    return NextResponse.redirect(`${origin}/dashboard/settings?gmail=connected`)
  } catch (err) {
    console.error('Gmail OAuth error:', err)
    return NextResponse.redirect(`${origin}/dashboard/settings?error=oauth_failed`)
  }
}
