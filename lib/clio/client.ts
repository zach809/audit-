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

function getResetDate(response: Response): Date | undefined {
  const retryAfter = response.headers.get("Retry-After")

  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10)

    if (!Number.isNaN(seconds)) {
      return new Date(Date.now() + seconds * 1000)
    }
  }

  const reset = response.headers.get("X-RateLimit-Reset")

  if (reset) {
    const unixSeconds = Number.parseInt(reset, 10)

    if (!Number.isNaN(unixSeconds)) {
      return new Date(unixSeconds * 1000)
    }
  }

  return undefined
}

function checkRateLimit(response: Response): void {
  const remainingHeader = response.headers.get("X-RateLimit-Remaining")

  if (!remainingHeader) return

  const remaining = Number.parseInt(remainingHeader, 10)

  if (!Number.isNaN(remaining) && remaining <= MIN_REMAINING_REQUESTS) {
    throw new ClioRateLimitError(
      "Clio API rate limit reached. Please continue later.",
      getResetDate(response)
    )
  }
}

async function fetchClio(url: string): Promise<Response> {
  const token = getToken()

  if (!token) {
    throw new Error("Missing CLIO_ACCESS_TOKEN in .env.local")
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })

  if (response.status === 429) {
    throw new ClioRateLimitError(
      "Clio API rate limit reached. Please continue later.",
      getResetDate(response)
    )
  }

  checkRateLimit(response)

  return response
}

async function request<T>(
  endpoint: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const queryString = buildQuery(params)
  const url = `${CLIO_API_BASE}${endpoint}${queryString ? `?${queryString}` : ""}`

  const response = await fetchClio(url)

  if (!response.ok) {
    const text = await response.text()
    console.error("[Clio] API error:", response.status, text)
    throw new Error(`Clio API error: ${response.status}`)
  }

  return response.json() as Promise<T>
}

async function paginate<T>(
  endpoint: string,
  params: Record<string, unknown> = {},
  maxPages = MAX_PAGES
): Promise<T[]> {
  const results: T[] = []
  let nextUrl: string | undefined
  let page = 0

  while (page < maxPages) {
    let response: ClioPaginatedResponse<T>

    if (nextUrl) {
      const rawResponse = await fetchClio(nextUrl)

      if (!rawResponse.ok) {
        const text = await rawResponse.text()
        console.error("[Clio] API error:", rawResponse.status, text)
        throw new Error(`Clio API error: ${rawResponse.status}`)
      }

      response = await rawResponse.json()
    } else {
      response = await request<ClioPaginatedResponse<T>>(endpoint, {
        ...params,
        limit: DEFAULT_LIMIT,
      })
    }

    if (Array.isArray(response.data)) {
      results.push(...response.data)
    }

    nextUrl = response.meta?.paging?.next

    if (!nextUrl || !response.data || response.data.length < DEFAULT_LIMIT) {
      break
    }

    page += 1
  }

  return results
}

export async function getRecentMatters(
  fromDate: Date,
  toDate: Date
): Promise<ClioMatter[]> {
  return paginate<ClioMatter>("/matters.json", {
    created_since: fromDate.toISOString(),
    updated_until: toDate.toISOString(),
    order: "created_at(desc)",
    fields:
      "id,display_number,description,status,open_date,close_date,pending_date,created_at,updated_at,client{id,name,first_name,last_name,type},responsible_attorney{id,name}",
  })
}

export async function getMatter(
  matterId: string | number
): Promise<ClioMatter | null> {
  try {
    const response = await request<{ data: ClioMatter }>(
      `/matters/${matterId}.json`,
      {
        fields:
          "id,display_number,description,status,open_date,close_date,pending_date,created_at,updated_at,client{id,name,first_name,last_name,type},responsible_attorney{id,name}",
      }
    )

    return response.data
  } catch (error) {
    console.error("[Clio] Failed to get matter:", matterId, error)
    return null
  }
}

export async function getMatterCalendarEntries(
  matterId: string | number,
  fromDate: Date,
  toDate: Date
): Promise<ClioCalendarEntry[]> {
  return paginate<ClioCalendarEntry>(
    "/calendar_entries.json",
    {
      matter_id: String(matterId),
      from: fromDate.toISOString(),
      to: toDate.toISOString(),
      fields:
        "id,summary,description,location,start_at,end_at,all_day,created_at,updated_at,matter{id,display_number},attendees{id,name,type}",
    },
    2
  )
}

export async function getMatterCommunications(
  matterId: string | number,
  fromDate: Date,
  toDate: Date
): Promise<ClioCommunication[]> {
  return paginate<ClioCommunication>(
    "/communications.json",
    {
      matter_id: String(matterId),
      created_since: fromDate.toISOString(),
      fields:
        "id,subject,body,type,date,created_at,updated_at,matter{id,display_number},senders{id,name,type},receivers{id,name,type}",
    },
    2
  )
}

export async function getMatterNotes(
  matterId: string | number,
  fromDate: Date,
  toDate: Date
): Promise<ClioNote[]> {
  return paginate<ClioNote>(
    "/notes.json",
    {
      matter_id: String(matterId),
      created_since: fromDate.toISOString(),
      fields:
        "id,detail,subject,type,created_at,updated_at,matter{id,display_number}",
    },
    2
  )
}

export async function getMatterDocuments(
  matterId: string | number
): Promise<ClioDocument[]> {
  return paginate<ClioDocument>(
    "/documents.json",
    {
      matter_id: String(matterId),
      fields:
        "id,name,content_type,created_at,updated_at,matter{id,display_number}",
    },
    2
  )
}

export async function getMatterAuditBundle(
  matter: ClioMatter,
  fromDate: Date,
  toDate: Date
) {
  const calendarEntries = await getMatterCalendarEntries(matter.id, fromDate, toDate)
  const communications = await getMatterCommunications(matter.id, fromDate, toDate)
  const notes = await getMatterNotes(matter.id, fromDate, toDate)

  return {
    matter,
    calendarEntries,
    communications,
    notes,
  }
}

export async function isClioConnected(): Promise<boolean> {
  return Boolean(process.env.CLIO_ACCESS_TOKEN)
}

export async function clearExpiredCache(): Promise<void> {
  return
}