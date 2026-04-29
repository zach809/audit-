'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'

type AuditRunStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'rate_limited'

export default function ClioAuditPage() {
  const [auditStatus, setAuditStatus] = useState<AuditRunStatus | null>(null)
  const [totalMatters, setTotalMatters] = useState(0)
  const [processedMatters, setProcessedMatters] = useState(0)
  const [rows, setRows] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 14)
    return d.toISOString().split('T')[0]
  })

  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0])

  const fetchResults = async (auditRunId: string) => {
    try {
      const res = await fetch(`/api/clio/audit/results?audit_run_id=${auditRunId}`)
      const data = await res.json()

      if (data.results) {
        setRows(data.results)
      }
    } catch (err) {
      console.error('Failed to fetch results:', err)
    }
  }

  const fetchAuditStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/clio/audit/status')
      const data = await res.json()

      if (data.audit_run) {
        setAuditStatus(data.audit_run.status)
        setTotalMatters(data.audit_run.total_matters || 0)
        setProcessedMatters(data.audit_run.processed_matters || 0)

        if (data.audit_run.id) {
          await fetchResults(data.audit_run.id)
        }
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const processBatches = async (auditRunId: string) => {
    let keepGoing = true

    while (keepGoing) {
      try {
        const res = await fetch('/api/clio/audit/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audit_run_id: auditRunId }),
        })

        const data = await res.json()

        if (!data.success) {
          setError(data.error || 'Batch processing failed')
          keepGoing = false
          break
        }

        setAuditStatus(data.status)
        setProcessedMatters(data.total_processed || 0)
        setTotalMatters(data.total_matters || 0)

        if (
          data.status === 'completed' ||
          data.status === 'failed' ||
          data.status === 'rate_limited'
        ) {
          keepGoing = false
        }

        if (keepGoing) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Batch processing error')
        keepGoing = false
      }
    }

    await fetchAuditStatus()
    setIsProcessing(false)
  }

  const startAudit = async () => {
    setIsProcessing(true)
    setError(null)

    try {
      const res = await fetch('/api/clio/audit/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch_size: 5,
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

      setAuditStatus('in_progress')
      await processBatches(data.audit_run_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start audit')
      setIsProcessing(false)
    }
  }

  useEffect(() => {
    fetchAuditStatus()
  }, [fetchAuditStatus])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">Clio Audit</h1>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <p className="text-red-700">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex gap-2">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>

          <Button onClick={startAudit} disabled={isProcessing}>
            {isProcessing ? 'Processing...' : 'Run Audit'}
          </Button>

          {auditStatus && <Badge>{auditStatus}</Badge>}

          {totalMatters > 0 && (
            <div className="space-y-2">
              <p>{processedMatters} / {totalMatters}</p>
              <Progress value={(processedMatters / totalMatters) * 100} />
            </div>
          )}
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p>No audit data yet. Click "Run Audit".</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Client</th>
                  <th className="text-left p-2">Matter</th>
                  <th className="text-left p-2">Attorney</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Missing Items</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: any) => (
                  <tr key={row.id} className="border-b">
                    <td className="p-2">{row.client_name || 'Unknown'}</td>
                    <td className="p-2">{row.matter_display_number || row.matter_id}</td>
                    <td className="p-2">{row.attorney_name || '—'}</td>
                    <td className="p-2">{row.overall_status}</td>
                    <td className="p-2">
                      {Array.isArray(row.missing_items)
                        ? row.missing_items.join(', ')
                        : row.missing_items || 'OK'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
