/**
 * Clio API Client
 * 
 * Rate-limit safe, batched API client for Clio.
 * - Respects API limits
 * - Handles 429 errors gracefully
 * - Uses proper query parameter serialization
 * - Caches responses where appropriate
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
// RATE LIMIT SAFE: Use smaller limits and fewer pages
const DEFAULT_LIMIT = 50  // Reduced from 200
const MAX_PAGES = 2       // Reduced from 5
const CACHE_TTL_MINUTES = 60  // Cache longer to reduce API calls

/**
 * Safe query parameter builder
 * Ensures all values are properly serialized as strings
 * Never drops keys like `from` or `to`
 */
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

/**
 * Get Clio tokens from database
 */
async function getTokens(): Promise<ClioTokens | null> {
  const supabase = createAdminClient()
  
  const { data, error } = await supabase
    .from('clio_tokens')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (error || !data) {
    console.error('[Clio] Failed to get tokens:', error)
    return null
  }

  return data as ClioTokens
}

/**
 * Refresh Clio access token
 */
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
      console.error('[Clio] Token refresh failed:', response.status)
      return null
    }

    const data = await response.json()
    
    const supabase = createAdminClient()
    const newTokens: Partial<ClioTokens> = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expiry_date: Date.now() + (data.expires_in * 1000),
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

/**
 * Get valid access token (refreshing if needed)
 */
async function getValidAccessToken(): Promise<string | null> {
  let tokens = await getTokens()
  
  if (!tokens) {
    console.error('[Clio] No tokens found')
    return null
  }

  // Check if token is expired or expiring soon (within 5 minutes)
  const expiresIn = tokens.expiry_date - Date.now()
  if (expiresIn < 5 * 60 * 1000) {
    console.log('[Clio] Token expired or expiring soon, refreshing...')
    tokens = await refreshTokens(tokens)
    if (!tokens) {
      return null
    }
  }

  return tokens.access_token
}

/**
 * Check cache for API response
 */
async function getCachedResponse<T>(cacheKey: string): Promise<T | null> {
  const supabase = createAdminClient()
  
  const { data, error } = await supabase
    .from('clio_audit_cache')
    .select('response, expires_at')
    .eq('cache_key', cacheKey)
    .single()

  if (error || !data) {
    return null
  }

  // Check if expired
  if (new Date(data.expires_at) < new Date()) {
    // Delete expired cache entry
    await supabase.from('clio_audit_cache').delete().eq('cache_key', cacheKey)
    return null
  }

  return data.response as T
}

/**
 * Save response to cache
 */
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
    .upsert({
      cache_key: cacheKey,
      endpoint,
      params,
      response,
      expires_at: expiresAt.toISOString(),
    }, {
      onConflict: 'cache_key',
    })
}

/**
 * Make authenticated request to Clio API
 * Handles rate limiting by throwing ClioRateLimitError
 */
async function clioRequest<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
  useCache = true
): Promise<T> {
  const queryString = buildQuery(params)
  const url = `${CLIO_API_BASE}${endpoint}${queryString ? `?${queryString}` : ''}`
  const cacheKey = `${endpoint}:${queryString}`

  // Check cache first
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
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  // Handle rate limiting
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After')
    const resetAt = retryAfter ? new Date(Date.now() + parseInt(retryAfter) * 1000) : undefined
    console.error('[Clio] Rate limited!', { retryAfter, resetAt })
    throw new ClioRateLimitError('Clio API rate limit exceeded', resetAt)
  }

  if (!response.ok) {
    const errorText = await response.text()
    console.error('[Clio] API error:', response.status, errorText)
    throw new Error(`Clio API error: ${response.status}`)
  }

  const data = await response.json()

  // Cache successful response
  if (useCache) {
    await cacheResponse(cacheKey, endpoint, params, data)
  }

  return data as T
}

/**
 * Small delay to help with rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Paginated request with controlled limits
 * Stops after MAX_PAGES or when no more data
 * RATE LIMIT SAFE: Limited pages, delays between requests
 */
