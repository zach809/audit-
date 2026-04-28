import { NextRequest, NextResponse } from 'next/server'

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
  const clientId = process.env.CLIO_CLIENT_ID
  
  if (!clientId) {
    console.error('[Clio OAuth] Missing CLIO_CLIENT_ID')
    return NextResponse.redirect(
      new URL('/dashboard/settings?error=clio_not_configured', request.url)
    )
  }

  const redirectUri = getRedirectUri(request)
  
  const authUrl = new URL('https://app.clio.com/oauth/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)

  console.log('[Clio OAuth] Redirecting to:', authUrl.toString())
  
  return NextResponse.redirect(authUrl.toString())
}
