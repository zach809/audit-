import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/gmail/callback`
)

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
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    // Get user email
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const { data: userInfo } = await oauth2.userinfo.get()

    const supabase = await createClient()

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
      console.error('Failed to store Gmail tokens:', dbError)
      return NextResponse.redirect(`${origin}/dashboard/settings?error=db_error`)
    }

    return NextResponse.redirect(`${origin}/dashboard?gmail=connected`)
  } catch (err) {
    console.error('Gmail OAuth error:', err)
    return NextResponse.redirect(`${origin}/dashboard/settings?error=oauth_failed`)
  }
}
