export type ClioMatter = {
  id: string | number
  display_number?: string
  description?: string
  status?: string
  open_date?: string
  close_date?: string
  pending_date?: string
  created_at?: string
  updated_at?: string

  client?: {
    id?: string | number
    name?: string
    first_name?: string
    last_name?: string
    type?: string
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
  location?: string
  start_at?: string
  end_at?: string
  all_day?: boolean
  created_at?: string
  updated_at?: string

  matter?: {
    id?: string | number
    display_number?: string
  }

  attendees?: Array<{
    id?: string | number
    name?: string
    type?: string
  }>
}

export type ClioCommunication = {
  id: string | number
  subject?: string
  body?: string
  type?: string
  date?: string
  created_at?: string
  updated_at?: string

  matter?: {
    id?: string | number
    display_number?: string
  }

  senders?: Array<{
    id?: string | number
    name?: string
    type?: string
  }>

  receivers?: Array<{
    id?: string | number
    name?: string
    type?: string
  }>
}

export type ClioNote = {
  id: string | number
  detail?: string
  subject?: string
  type?: string
  created_at?: string
  updated_at?: string

  matter?: {
    id?: string | number
    display_number?: string
  }
}

export type ClioDocument = {
  id: string | number
  name?: string
  content_type?: string
  created_at?: string
  updated_at?: string

  matter?: {
    id?: string | number
    display_number?: string
  }
}

export type ClioPaginatedResponse<T> = {
  data: T[]
  meta?: {
    paging?: {
      next?: string
      previous?: string
    }
  }
}

export class ClioRateLimitError extends Error {
  resetAt?: Date

  constructor(message: string, resetAt?: Date) {
    super(message)
    this.name = "ClioRateLimitError"
    this.resetAt = resetAt
  }
}