async function clioRequestPaginated<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
  maxPages = MAX_PAGES
): Promise<T[]> {
  const allData: T[] = []
  let page = 0
  let nextUrl: string | undefined = undefined

  while (page < maxPages) {
    // Add small delay between paginated requests
    if (page > 0) {
      await delay(200)
    }
    const requestParams = {
      ...params,
      limit: DEFAULT_LIMIT,
    }

    let response: ClioPaginatedResponse<T>

    if (nextUrl) {
      // Use next URL directly for pagination
      const accessToken = await getValidAccessToken()
      if (!accessToken) throw new Error('Clio not connected')

      const res = await fetch(nextUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After')
        const resetAt = retryAfter ? new Date(Date.now() + parseInt(retryAfter) * 1000) : undefined
        throw new ClioRateLimitError('Clio API rate limit exceeded', resetAt)
      }

      if (!res.ok) throw new Error(`Clio API error: ${res.status}`)
      response = await res.json()
    } else {
      response = await clioRequest<ClioPaginatedResponse<T>>(endpoint, requestParams, false)
    }

    if (response.data && response.data.length > 0) {
      allData.push(...response.data)
    }

    // Check if there's more data
    nextUrl = response.meta?.paging?.next
    if (!nextUrl || response.data.length < DEFAULT_LIMIT) {
      break
    }

    page++
  }

  return allData
}

// ============================================
// Public API Methods (Matter-scoped)
// ============================================

/**
 * Get matters created within the time window
 */
export async function getRecentMatters(
  fromDate: Date,
  toDate: Date,
  limit = DEFAULT_LIMIT
): Promise<ClioMatter[]> {
  const params = {
    fields: 'id,display_number,description,status,open_date,close_date,pending_date,created_at,updated_at,client{id,name,type},responsible_attorney{id,name}',
    created_since: fromDate.toISOString(),
    limit,
    order: 'created_at(desc)',
  }

  return clioRequestPaginated<ClioMatter>('/matters.json', params)
}

/**
 * Get a single matter by ID
 */
export async function getMatter(matterId: string | number): Promise<ClioMatter | null> {
  try {
    const response = await clioRequest<{ data: ClioMatter }>(
      `/matters/${matterId}.json`,
      {
        fields: 'id,display_number,description,status,open_date,close_date,pending_date,created_at,updated_at,client{id,name,type},responsible_attorney{id,name}',
      }
    )
    return response.data
  } catch {
    return null
  }
}

/**
 * Get calendar entries for a specific matter
 * Uses correct `from` and `to` parameters (NOT start_at/end_at)
 * RATE LIMIT SAFE: Single page only, minimal fields
 */
export async function getMatterCalendarEntries(
  matterId: string | number,
  fromDate: Date,
  toDate: Date
): Promise<ClioCalendarEntry[]> {
  const params = {
    matter_id: String(matterId),
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    fields: 'id,summary,description,start_at,end_at,attendees{id,name}',
    limit: DEFAULT_LIMIT,
  }

  // Only 1 page for calendar - most matters won't have many entries
  return clioRequestPaginated<ClioCalendarEntry>('/calendar_entries.json', params, 1)
}

/**
 * Get communications for a specific matter
 * RATE LIMIT SAFE: Single page only, minimal fields
 */
export async function getMatterCommunications(
  matterId: string | number,
  fromDate: Date,
  toDate: Date
): Promise<ClioCommunication[]> {
  const params = {
    matter_id: String(matterId),
    created_since: fromDate.toISOString(),
    fields: 'id,subject,body,type,date,created_at',
    limit: DEFAULT_LIMIT,
  }

  // Only 1 page - we just need to check for specific emails
  return clioRequestPaginated<ClioCommunication>('/communications.json', params, 1)
}

/**
 * Get documents for a specific matter
 * RATE LIMIT SAFE: Single page only, minimal fields
 */
export async function getMatterDocuments(
  matterId: string | number
): Promise<ClioDocument[]> {
  const params = {
    matter_id: String(matterId),
    fields: 'id,name,created_at',
    limit: DEFAULT_LIMIT,
  }

  // Only 1 page - we just need to check for retainer document
  return clioRequestPaginated<ClioDocument>('/documents.json', params, 1)
}

/**
 * Check if Clio is connected
 */
export async function isClioConnected(): Promise<boolean> {
  const tokens = await getTokens()
  return tokens !== null
}

/**
 * Clear expired cache entries
 */
export async function clearExpiredCache(): Promise<void> {
  const supabase = createAdminClient()
  
  await supabase
    .from('clio_audit_cache')
    .delete()
    .lt('expires_at', new Date().toISOString())
}
