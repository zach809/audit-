import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'

function getRedirectUri(request?: NextRequest): string {
  // First try explicit redirect URI env var
  if (process.env.GOOGLE_REDIRECT_URI) {
    console.log('[v0] Using GOOGLE_REDIRECT_URI:', process.env.GOOGLE_REDIRECT_URI)
    return process.env.GOOGLE_REDIRECT_URI
  }
  
  // Then try app URL env var
  if (process.env.NEXT_PUBLIC_APP_URL) {
    const uri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/gmail/callback`
    console.log('[v0] Using NEXT_PUBLIC_APP_URL redirect:', uri)
    return uri
  }
  
  // Use request origin as fallback
  if (request) {
    const uri = `${request.nextUrl.origin}/api/auth/gmail/callback`
    console.log('[v0] Using request origin redirect:', uri)
    return uri
  }
  
  console.error('[v0] Missing Google OAuth env vars: GOOGLE_REDIRECT_URI and NEXT_PUBLIC_APP_URL')
  throw new Error('Missing GOOGLE_REDIRECT_URI or NEXT_PUBLIC_APP_URL environment variable')
}

export async function GET(request: NextRequest) {
  const redirectUri = getRedirectUri(request)
  console.log('[v0] Google OAuth redirect URI:', redirectUri)
  
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  )

  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ]

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  })

  return NextResponse.redirect(url)
}
