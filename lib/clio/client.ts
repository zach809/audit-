/**
 * Clio API Client - LOCAL ONLY
 *
 * No Supabase.
 * No cloud cache.
 * No client information stored remotely.
 *
 * Required local env vars:
 * CLIO_ACCESS_TOKEN
 *
 * Optional local env vars:
 * CLIO_REFRESH_TOKEN
 * CLIO_CLIENT_ID
 * CLIO_CLIENT_SECRET
 */

import {
  ClioMatter,
  ClioCalendarEntry,
  ClioCommunication,
  ClioDocument,
  ClioPaginatedResponse,
  ClioRateLimitError,
} from "./types"

const CLIO_API_BASE = "https://app.clio.com/api/v4"
const DEFAULT_LIMIT = 200
const MAX_PAGES = 5

export function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams()

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue

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

function getLocalAccessToken(): string | null {
  return process.env.CLIO_ACCESS_TOKEN || null
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = process.env.CLIO_REFRESH_TOKEN
  const clientId = process.env.CLIO_CLIENT_ID
  const clientSecret = process.env.CLIO_CLIENT_SECRET

  if (!refreshToken || !clientId || !clientSecret) {
    return null
  }

  const response = await fetch("https://app.clio.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!response.ok) {
    console.error("[Clio] Token refresh failed:", response.status)
    return null
  }

  const data = await response.json()

  console.warn(
    "[Clio] Token refreshed in memory only. Update your local .env with the new access token if needed."
  )

  return data.access_token || null
}

async function getValidAccessToken(): Promise<string | null> {
  const token = getLocalAccessToken()

  if (token) return token

  return refreshAccessToken()
}

async function clioRequest<T>(
  endpoint: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const queryString = buildQuery(params)
  const url = `${CLIO_API_BASE}${endpoint}${queryString ? `?${queryString}` : ""}`

  let accessToken = await getValidAccessToken()

  if (!accessToken) {
    throw new Error("Clio not connected. Missing local CLIO_ACCESS_TOKEN.")
  }

  let response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  })

  if (response.status === 401) {
    const refreshed = await refreshAccessToken()

    if (refreshed) {
      accessToken = refreshed

      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      })
    }
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After")
    const resetAt = retryAfter
      ? new Date(Date.now() + Number.parseInt(retryAfter, 10) * 1000)
      : undefined

    throw new ClioRateLimitError("Clio API rate limit exceeded", resetAt)
  }

  if (!response.ok) {
    const errorText = await response.text()
    console.error("[Clio] API error:", response.status, errorText)
    throw new Error(`Clio API error: ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function clioRequestPaginated<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
  maxPages = MAX_PAGES
): Promise<T[]> {
  const allData: T[] = []
  let page = 0
  let nextUrl: string | undefined

  while (page < maxPages) {
    let response: ClioPaginatedResponse<T>

    if (nextUrl) {
      const accessToken = await getValidAccessToken()

      if (!accessToken) {
        throw new Error("Clio not connected. Missing local CLIO_ACCESS_TOKEN.")
      }

      const res = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      })

      if (res.status === 429) {
        const retryAfter = res.headers.get("Retry-After")
        const resetAt = retryAfter
          ? new Date(Date.now() + Number.parseInt(retryAfter, 10) * 1000)
          : undefined

        throw new ClioRateLimitError("Clio API rate limit exceeded", resetAt)
      }

      if (!res.ok) {
        throw new Error(`Clio API error: ${res.status}`)
      }

      response = await res.json()
    } else {
      response = await clioRequest<ClioPaginatedResponse<T>>(endpoint, {
        ...params,
        limit: DEFAULT_LIMIT,
      })
    }

    if (Array.isArray(response.data)) {
      allData.push(...response.data)
    }

    nextUrl = response.meta?.paging?.next

    if (!nextUrl || !response.data || response.data.length < DEFAULT_LIMIT) {
      break
    }

    page += 1
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
      "id,display_number,description,status,open_date,close_date,pending_date,created_at,updated_at,client{id,name,type},responsible_attorney{id,name}",
    created_since: fromDate.toISOString(),
    limit,
    order: "created_at(desc)",
  }

  return clioRequestPaginated<ClioMatter>("/matters.json", params)
}

export async function getMatter(
  matterId: string | number
): Promise<ClioMatter | null> {
  try {
    const response = await clioRequest<{ data: ClioMatter }>(
      `/matters/${matterId}.json`,
      {
        fields:
          "id,display_number,description,status,open_date,close_date,pending_date,created_at,updated_at,client{id,name,type},responsible_attorney{id,name}",
      }
    )

    return response.data
  } catch {
    return null
  }
}

export async function getMatterCalendarEntries(
  matterId: string | number,
  fromDate: Date,
  toDate: Date
): Promise<ClioCalendarEntry[]> {
  const params = {
    matter_id: String(matterId),
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    fields:
      "id,etag,summary,description,location,start_at,end_at,all_day,created_at,updated_at,matter{id,display_number},attendees{id,name,type}",
    limit: DEFAULT_LIMIT,
  }

  return clioRequestPaginated<ClioCalendarEntry>(
    "/calendar_entries.json",
    params,
    2
  )
}

export async function getMatterCommunications(
  matterId: string | number,
  fromDate: Date,
  toDate: Date
): Promise<ClioCommunication[]> {
  const params = {
    matter_id: String(matterId),
    created_since: fromDate.toISOString(),
    fields:
      "id,subject,body,type,date,created_at,updated_at,matter{id,display_number},senders{id,name,type},receivers{id,name,type}",
    limit: DEFAULT_LIMIT,
  }

  return clioRequestPaginated<ClioCommunication>(
    "/communications.json",
    params,
    2
  )
}

export async function getMatterDocuments(
  matterId: string | number
): Promise<ClioDocument[]> {
  const params = {
    matter_id: String(matterId),
    fields: "id,name,content_type,created_at,updated_at,matter{id,display_number}",
    limit: DEFAULT_LIMIT,
  }

  return clioRequestPaginated<ClioDocument>("/documents.json", params, 2)
}

export async function isClioConnected(): Promise<boolean> {
  return Boolean(process.env.CLIO_ACCESS_TOKEN)
}

export async function clearExpiredCache(): Promise<void> {
  return
}