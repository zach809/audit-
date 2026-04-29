"use client"

import { useMemo, useState } from "react"

type YesNoNA = "Yes" | "No" | "N/A"
type AuditStatus = "Pass" | "Flag"

type ScheduledEvent = {
  id: string
  summary: string
  startAt: string
  endAt: string
  attendees: string[]
  type: 'meeting' | 'call' | 'court' | 'other'
}

type AuditRow = {
  id: string
  clientName: string
  matterNumber: string
  responsibleAttorney: string
  matterCreatedAt: string

  attorneyCallScheduledWithin15Minutes: YesNoNA
  courtDateWithin15Minutes: YesNoNA
  welcomePacketSentWithin15Minutes: YesNoNA

  clientContactWithin24Hours: YesNoNA
  appearanceFilingEmailWithin24Hours: YesNoNA

  courtDate: string
  courtResultsEmailSent: YesNoNA
  courtResultsSentWithin24Hours: YesNoNA
  courtResultsDocumentedInNotes: YesNoNA
  resultSentTimestamp: string
  nextCourtDateAdded: YesNoNA

  // Calendar tracking
  hasAttorneyClientMeeting: YesNoNA
  hasScheduledCall: YesNoNA
  scheduledEvents: ScheduledEvent[]
  upcomingMeetings: ScheduledEvent[]
  upcomingCalls: ScheduledEvent[]

  status: AuditStatus
  missingItemTypes: string[]
  notes: string
}

type AuditSummary = {
  totalRows: number
  passRows: number
  flagRows: number
  missingItemCounts: Record<string, number>
}

function todayMinusDays(days: number) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().slice(0, 10)
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

