// lib/clio/client.ts

import {
  ClioMatter,
  ClioCalendarEntry,
  ClioCommunication,
  ClioDocument,
  ClioNote,
  ClioPaginatedResponse,
  ClioRateLimitError,
} from "./types"

const CLIO_API_BASE = "https://app.clio.com/api/v4"
const DEFAULT_LIMIT = 200
const MAX_PAGES = 5
const MIN_REMAINING_REQUESTS = 5

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

function getToken(): string | null {
  return process.env.CLIO_ACCESS_TOKEN || null
}

function getResetDate(res: Response): Date | undefined {
  const retry = res.headers.get("Retry-After")
  if (retry) {
    return new Date(Date.now() + parseInt(retry) * 1000)
  }

  const reset = res.headers.get("X-RateLimit-Reset")
  if (reset) {
    return new Date(parseInt(reset) * 1000)
  }

  return undefined
}

function checkRateLimit(res: Response) {
  const remaining = res.headers.get("X-RateLimit-Remaining")

  if (!remaining) return

  const num = parseInt(remaining)

  if (!isNaN(num) && num <= MIN_REMAINING_REQUESTS) {
    throw new ClioRateLimitError(
      "Clio API rate limit reached. Please continue later.",
      getResetDate(res)
    )
  }
}

async function fetchClio(url: string): Promise<Response> {
  const token = getToken()

  if (!token) {
    throw new Error("Missing CLIO_ACCESS_TOKEN in .env.local")
  }

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })

  if (res.status === 429) {
    throw new ClioRateLimitError(
      "Clio API rate limit reached. Please continue later.",
      getResetDate(res)
    )
  }

  checkRateLimit(res)

  return res
}

async function request<T>(
  endpoint: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const qs = buildQuery(params)
  const url = `${CLIO_API_BASE}${endpoint}${qs ? `?${qs}` : ""}`

  const res = await fetchClio(url)

  if (!res.ok) {
    const text = await res.text()
    console.error("Clio error:", res.status, text)
    throw new Error(`Clio error ${res.status}`)
  }

  return res.json()
}

async function paginate<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
  maxPages = MAX_PAGES
): Promise<T[]> {
  const results: T[] = []
  let next: string | undefined
  let page = 0

  while (page < maxPages) {
    let res: ClioPaginatedResponse<T>

    if (next) {
      const r = await fetchClio(next)
      res = await r.json()
    } else {
      res = await request(endpoint, {
        ...params,
        limit: DEFAULT_LIMIT,
      })
    }

    if (res.data) {
      results.push(...res.data)
    }

    next = res.meta?.paging?.next

    if (!next || res.data.length < DEFAULT_LIMIT) break

    page++
  }

  return results
}

// ==============================
// PUBLIC FUNCTIONS
// ==============================

export async function getRecentMatters(
  from: Date,
  to: Date
): Promise<ClioMatter[]> {
  return paginate("/matters.json", {
    created_since: from.toISOString(),
    order: "created_at(desc)",
    fields:
      "id,display_number,description,status,created_at,client{id,name,first_name,last_name},responsible_attorney{id,name}",
  })
}

export async function getMatterCalendarEntries(
  matterId: string | number,
  from: Date,
  to: Date
): Promise<ClioCalendarEntry[]> {
  return paginate("/calendar_entries.json", {
    matter_id: String(matterId),
    from: from.toISOString(),
    to: to.toISOString(),
  })
}

export async function getMatterCommunications(
  matterId: string | number,
  from: Date,
  to: Date
): Promise<ClioCommunication[]> {
  return paginate("/communications.json", {
    matter_id: String(matterId),
    created_since: from.toISOString(),
  })
}

export async function getMatterNotes(
  matterId: string | number,
  from: Date,
  to: Date
): Promise<ClioNote[]> {
  return paginate("/notes.json", {
    matter_id: String(matterId),
    created_since: from.toISOString(),
  })
}

export async function getMatterDocuments(
  matterId: string | number
): Promise<ClioDocument[]> {
  return paginate("/documents.json", {
    matter_id: String(matterId),
  })
}

export async function getMatterAuditBundle(
  matter: ClioMatter,
  from: Date,
  to: Date
) {
  const [calendarEntries, communications, notes] = await Promise.all([
    getMatterCalendarEntries(matter.id, from, to),
    getMatterCommunications(matter.id, from, to),
    getMatterNotes(matter.id, from, to),
  ])

  return {
    matter,
    calendarEntries,
    communications,
    notes,
  }
}

export async function isClioConnected(): Promise<boolean> {
  return !!process.env.CLIO_ACCESS_TOKEN
}

export async function clearExpiredCache(): Promise<void> {
  return
}