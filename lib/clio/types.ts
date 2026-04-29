// lib/clio/types.ts

export type ClioMatter = {
  id: string | number
  display_number?: string
  description?: string
  status?: string
  created_at?: string
  updated_at?: string

  client?: {
    id?: string | number
    name?: string
    first_name?: string
    last_name?: string
  }

  responsible_attorney?: {
    id?: string | number
    name?: string
  }
}

export type ClioCalendarEntry = {
  id: string | number
  summary?: string
  description?: string
  start_at?: string
  end_at?: string
}

export type ClioCommunication = {
  id: string | number
  subject?: string
  body?: string
  created_at?: string
}

export type ClioNote = {
  id: string | number
  detail?: string
  created_at?: string
}

export type ClioDocument = {
  id: string | number
  name?: string
  created_at?: string
}

export type ClioPaginatedResponse<T> = {
  data: T[]
  meta?: {
    paging?: {
      next?: string
    }
  }
}

export class ClioRateLimitError extends Error {
  resetAt?: Date

  constructor(message: string, resetAt?: Date) {
    super(message)
    this.resetAt = resetAt
  }
}