export default function ClioAuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [summary, setSummary] = useState<AuditSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [fromDate, setFromDate] = useState(todayMinusDays(30))
  const [toDate, setToDate] = useState(today())
  const [attorneyFilter, setAttorneyFilter] = useState("All")
  const [statusFilter, setStatusFilter] = useState("All")
  const [missingFilter, setMissingFilter] = useState("All")
  const [welcomeFilter, setWelcomeFilter] = useState("All")
  const [appearanceFilter, setAppearanceFilter] = useState("All")
  const [courtResultsFilter, setCourtResultsFilter] = useState("All")
  const [meetingFilter, setMeetingFilter] = useState("All")
  const [callFilter, setCallFilter] = useState("All")
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  async function runAudit() {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/clio/audit/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fromDate,
          toDate,
        }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to run audit")
      }

      setRows(data.rows || [])
      setSummary(data.summary || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setLoading(false)
    }
  }

  const attorneys = useMemo(() => {
    return Array.from(new Set(rows.map((row) => row.responsibleAttorney))).sort()
  }, [rows])

  const missingTypes = useMemo(() => {
    return Array.from(new Set(rows.flatMap((row) => row.missingItemTypes || []))).sort()
  }, [rows])

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (attorneyFilter !== "All" && row.responsibleAttorney !== attorneyFilter) {
        return false
      }

      if (statusFilter !== "All" && row.status !== statusFilter) {
        return false
      }

      if (
        missingFilter !== "All" &&
        !(row.missingItemTypes || []).includes(missingFilter)
      ) {
        return false
      }

      if (
        welcomeFilter !== "All" &&
        row.welcomePacketSentWithin15Minutes !== welcomeFilter
      ) {
        return false
      }

      if (
        appearanceFilter !== "All" &&
        row.appearanceFilingEmailWithin24Hours !== appearanceFilter
      ) {
        return false
      }

      if (
        courtResultsFilter !== "All" &&
        row.courtResultsEmailSent !== courtResultsFilter
      ) {
        return false
      }

      if (
        meetingFilter !== "All" &&
        row.hasAttorneyClientMeeting !== meetingFilter
      ) {
        return false
      }

      if (
        callFilter !== "All" &&
        row.hasScheduledCall !== callFilter
      ) {
        return false
      }

      return true
    })
  }, [
    rows,
    attorneyFilter,
    statusFilter,
    missingFilter,
    welcomeFilter,
    appearanceFilter,
    courtResultsFilter,
    meetingFilter,
    callFilter,
  ])

  function exportCsv() {
    const headers = [
      "Client Name",
      "Matter Number",
      "Responsible Attorney",
      "Matter Created Date/Time",
      "Attorney Call Scheduled Within 15 Minutes?",
      "Court Reminder/Court Date Within 15 Minutes?",
      "Welcome Packet Sent Within 15 Minutes?",
      "Client Contact Within 24 Hours?",
      "Appearance Filing Email Within 24 Hours?",
      "Has Attorney-Client Meeting?",
      "Has Scheduled Call?",
      "Upcoming Meetings",
      "Upcoming Calls",
      "Court Date",
      "Court Results Template/Email Sent?",
      "Court Results Sent Within 24 Hours?",
      "Court Results Documented in Notes?",
      "Result Sent Timestamp",
      "Next Court Date Added?",
      "Status",
      "Notes / Missing Items",
    ]

    const formatEvents = (events: ScheduledEvent[]) => 
      events.map(e => `${e.summary} (${e.startAt})`).join("; ") || "None"

    const csvRows = filteredRows.map((row) => [
      row.clientName,
      row.matterNumber,
      row.responsibleAttorney,
      row.matterCreatedAt,
      row.attorneyCallScheduledWithin15Minutes,
      row.courtDateWithin15Minutes,
      row.welcomePacketSentWithin15Minutes,
      row.clientContactWithin24Hours,
      row.appearanceFilingEmailWithin24Hours,
      row.hasAttorneyClientMeeting,
      row.hasScheduledCall,
      formatEvents(row.upcomingMeetings || []),
      formatEvents(row.upcomingCalls || []),
      row.courtDate,
      row.courtResultsEmailSent,
      row.courtResultsSentWithin24Hours,
      row.courtResultsDocumentedInNotes,
      row.resultSentTimestamp,
      row.nextCourtDateAdded,
      row.status,
      row.notes,
    ])

    const csv = [headers, ...csvRows]
      .map((line) =>
        line
          .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
          .join(",")
      )
      .join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")

    link.href = url
    link.download = "clio-audit-results.csv"
    link.click()

    URL.revokeObjectURL(url)
  }

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        Clio Manage Audit
      </h1>

      <p style={{ marginBottom: 20, color: "#555" }}>
        Local-only Reports v2 audit. Results are generated fresh and are not
        stored in Supabase or any cloud database.
      </p>

      <section
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "end",
          marginBottom: 20,
          padding: 16,
          border: "1px solid #ddd",
          borderRadius: 8,
          background: "#fafafa",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <label>
          <div>Created From</div>
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </label>

        <label>
          <div>Created To</div>
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </label>

        <label>
          <div>Responsible Attorney</div>
          <select
            value={attorneyFilter}
            onChange={(event) => setAttorneyFilter(event.target.value)}
          >
            <option value="All">All</option>
            {attorneys.map((attorney) => (
              <option key={attorney} value={attorney}>
                {attorney}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div>Status</div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="All">All</option>
            <option value="Pass">Pass</option>
            <option value="Flag">Flag</option>
          </select>
        </label>

        <label>
          <div>Missing Item</div>
          <select
            value={missingFilter}
            onChange={(event) => setMissingFilter(event.target.value)}
          >
            <option value="All">All</option>
            {missingTypes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div>Welcome Packet</div>
          <select
            value={welcomeFilter}
            onChange={(event) => setWelcomeFilter(event.target.value)}
          >
            <option value="All">All</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
            <option value="N/A">N/A</option>
          </select>
        </label>

        <label>
          <div>Appearance Email</div>
          <select
            value={appearanceFilter}
            onChange={(event) => setAppearanceFilter(event.target.value)}
          >
            <option value="All">All</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
            <option value="N/A">N/A</option>
          </select>
        </label>

        <label>
          <div>Court Results Sent</div>
          <select
            value={courtResultsFilter}
            onChange={(event) => setCourtResultsFilter(event.target.value)}
          >
            <option value="All">All</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
            <option value="N/A">N/A</option>
          </select>
        </label>

        <label>
          <div>Meeting Scheduled</div>
          <select
            value={meetingFilter}
            onChange={(event) => setMeetingFilter(event.target.value)}
          >
            <option value="All">All</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
            <option value="N/A">N/A</option>
          </select>
        </label>

        <label>
          <div>Call Scheduled</div>
          <select
            value={callFilter}
            onChange={(event) => setCallFilter(event.target.value)}
          >
            <option value="All">All</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
            <option value="N/A">N/A</option>
          </select>
        </label>

        <button onClick={runAudit} disabled={loading}>
          {loading ? "Running..." : "Run Audit"}
        </button>

        <button onClick={exportCsv} disabled={filteredRows.length === 0}>
          Export CSV
        </button>
      </section>

      {error && (
        <div
          style={{
            padding: 12,
            border: "1px solid #f5b5b5",
            background: "#fff1f1",
            color: "#9b1c1c",
            marginBottom: 16,
            borderRadius: 8,
          }}
        >
          {error}
        </div>
      )}

      {summary && (
        <section
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          <strong>Total Rows: {summary.totalRows}</strong>
          <strong>Pass: {summary.passRows}</strong>
          <strong>Flag: {summary.flagRows}</strong>
          <strong>Showing: {filteredRows.length}</strong>
        </section>
      )}

      <div
        style={{
          overflowX: "auto",
          border: "1px solid #ddd",
          borderRadius: 8,
          maxHeight: "70vh",
        }}
      >
        <table
          style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            minWidth: 2200,
            width: "100%",
            fontSize: 13,
          }}
        >
          <thead>
            <tr>
              <Th sticky left={0} width={180}>
                Client Name
              </Th>
              <Th sticky left={180} width={140}>
                Matter Number
              </Th>
              <Th sticky left={320} width={180}>
                Responsible Attorney
              </Th>
              <Th sticky left={500} width={90}>
                Status
              </Th>
              <Th>Matter Created Date/Time</Th>
              <Th>Attorney Call Within 15 Min?</Th>
              <Th>Court Date Within 15 Min?</Th>
              <Th>Welcome Packet Within 15 Min?</Th>
              <Th>Client Contact Within 24 Hr?</Th>
              <Th>Appearance Filing Within 24 Hr?</Th>
              <Th>Meeting Scheduled?</Th>
              <Th>Call Scheduled?</Th>
              <Th>Upcoming Meetings</Th>
              <Th>Upcoming Calls</Th>
              <Th>Court Date</Th>
              <Th>Court Results Email Sent?</Th>
              <Th>Court Results Sent Within 24 Hr?</Th>
              <Th>Court Results Documented in Notes?</Th>
              <Th>Result Sent Timestamp</Th>
              <Th>Next Court Date Added?</Th>
              <Th>Notes / Missing Items</Th>
            </tr>
          </thead>

          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={21} style={{ padding: 20, textAlign: "center" }}>
                  No audit rows yet. Click Run Audit.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.id}>
                  <Td sticky left={0} width={180}>
                    {row.clientName}
                  </Td>
                  <Td sticky left={180} width={140}>
                    {row.matterNumber}
                  </Td>
                  <Td sticky left={320} width={180}>
                    {row.responsibleAttorney}
                  </Td>
                  <Td
                    sticky
                    left={500}
                    width={90}
                    style={{
                      fontWeight: 700,
                      color: row.status === "Pass" ? "#0f7a35" : "#b42318",
                    }}
                  >
                    {row.status}
                  </Td>
                  <Td>{row.matterCreatedAt}</Td>
                  <Td>{row.attorneyCallScheduledWithin15Minutes}</Td>
                  <Td>{row.courtDateWithin15Minutes}</Td>
                  <Td>{row.welcomePacketSentWithin15Minutes}</Td>
                  <Td>{row.clientContactWithin24Hours}</Td>
                  <Td>{row.appearanceFilingEmailWithin24Hours}</Td>
                  <Td style={{ color: row.hasAttorneyClientMeeting === "Yes" ? "#0f7a35" : row.hasAttorneyClientMeeting === "No" ? "#b42318" : undefined }}>
                    {row.hasAttorneyClientMeeting}
                  </Td>
                  <Td style={{ color: row.hasScheduledCall === "Yes" ? "#0f7a35" : row.hasScheduledCall === "No" ? "#b42318" : undefined }}>
                    {row.hasScheduledCall}
                  </Td>
                  <Td>
                    {(row.upcomingMeetings || []).length > 0 ? (
                      <div style={{ fontSize: 12 }}>
                        {row.upcomingMeetings.slice(0, 3).map((e, i) => (
                          <div key={i} style={{ marginBottom: 4, padding: "2px 4px", background: "#e0f2fe", borderRadius: 4 }}>
                            <strong>{e.summary}</strong>
                            <br />
                            <span style={{ color: "#666" }}>{new Date(e.startAt).toLocaleString()}</span>
                          </div>
                        ))}
                        {row.upcomingMeetings.length > 3 && (
                          <div style={{ color: "#666" }}>+{row.upcomingMeetings.length - 3} more</div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: "#999" }}>None</span>
                    )}
                  </Td>
                  <Td>
                    {(row.upcomingCalls || []).length > 0 ? (
                      <div style={{ fontSize: 12 }}>
                        {row.upcomingCalls.slice(0, 3).map((e, i) => (
                          <div key={i} style={{ marginBottom: 4, padding: "2px 4px", background: "#fef3c7", borderRadius: 4 }}>
                            <strong>{e.summary}</strong>
                            <br />
                            <span style={{ color: "#666" }}>{new Date(e.startAt).toLocaleString()}</span>
                          </div>
                        ))}
                        {row.upcomingCalls.length > 3 && (
                          <div style={{ color: "#666" }}>+{row.upcomingCalls.length - 3} more</div>
                        )}
                      </div>
                    ) : (
                      <span style={{ color: "#999" }}>None</span>
                    )}
                  </Td>
                  <Td>{row.courtDate}</Td>
                  <Td>{row.courtResultsEmailSent}</Td>
                  <Td>{row.courtResultsSentWithin24Hours}</Td>
                  <Td>{row.courtResultsDocumentedInNotes}</Td>
                  <Td>{row.resultSentTimestamp}</Td>
                  <Td>{row.nextCourtDateAdded}</Td>
                  <Td>{row.notes}</Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  )
}

function Th({
  children,
  sticky,
  left,
  width,
}: {
  children: React.ReactNode
  sticky?: boolean
  left?: number
  width?: number
}) {
  return (
    <th
      style={{
        position: sticky ? "sticky" : "static",
        left,
        width,
        minWidth: width || 150,
        top: 0,
        zIndex: sticky ? 4 : 3,
        background: "#f3f4f6",
        borderBottom: "1px solid #ddd",
        borderRight: "1px solid #ddd",
        padding: "10px 8px",
        textAlign: "left",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  sticky,
  left,
  width,
  style,
}: {
  children: React.ReactNode
  sticky?: boolean
  left?: number
  width?: number
  style?: React.CSSProperties
}) {
  return (
    <td
      style={{
        position: sticky ? "sticky" : "static",
        left,
        width,
        minWidth: width || 150,
        zIndex: sticky ? 2 : 1,
        background: sticky ? "#fff" : "inherit",
        borderBottom: "1px solid #eee",
        borderRight: "1px solid #eee",
        padding: "8px",
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  )
}
