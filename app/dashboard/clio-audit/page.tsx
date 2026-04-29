/**
 * Clio API Client
 *
 * Rate-limit safe, batched API client for Clio.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  ClioTokens,
  ClioMatter,
  ClioCalendarEntry,
  ClioCommunication,
  ClioDocument,
  ClioPaginatedResponse,
  ClioRateLimitError,
} from './types'

const CLIO_API_BASE = 'https://app.clio.com/api/v4'
const DEFAULT_LIMIT = 25
const MAX_PAGES = 1
const CACHE_TTL_MINUTES = 60

class ClioForbiddenError extends Error {
  constructor(message = 'Clio API forbidden') {
    super(message)
    this.name = 'ClioForbiddenError'
  }
}

export function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue

    if (Array.isArray(value)) {
      for (const item of value) {
        search.append(key, String(item))
      }
    } else {
      search.set(key, String(value))
    }
  }

  return search.toString()
}

async function getTokens(): Promise<ClioTokens | null> {
  const { Pool } = await import('pg')

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })

  try {
    const client = await pool.connect()

    try {
      const result = await client.query(`
        SELECT *
        FROM clio_tokens
        ORDER BY created_at DESC
        LIMIT 1
      `)

      const row = result.rows[0]

      if (!row) {
        console.error('[Clio] No token row found in clio_tokens')
        return null
      }

      return {
        ...row,
        expiry_date: row.expiry_date
          ? Number(row.expiry_date)
          : row.expires_at
            ? new Date(row.expires_at).getTime()
            : 0,
      } as ClioTokens
    } finally {
      client.release()
    }
  } catch (error) {
    console.error('[Clio] Direct token lookup failed:', error)
    return null
  } finally {
    await pool.end()
  }
}

async function refreshTokens(tokens: ClioTokens): Promise<ClioTokens | null> {
  const clientId = process.env.CLIO_CLIENT_ID
  const clientSecret = process.env.CLIO_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('[Clio] Missing client credentials')
    return null
  }

  try {
    const response = await fetch('https://app.clio.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('[Clio] Token refresh failed:', response.status, text)
      return null
    }

    const data = await response.json()

    const supabase = createAdminClient()
    const newTokens: Partial<ClioTokens> = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokens.refresh_token,
      expiry_date: Date.now() + data.expires_in * 1000,
      updated_at: new Date().toISOString(),
    }

    await supabase
      .from('clio_tokens')
      .update(newTokens)
      .eq('id', tokens.id)

    return { ...tokens, ...newTokens } as ClioTokens
  } catch (error) {
    console.error('[Clio] Token refresh error:', error)
    return null
  }
}

async function getValidAccessToken(): Promise<string | null> {
  let tokens = await getTokens()

  if (!tokens) {
    console.error('[Clio] No tokens found')
    return null
  }

  const expiresIn = tokens.expiry_date - Date.now()

  if (Number.isFinite(expiresIn) && expiresIn < 5 * 60 * 1000) {
    console.log('[Clio] Token expired or expiring soon, refreshing...')
    tokens = await refreshTokens(tokens)

    if (!tokens) return null
  }

  return tokens.access_token
}

async function getCachedResponse<T>(cacheKey: string): Promise<T | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('clio_audit_cache')
    .select('response, expires_at')
    .eq('cache_key', cacheKey)
    .single()

  if (error || !data) return null

  if (new Date(data.expires_at) < new Date()) {
    await supabase.from('clio_audit_cache').delete().eq('cache_key', cacheKey)
    return null
  }

  return data.response as T
}

async function cacheResponse(
  cacheKey: string,
  endpoint: string,
  params: Record<string, unknown>,
  response: unknown
): Promise<void> {
  const supabase = createAdminClient()
  const expiresAt = new Date(Date.now() + CACHE_TTL_MINUTES * 60 * 1000)

  await supabase
    .from('clio_audit_cache')
    .upsert(
      {
        cache_key: cacheKey,
        endpoint,
        params,
        response,
        expires_at: expiresAt.toISOString(),
      },
      { onConflict: 'cache_key' }
    )
}

async function clioRequest<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
  useCache = true
): Promise<T> {
  const queryString = buildQuery(params)
  const url = `${CLIO_API_BASE}${endpoint}${queryString ? `?${queryString}` : ''}`
  const cacheKey = `${endpoint}:${queryString}`

  if (useCache) {
    const cached = await getCachedResponse<T>(cacheKey)
    if (cached) {
      console.log('[Clio] Cache hit:', endpoint)
      return cached
    }
  }

  const accessToken = await getValidAccessToken()

  if (!accessToken) {
    throw new Error('Clio not connected')
  }

  console.log('[Clio] API request:', endpoint, params)

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After')
    const resetAt = retryAfter
      ? new Date(Date.now() + parseInt(retryAfter) * 1000)
      : undefined

    console.error('[Clio] Rate limited!', { endpoint, params, retryAfter, resetAt })
    throw new ClioRateLimitError('Clio API rate limit exceeded', resetAt)
  }

  if (response.status === 403) {
    const errorText = await response.text()
    console.error('[Clio] API forbidden:', endpoint, params, errorText)
    throw new ClioForbiddenError(`Clio API forbidden: ${endpoint}`)
  }

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Clio] API error:', response.status, endpoint, params, errorText)
    throw new Error(`Clio API error: ${response.status}`)
  }

  const data = await response.json()

  if (useCache) {
    await cacheResponse(cacheKey, endpoint, params, data)
  }

  return data as T
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function clioRequestPaginated<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
  maxPages = MAX_PAGES
): Promise<T[]> {
  const allData: T[] = []
  let page = 0
  let nextUrl: string | undefined = undefined

  while (page < maxPages) {
    if (page > 0) await delay(1000)

    const requestParams = {
      ...params,
      limit: DEFAULT_LIMIT,
    }

    let response: ClioPaginatedResponse<T>

    if (nextUrl) {
      const accessToken = await getValidAccessToken()
      if (!accessToken) throw new Error('Clio not connected')

      const res = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After')
        const resetAt = retryAfter
          ? new Date(Date.now() + parseInt(retryAfter) * 1000)
          : undefined

        throw new ClioRateLimitError('Clio API rate limit exceeded', resetAt)
      }

      if (res.status === 403) {
        const errorText = await res.text()
        console.error('[Clio] API forbidden on pagination:', endpoint, errorText)
        throw new ClioForbiddenError(`Clio API forbidden: ${endpoint}`)
      }

      if (!res.ok) throw new Error(`Clio API error: ${res.status}`)

      response = await res.json()
    } else {
      response = await clioRequest<ClioPaginatedResponse<T>>(
        endpoint,
        requestParams,
        false
      )
    }

    if (response.data && response.data.length > 0) {
      allData.push(...response.data)
    }

    nextUrl = response.meta?.paging?.next

    if (!nextUrl || response.data.length < DEFAULT_LIMIT) break

    page++
  }

  return allData
}

export async function getRecentMatters(
  fromDate: Date,
  toDate: Date,
  limit = DEFAULT_LIMIT
): Promise<ClioMatter[]> {
  const params = {
    fields:
      'id,display_number,description,status,open_date,close_date,pending_date,created_at,updated_at,client{id,name,type},responsible_attorney{id,name}',
    created_since: fromDate.toISOString(),
    created_before: toDate.toISOString(),
    limit,
    order: 'created_at(desc)',
  }

  return clioRequestPaginated<ClioMatter>('/matters.json', params)
}

export async function getMatter(
  matterId: string | number
): Promise<ClioMatter | null> {
  try {
    const response = await clioRequest<{ data: ClioMatter }>(
      `/matters/${matterId}.json`,
      {
        fields:
          'id,display_number,description,status,open_date,close_date,pending_date,created_at,updated_at,client{id,name,type},responsible_attorney{id,name}',
      }
    )

    return response.data
  } catch (error) {
    console.error('[Clio] Could not fetch matter:', matterId, error)
    return null
  }
}

export async function getMatterCalendarEntries(
  matterId: string | number,
  fromDate: Date,
  toDate: Date
): Promise<ClioCalendarEntry[]> {
  try {
    const params = {
      matter_id: String(matterId),
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      fields: 'id,summary,description,start_at,end_at,attendees{id,name}',
      limit: DEFAULT_LIMIT,
    }

    return await clioRequestPaginated<ClioCalendarEntry>(
      '/calendar_entries.json',
      params,
      1
    )
  } catch (error) {
    if (error instanceof ClioForbiddenError) {
      console.warn('[Clio] Calendar entries forbidden; continuing:', matterId)
      return []
    }

    throw error
  }
}

export async function getMatterCommunications(
  matterId: string | number,
  fromDate: Date,
  toDate: Date
): Promise<ClioCommunication[]> {
  try {
    const params = {
      matter_id: String(matterId),
      created_since: fromDate.toISOString(),
      fields: 'id,subject,body,type,date,created_at',
      limit: DEFAULT_LIMIT,
    }

    return await clioRequestPaginated<ClioCommunication>(
      '/communications.json',
      params,
      1
    )
  } catch (error) {
    if (error instanceof ClioForbiddenError) {
      console.warn('[Clio] Communications forbidden; continuing:', matterId)
      return []
    }

    throw error
  }
}

export async function getMatterDocuments(
  matterId: string | number
): Promise<ClioDocument[]> {
  try {
    const params = {
      matter_id: String(matterId),
      fields: 'id,name,created_at',
      limit: DEFAULT_LIMIT,
    }

    return await clioRequestPaginated<ClioDocument>('/documents.json', params, 1)
  } catch (error) {
    if (error instanceof ClioForbiddenError) {
      console.warn('[Clio] Documents forbidden; continuing:', matterId)
      return []
    }

    throw error
  }
}

export async function isClioConnected(): Promise<boolean> {
  const tokens = await getTokens()
  return tokens !== null
}

export async function clearExpiredCache(): Promise<void> {
  const supabase = createAdminClient()

  await supabase
    .from('clio_audit_cache')
    .delete()
    .lt('expires_at', new Date().toISOString())
}
