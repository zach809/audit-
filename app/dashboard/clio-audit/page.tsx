'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { 
  Play, 
  RefreshCw, 
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Phone,
  Mail,
  Download,
  ChevronDown,
  Calendar
} from 'lucide-react'
import { Input } from '@/components/ui/input'

type YesNoNA = 'Yes' | 'No' | 'N/A'
type AuditStatus = 'Pass' | 'Flag'

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
  status: AuditStatus
  missingItemTypes: string[]
  notes: string
}

type AuditRunStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'rate_limited'

export default function ClioAuditPage() {
  const [isConnected, setIsConnected] = useState<boolean | null>(null)
  const [auditStatus, setAuditStatus] = useState<AuditRunStatus | null>(null)
  const [totalMatters, setTotalMatters] = useState(0)
  const [processedMatters, setProcessedMatters] = useState(0)
  const [rows, setRows] = useState<AuditRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Date range for audit
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 14)
    return d.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })

  // Filters
  const [statusFilter, setStatusFilter] = useState<'All' | 'Pass' | 'Flag'>('All')
  const [attorneyFilter, setAttorneyFilter] = useState('All')
  const [callFilter, setCallFilter] = useState('All')
  const [courtFilter, setCourtFilter] = useState('All')
  const [welcomeFilter, setWelcomeFilter] = useState('All')
  const [contactFilter, setContactFilter] = useState('All')
  const [filingFilter, setFilingFilter] = useState('All')

  // Check Clio connection
  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch('/api/clio/status')
      const data = await res.json()
      setIsConnected(data.connected)
    } catch {
      setIsConnected(false)
    }
  }, [])

  // Fetch audit status and results
  const fetchAuditStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/clio/audit/status')
      const data = await res.json()
      if (data.audit_run) {
        setAuditStatus(data.audit_run.status)
        setTotalMatters(data.audit_run.total_matters || 0)
        setProcessedMatters(data.audit_run.processed_matters || 0)
        await fetchResults(data.audit_run.id)
      }
    } catch (err) {
      console.error('Failed to fetch audit status:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch results and transform to AuditRow format
  const fetchResults = async (auditRunId: string) => {
    try {
      const res = await fetch(`/api/clio/audit/results?audit_run_id=${auditRunId}`)
      const data = await res.json()
      
      if (data.results) {
        const transformedRows: AuditRow[] = data.results.map((r: Record<string, unknown>) => ({
          id: r.id as string,
          clientName: (r.client_name as string) || 'Unknown',
          matterNumber: (r.matter_display_number as string) || '',
          responsibleAttorney: (r.attorney_name as string) || '',
          matterCreatedAt: r.matter_created_at ? formatDateTime(r.matter_created_at as string) : '',
          attorneyCallScheduledWithin15Minutes: boolToYesNo(r.meeting_scheduled_within_48h as boolean | null),
          courtDateWithin15Minutes: boolToYesNo(r.intake_calendar_exists as boolean | null),
          welcomePacketSentWithin15Minutes: boolToYesNo(r.welcome_packet_sent as boolean | null),
          clientContactWithin24Hours: boolToYesNo(r.response_time_met as boolean | null),
          appearanceFilingEmailWithin24Hours: boolToYesNo(r.appearance_email_sent as boolean | null),
          courtDate: r.meeting_date ? formatDate(r.meeting_date as string) : '—',
          status: r.overall_status === 'pass' ? 'Pass' : 'Flag',
          missingItemTypes: (r.missing_items as string[]) || [],
          notes: ((r.missing_items as string[]) || []).join(', ') || 'OK',
        }))
        setRows(transformedRows)
      }
    } catch (err) {
      console.error('Failed to fetch results:', err)
    }
  }

  const boolToYesNo = (val: boolean | null | undefined): YesNoNA => {
    if (val === true) return 'Yes'
    if (val === false) return 'No'
    return 'N/A'
  }

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).replace(',', ',')
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  // Start audit
  const startAudit = async () => {
    setIsProcessing(true)
    setError(null)
    
    try {
      const res = await fetch('/api/clio/audit/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          batch_size: 20, 
          start_date: startDate,
          end_date: endDate,
        }),
      })
      
      const data = await res.json()
      
      if (!data.success) {
        setError(data.error || 'Failed to start audit')
        setIsProcessing(false)
        return
      }

      await processBatches(data.audit_run_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setIsProcessing(false)
    }
  }

  // Process batches
  const processBatches = async (auditRunId: string) => {
    let continueProcessing = true
    
    while (continueProcessing) {
      try {
        const res = await fetch('/api/clio/audit/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audit_run_id: auditRunId }),
        })
        
        const data = await res.json()
        
        if (!data.success) {
          setError(data.error || 'Batch processing failed')
          continueProcessing = false
          break
        }

        await fetchAuditStatus()

        if (data.status === 'completed' || data.status === 'rate_limited' || data.status === 'failed') {
          continueProcessing = false
          if (data.rate_limited) {
            setError('Clio API rate limit reached. Please continue later.')
          }
        }

        if (continueProcessing) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Processing error')
        continueProcessing = false
      }
    }
    setIsProcessing(false)
  }

  // Resume audit
  const resumeAudit = async () => {
    const statusRes = await fetch('/api/clio/audit/status')
    const statusData = await statusRes.json()
    if (statusData.audit_run) {
      setIsProcessing(true)
      setError(null)
      await processBatches(statusData.audit_run.id)
    }
  }

  useEffect(() => {
    checkConnection()
    fetchAuditStatus()
  }, [checkConnection, fetchAuditStatus])

  // Unique attorneys for filter
  const uniqueAttorneys = useMemo(() => {
    const attorneys = new Set(rows.map(r => r.responsibleAttorney).filter(Boolean))
    return ['All', ...Array.from(attorneys)]
  }, [rows])

  // Filtered rows
  const filteredRows = useMemo(() => {
    return rows.filter(row => {
      if (statusFilter !== 'All' && row.status !== statusFilter) return false
      if (attorneyFilter !== 'All' && row.responsibleAttorney !== attorneyFilter) return false
      if (callFilter !== 'All' && row.attorneyCallScheduledWithin15Minutes !== callFilter) return false
      if (courtFilter !== 'All' && row.courtDateWithin15Minutes !== courtFilter) return false
      if (welcomeFilter !== 'All' && row.welcomePacketSentWithin15Minutes !== welcomeFilter) return false
      if (contactFilter !== 'All' && row.clientContactWithin24Hours !== contactFilter) return false
      if (filingFilter !== 'All' && row.appearanceFilingEmailWithin24Hours !== filingFilter) return false
      return true
    })
  }, [rows, statusFilter, attorneyFilter, callFilter, courtFilter, welcomeFilter, contactFilter, filingFilter])

  // Summary stats
  const stats = useMemo(() => {
    const noCallWithin48h = rows.filter(r => r.attorneyCallScheduledWithin15Minutes === 'No').length
    const noReminderBeforeCourt = rows.filter(r => r.courtDateWithin15Minutes === 'No').length
    const noCallAfterResults = 0 // Placeholder
    const welcomePacketMissing = rows.filter(r => r.welcomePacketSentWithin15Minutes === 'No').length
    const appearanceEmailMissing = rows.filter(r => r.appearanceFilingEmailWithin24Hours === 'No').length
    const courtResultsMissing = 0 // Placeholder

    // Top issues
    const issues: { label: string; count: number; type: 'missing' | 'coaching' }[] = []
    
    const meetingMissing = rows.filter(r => r.attorneyCallScheduledWithin15Minutes === 'No').length
    if (meetingMissing > 0) issues.push({ label: 'Client-attorney meeting not found within 48 hours', count: meetingMissing, type: 'missing' })
    
    const contactMissing = rows.filter(r => r.clientContactWithin24Hours === 'No').length
    if (contactMissing > 0) issues.push({ label: 'Client contact not documented within 24 hours', count: contactMissing, type: 'coaching' })
    
    if (welcomePacketMissing > 0) issues.push({ label: 'Welcome packet email not found within 48 hours', count: welcomePacketMissing, type: 'missing' })
    if (appearanceEmailMissing > 0) issues.push({ label: 'Appearance filed email not found within 48 hours', count: appearanceEmailMissing, type: 'missing' })
    
    const courtDateMissing = rows.filter(r => r.courtDateWithin15Minutes === 'No').length
    if (courtDateMissing > 0) issues.push({ label: 'Court date/reminder not found', count: courtDateMissing, type: 'missing' })

    issues.sort((a, b) => b.count - a.count)

    return {
      noCallWithin48h,
      noReminderBeforeCourt,
      noCallAfterResults,
      welcomePacketMissing,
      appearanceEmailMissing,
      courtResultsMissing,
      topIssues: issues.slice(0, 5),
    }
  }, [rows])

  // Export CSV
  const exportCSV = () => {
    const headers = ['Client', 'Matter', 'Attorney', 'Created', 'Call', 'Court', 'Welcome', 'Contact', 'Filing', 'Court Date', 'Status']
    const csvRows = filteredRows.map(row => [
      row.clientName,
      row.matterNumber,
      row.responsibleAttorney,
      row.matterCreatedAt,
      row.attorneyCallScheduledWithin15Minutes,
      row.courtDateWithin15Minutes,
      row.welcomePacketSentWithin15Minutes,
      row.clientContactWithin24Hours,
      row.appearanceFilingEmailWithin24Hours,
      row.courtDate,
      row.status,
    ])
    
    const csv = [headers, ...csvRows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clio-audit-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Clio Audit</h1>
            <p className="text-muted-foreground">Operational compliance audit for Clio matters</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {isConnected === false && (
            <Button asChild>
              <Link href="/api/auth/clio">Connect Clio</Link>
            </Button>
          )}
          {isConnected && rows.length > 0 && (
            <Button variant="outline" onClick={exportCSV}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {/* Connection Warning */}
      {isConnected === false && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <p className="text-amber-800">Clio is not connected. Please connect your Clio account to run audits.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <XCircle className="h-5 w-5 text-red-600" />
              <p className="text-red-800">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audit Controls */}
      {isConnected && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4">
              {/* Date Range Picker */}
              <div className="flex items-center gap-4 pb-4 border-b">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Date Range:</span>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-40"
                    disabled={isProcessing}
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-40"
                    disabled={isProcessing}
                  />
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const d = new Date()
                      d.setDate(d.getDate() - 7)
                      setStartDate(d.toISOString().split('T')[0])
                      setEndDate(new Date().toISOString().split('T')[0])
                    }}
                    disabled={isProcessing}
                  >
                    Last 7 days
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const d = new Date()
                      d.setDate(d.getDate() - 14)
                      setStartDate(d.toISOString().split('T')[0])
                      setEndDate(new Date().toISOString().split('T')[0])
                    }}
                    disabled={isProcessing}
                  >
                    Last 14 days
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const d = new Date()
                      d.setDate(d.getDate() - 30)
                      setStartDate(d.toISOString().split('T')[0])
                      setEndDate(new Date().toISOString().split('T')[0])
                    }}
                    disabled={isProcessing}
                  >
                    Last 30 days
                  </Button>
                </div>
              </div>

              {/* Run Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {auditStatus === 'rate_limited' ? (
                    <Button onClick={resumeAudit} disabled={isProcessing}>
                      {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Resume Audit
                    </Button>
                  ) : (
                    <Button onClick={startAudit} disabled={isProcessing}>
                      {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                      {isProcessing ? 'Processing...' : 'Run Audit'}
                    </Button>
                  )}
                  {auditStatus && (
                    <Badge variant={auditStatus === 'completed' ? 'default' : 'secondary'}>
                      {auditStatus.replace('_', ' ')}
                    </Badge>
                  )}
                </div>
                {totalMatters > 0 && (
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">
                      {processedMatters} / {totalMatters} matters
                    </span>
                    <Progress value={(processedMatters / totalMatters) * 100} className="w-32 h-2" />
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {/* Client Contact Coaching */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Client Contact Coaching
              </CardTitle>
              <CardDescription>Call and follow-up issues found in Clio logs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>No clear outbound call within 48h</span>
                <span className="font-medium">{stats.noCallWithin48h}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>No reminder call/text before court</span>
                <span className="font-medium">{stats.noReminderBeforeCourt}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>No call after court results</span>
                <span className="font-medium">{stats.noCallAfterResults}</span>
              </div>
            </CardContent>
          </Card>

          {/* Template / Email Compliance */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Template / Email Compliance
              </CardTitle>
              <CardDescription>Missing or late communication templates/evidence.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Welcome packet missing</span>
                <span className="font-medium">{stats.welcomePacketMissing}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Appearance email missing</span>
                <span className="font-medium">{stats.appearanceEmailMissing}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Court results missing/late</span>
                <span className="font-medium">{stats.courtResultsMissing}</span>
              </div>
            </CardContent>
          </Card>

          {/* Top Coaching Issues */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Top Coaching Issues
              </CardTitle>
              <CardDescription>Most common missing, late, or coaching items.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {stats.topIssues.map((issue, idx) => (
                <div key={idx} className="flex justify-between items-center text-sm gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge 
                      variant="outline" 
                      className={issue.type === 'missing' ? 'bg-red-50 text-red-700 border-red-200 text-xs' : 'bg-amber-50 text-amber-700 border-amber-200 text-xs'}
                    >
                      {issue.type === 'missing' ? <XCircle className="h-3 w-3 mr-1" /> : <AlertTriangle className="h-3 w-3 mr-1" />}
                      {issue.type}
                    </Badge>
                    <span className="truncate">{issue.label}</span>
                  </div>
                  <span className="font-medium flex-shrink-0">{issue.count}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      {rows.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4">
              <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={['All', 'Pass', 'Flag']} />
              <FilterSelect label="Attorney" value={attorneyFilter} onChange={setAttorneyFilter} options={uniqueAttorneys} />
              <FilterSelect label="Call" value={callFilter} onChange={setCallFilter} options={['All', 'Yes', 'No', 'N/A']} />
              <FilterSelect label="Court" value={courtFilter} onChange={setCourtFilter} options={['All', 'Yes', 'No', 'N/A']} />
              <FilterSelect label="Welcome" value={welcomeFilter} onChange={setWelcomeFilter} options={['All', 'Yes', 'No', 'N/A']} />
              <FilterSelect label="Contact" value={contactFilter} onChange={setContactFilter} options={['All', 'Yes', 'No', 'N/A']} />
              <FilterSelect label="Filing" value={filingFilter} onChange={setFilingFilter} options={['All', 'Yes', 'No', 'N/A']} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results Table */}
      {rows.length > 0 && (
        <Card>
          <CardContent className="pt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Client</th>
                  <th className="text-left py-3 px-4 font-medium">Matter</th>
                  <th className="text-left py-3 px-4 font-medium">Attorney</th>
                  <th className="text-left py-3 px-4 font-medium">Created</th>
                  <th className="text-center py-3 px-4 font-medium">Call</th>
                  <th className="text-center py-3 px-4 font-medium">Court</th>
                  <th className="text-center py-3 px-4 font-medium">Welcome</th>
                  <th className="text-center py-3 px-4 font-medium">Contact</th>
                  <th className="text-center py-3 px-4 font-medium">Filing</th>
                  <th className="text-left py-3 px-4 font-medium">Court Date</th>
                  <th className="text-center py-3 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-muted-foreground">
                      No results match your filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map(row => (
                    <tr key={row.id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">{row.clientName}</td>
                      <td className="py-3 px-4 text-muted-foreground">{row.matterNumber}</td>
                      <td className="py-3 px-4">{row.responsibleAttorney}</td>
                      <td className="py-3 px-4 text-muted-foreground">{row.matterCreatedAt}</td>
                      <td className="py-3 px-4 text-center"><StatusIcon value={row.attorneyCallScheduledWithin15Minutes} /></td>
                      <td className="py-3 px-4 text-center"><StatusIcon value={row.courtDateWithin15Minutes} /></td>
                      <td className="py-3 px-4 text-center"><StatusIcon value={row.welcomePacketSentWithin15Minutes} /></td>
                      <td className="py-3 px-4 text-center"><StatusIcon value={row.clientContactWithin24Hours} /></td>
                      <td className="py-3 px-4 text-center"><StatusIcon value={row.appearanceFilingEmailWithin24Hours} /></td>
                      <td className="py-3 px-4">{row.courtDate}</td>
                      <td className="py-3 px-4 text-center">
                        <Badge className={row.status === 'Pass' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}>
                          {row.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {rows.length === 0 && isConnected && !isProcessing && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No audit data yet. Click "Run Audit" to start.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatusIcon({ value }: { value: YesNoNA }) {
  if (value === 'Yes') return <CheckCircle2 className="h-5 w-5 text-emerald-500 mx-auto" />
  if (value === 'No') return <XCircle className="h-5 w-5 text-red-500 mx-auto" />
  return <span className="text-muted-foreground">—</span>
}

function FilterSelect({ 
  label, 
  value, 
  onChange, 
  options 
}: { 
  label: string
  value: string
  onChange: (val: string) => void
  options: string[] 
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="appearance-none bg-background border rounded-md px-3 py-1.5 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {options.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
      </div>
    </div>
  )
}
