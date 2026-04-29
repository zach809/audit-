'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Play, 
  Pause, 
  RefreshCw, 
  CheckCircle, 
  AlertTriangle, 
  XCircle,
  Clock,
  FileText,
  User,
  Briefcase,
  Calendar,
  Mail,
  ArrowLeft,
  Loader2
} from 'lucide-react'
import type { ClioAuditRun, ClioMatterAudit, AuditResultsResponse } from '@/lib/clio/types'

export default function ClioAuditPage() {
  const [isConnected, setIsConnected] = useState<boolean | null>(null)
  const [auditRun, setAuditRun] = useState<ClioAuditRun | null>(null)
  const [results, setResults] = useState<ClioMatterAudit[]>([])
  const [summary, setSummary] = useState<{ total: number; pass: number; needs_review: number; missing_evidence: number } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Check Clio connection status
  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch('/api/clio/status')
      const data = await res.json()
      setIsConnected(data.connected)
    } catch {
      setIsConnected(false)
    }
  }, [])

  // Fetch current audit status
  const fetchAuditStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/clio/audit/status')
      const data = await res.json()
      if (data.audit_run) {
        setAuditRun(data.audit_run)
        // Fetch results if we have an audit run
        await fetchResults(data.audit_run.id)
      }
    } catch (err) {
      console.error('Failed to fetch audit status:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Fetch audit results
  const fetchResults = async (auditRunId: string) => {
    try {
      const res = await fetch(`/api/clio/audit/results?audit_run_id=${auditRunId}`)
      const data: AuditResultsResponse = await res.json()
      if (data.results) setResults(data.results)
      if (data.summary) setSummary(data.summary)
    } catch (err) {
      console.error('Failed to fetch results:', err)
    }
  }

  // Start new audit
  const startAudit = async () => {
    setIsProcessing(true)
    setError(null)
    
    try {
      const res = await fetch('/api/clio/audit/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch_size: 20, time_window_days: 14 }),
      })
      
      const data = await res.json()
      
      if (!data.success) {
        setError(data.error || 'Failed to start audit')
        return
      }

      // Start processing batches
      await processBatches(data.audit_run_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsProcessing(false)
    }
  }

  // Process batches until complete or rate limited
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

        // Update local state
        await fetchAuditStatus()

        // Check if complete or rate limited
        if (data.status === 'completed' || data.status === 'rate_limited' || data.status === 'failed') {
          continueProcessing = false
          
          if (data.rate_limited) {
            setError('Clio API rate limit reached. Please continue later.')
          }
        }

        // Small delay between batches
        if (continueProcessing) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Processing error')
        continueProcessing = false
      }
    }
  }

  // Resume audit
  const resumeAudit = async () => {
    if (!auditRun) return
    setIsProcessing(true)
    setError(null)
    
    // Update status to in_progress if rate limited
    await processBatches(auditRun.id)
    setIsProcessing(false)
  }

  // Initial load
  useEffect(() => {
    checkConnection()
    fetchAuditStatus()
  }, [checkConnection, fetchAuditStatus])

  // Auto-refresh while processing
  useEffect(() => {
    if (!isProcessing || !auditRun) return
    
    const interval = setInterval(fetchAuditStatus, 2000)
    return () => clearInterval(interval)
  }, [isProcessing, auditRun, fetchAuditStatus])

  const getStatusBadge = (status: ClioMatterAudit['overall_status']) => {
    switch (status) {
      case 'pass':
        return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Pass</Badge>
      case 'needs_review':
        return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Needs Review</Badge>
      case 'missing_evidence':
        return <Badge className="bg-red-100 text-red-700 border-red-200">Missing Evidence</Badge>
    }
  }

  const getRunStatusBadge = (status: ClioAuditRun['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>
      case 'in_progress':
        return <Badge className="bg-blue-100 text-blue-700 border-blue-200">In Progress</Badge>
      case 'completed':
        return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Completed</Badge>
      case 'failed':
        return <Badge className="bg-red-100 text-red-700 border-red-200">Failed</Badge>
      case 'rate_limited':
        return <Badge className="bg-amber-100 text-amber-700 border-amber-200">Rate Limited</Badge>
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
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
            <p className="text-muted-foreground">
              Operational compliance audit for Clio matters
            </p>
          </div>
        </div>
        
        {isConnected === false && (
          <Button asChild>
            <Link href="/api/auth/clio">Connect Clio</Link>
          </Button>
        )}
      </div>

      {/* Connection Warning */}
      {isConnected === false && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <p className="text-amber-800">
                Clio is not connected. Please connect your Clio account to run audits.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error Message */}
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
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Audit Control
            </CardTitle>
            <CardDescription>
              Start a new audit or continue a paused one
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Progress */}
            {auditRun && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span>Status:</span>
                    {getRunStatusBadge(auditRun.status)}
                  </div>
                  <span className="text-muted-foreground">
                    {auditRun.processed_matters} / {auditRun.total_matters} matters
                  </span>
                </div>
                <Progress 
                  value={(auditRun.processed_matters / auditRun.total_matters) * 100} 
                  className="h-2"
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              {!auditRun || auditRun.status === 'completed' || auditRun.status === 'failed' ? (
                <Button onClick={startAudit} disabled={isProcessing}>
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Start New Audit
                    </>
                  )}
                </Button>
              ) : auditRun.status === 'rate_limited' ? (
                <Button onClick={resumeAudit} disabled={isProcessing}>
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Resuming...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Resume Audit
                    </>
                  )}
                </Button>
              ) : (
                <Button disabled>
                  <Pause className="mr-2 h-4 w-4" />
                  Processing...
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      {summary && summary.total > 0 && (
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{summary.total}</div>
              <p className="text-sm text-muted-foreground">Total Matters</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-emerald-600">{summary.pass}</div>
              <p className="text-sm text-muted-foreground">Passing</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-amber-600">{summary.needs_review}</div>
              <p className="text-sm text-muted-foreground">Needs Review</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">{summary.missing_evidence}</div>
              <p className="text-sm text-muted-foreground">Missing Evidence</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Audit Results</CardTitle>
            <CardDescription>
              Matter-by-matter compliance audit findings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="all">
              <TabsList>
                <TabsTrigger value="all">All ({results.length})</TabsTrigger>
                <TabsTrigger value="needs_review">
                  Needs Review ({results.filter(r => r.overall_status === 'needs_review').length})
                </TabsTrigger>
                <TabsTrigger value="missing">
                  Missing Evidence ({results.filter(r => r.overall_status === 'missing_evidence').length})
                </TabsTrigger>
                <TabsTrigger value="pass">
                  Passing ({results.filter(r => r.overall_status === 'pass').length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="mt-4">
                <MatterAuditList audits={results} getStatusBadge={getStatusBadge} />
              </TabsContent>

              <TabsContent value="needs_review" className="mt-4">
                <MatterAuditList 
                  audits={results.filter(r => r.overall_status === 'needs_review')} 
                  getStatusBadge={getStatusBadge}
                />
              </TabsContent>

              <TabsContent value="missing" className="mt-4">
                <MatterAuditList 
                  audits={results.filter(r => r.overall_status === 'missing_evidence')} 
                  getStatusBadge={getStatusBadge}
                />
              </TabsContent>

              <TabsContent value="pass" className="mt-4">
                <MatterAuditList 
                  audits={results.filter(r => r.overall_status === 'pass')} 
                  getStatusBadge={getStatusBadge}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// Matter audit list component
function MatterAuditList({ 
  audits, 
  getStatusBadge 
}: { 
  audits: ClioMatterAudit[]
  getStatusBadge: (status: ClioMatterAudit['overall_status']) => React.ReactNode
}) {
  if (audits.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No results in this category
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {audits.map((audit) => (
        <Card key={audit.id} className="overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <User className="h-4 w-4" />
                  {audit.client_name || 'Unknown Client'}
                </CardTitle>
                <CardDescription className="flex items-center gap-4 mt-1">
                  <span className="flex items-center gap-1">
                    <Briefcase className="h-3 w-3" />
                    {audit.matter_display_number}
                  </span>
                  {audit.attorney_name && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {audit.attorney_name}
                    </span>
                  )}
                </CardDescription>
              </div>
              {getStatusBadge(audit.overall_status)}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Intake Checks */}
            <div>
              <h4 className="font-medium text-sm mb-2">Intake & Initial Follow-Up</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <CheckItem 
                  label="Intake calendar entry" 
                  checked={audit.intake_calendar_exists}
                  date={audit.intake_calendar_date}
                />
                <CheckItem 
                  label="Matter created in Clio" 
                  checked={audit.matter_created_in_clio}
                  date={audit.matter_created_at}
                />
                <CheckItem 
                  label="Meeting within 48h" 
                  checked={audit.meeting_scheduled_within_48h}
                  date={audit.meeting_date}
                />
                <CheckItem 
                  label="Welcome packet sent" 
                  checked={audit.welcome_packet_sent}
                  date={audit.welcome_packet_date}
                />
              </div>
            </div>

            {/* Appearance Checks */}
            <div>
              <h4 className="font-medium text-sm mb-2">Appearance & File Setup</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <CheckItem 
                  label="Appearance filed within 48h" 
                  checked={audit.appearance_filed_within_48h}
                  date={audit.appearance_date}
                />
                <CheckItem 
                  label="Appearance email sent" 
                  checked={audit.appearance_email_sent}
                  date={audit.appearance_email_date}
                />
                <CheckItem 
                  label="Attorney assigned" 
                  checked={audit.attorney_correctly_assigned}
                />
                <CheckItem 
                  label="Signed retainer exists" 
                  checked={audit.signed_retainer_exists}
                  date={audit.signed_retainer_date}
                />
              </div>
            </div>

            {/* Flags */}
            {audit.flags && audit.flags.length > 0 && (
              <div>
                <h4 className="font-medium text-sm mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Flags
                </h4>
                <ul className="list-disc list-inside text-sm text-amber-700">
                  {audit.flags.map((flag, idx) => (
                    <li key={idx}>{flag}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Missing Items */}
            {audit.missing_items && audit.missing_items.length > 0 && (
              <div>
                <h4 className="font-medium text-sm mb-2 flex items-center gap-1">
                  <XCircle className="h-4 w-4 text-red-500" />
                  Missing Items
                </h4>
                <ul className="list-disc list-inside text-sm text-red-700">
                  {audit.missing_items.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// Check item component
function CheckItem({ 
  label, 
  checked, 
  date 
}: { 
  label: string
  checked: boolean | null | undefined
  date?: string | null
}) {
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div className="flex items-center gap-2">
      {checked === true ? (
        <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
      ) : checked === false ? (
        <XCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
      ) : (
        <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      )}
      <span className={checked === false ? 'text-red-700' : ''}>
        {label}
        {date && checked && (
          <span className="text-muted-foreground ml-1">
            ({formatDate(date)})
          </span>
        )}
      </span>
    </div>
  )
}
