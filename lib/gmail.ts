import { google, gmail_v1, calendar_v3 } from 'googleapis'
import { createAdminClient } from '@/lib/supabase/admin'

export interface CalendarEvent {
  id: string
  summary: string
  description: string | null
  start: string | null
  end: string | null
  attendees: string[]
  organizer: string | null
  location: string | null
  status: string
  htmlLink: string | null
}

interface EmailThread {
  id: string
  subject: string
  messages: EmailMessage[]
}

interface EmailMessage {
  id: string
  from: string
  to: string
  date: string
  body: string
  snippet: string
}

export async function getGmailClient() {
  const supabase = createAdminClient()
  
  console.log('[v0] Getting Gmail client, checking for tokens...')
  
  const { data: tokenData, error } = await supabase
    .from('gmail_tokens')
    .select('*')
    .limit(1)
    .single()

  if (error) {
    console.error('[v0] Error fetching Gmail tokens:', error)
    throw new Error('Gmail not connected')
  }
  
  if (!tokenData) {
    console.error('[v0] No Gmail tokens found in database')
    throw new Error('Gmail not connected')
  }
  
  console.log('[v0] Found Gmail tokens for:', tokenData.email)

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  )

  oauth2Client.setCredentials({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expiry_date: tokenData.expiry_date,
  })

  // Handle token refresh
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await supabase
        .from('gmail_tokens')
        .update({
          access_token: tokens.access_token,
          expiry_date: tokens.expiry_date,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tokenData.id)
    }
  })

  return google.gmail({ version: 'v1', auth: oauth2Client })
}

export async function searchEmailThreads(query: string): Promise<string[]> {
  const gmail = await getGmailClient()
  
  const response = await gmail.users.threads.list({
    userId: 'me',
    q: query,
    maxResults: 50,
  })

  return response.data.threads?.map(t => t.id!) || []
}

export async function getEmailThread(threadId: string): Promise<EmailThread | null> {
  const gmail = await getGmailClient()

  try {
    const response = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    })

    const thread = response.data
    if (!thread.messages || thread.messages.length === 0) {
      return null
    }

    const subject = getHeader(thread.messages[0], 'Subject') || 'No Subject'

    const messages: EmailMessage[] = thread.messages.map((msg) => ({
      id: msg.id!,
      from: getHeader(msg, 'From') || '',
      to: getHeader(msg, 'To') || '',
      date: getHeader(msg, 'Date') || '',
      body: getMessageBody(msg),
      snippet: msg.snippet || '',
    }))

    return {
      id: threadId,
      subject,
      messages,
    }
  } catch (err) {
    console.error(`Error fetching thread ${threadId}:`, err)
    return null
  }
}

function getHeader(message: gmail_v1.Schema$Message, name: string): string | undefined {
  return message.payload?.headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  )?.value
}

function getMessageBody(message: gmail_v1.Schema$Message): string {
  const payload = message.payload
  if (!payload) return ''

  // Check for plain text body
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64(payload.body.data)
  }

  // Check for HTML body
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return stripHtml(decodeBase64(payload.body.data))
  }

  // Check parts for multipart messages
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64(part.body.data)
      }
    }
    // Fallback to HTML if no plain text
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        return stripHtml(decodeBase64(part.body.data))
      }
    }
  }

  return message.snippet || ''
}

function decodeBase64(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8')
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function getTodaysEmailThreads() {
  const today = new Date()
  const dateStr = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, '0')}/${String(today.getDate()).padStart(2, '0')}`

  // Search for Court Results emails
  const courtResultsQuery = `subject:"Court Results" after:${dateStr}`
  const courtResultsThreadIds = await searchEmailThreads(courtResultsQuery)

  // Search for Add to Calendar emails  
  const addToCalendarQuery = `subject:"Add to Calendar" after:${dateStr}`
  const addToCalendarThreadIds = await searchEmailThreads(addToCalendarQuery)

  // Fetch full thread data
  const courtResultsThreads = await Promise.all(
    courtResultsThreadIds.map(id => getEmailThread(id))
  )

  const addToCalendarThreads = await Promise.all(
    addToCalendarThreadIds.map(id => getEmailThread(id))
  )

  return {
    courtResults: courtResultsThreads.filter((t): t is EmailThread => t !== null),
    addToCalendar: addToCalendarThreads.filter((t): t is EmailThread => t !== null),
  }
}
