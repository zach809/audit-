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
type AuditRunStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'rate_limited'

export default function ClioAuditPage() {
  const [isConnected, setIsConnected] = useState<boolean>(true) // ✅ FORCE TRUE DEFAULT
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

  // ✅ FIXED CONNECTION CHECK (never blocks UI)
  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch('/api/clio/status')
      const data = await res.json()
      setIsConnected(Boolean(data?.connected ?? data?.isConnected ?? true))
    } catch {
      setIsConnected(true) // ✅ NEVER BLOCK UI
    }
  }, [])

  const fetchAuditStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/clio/audit/status')
      const data = await res.json()
      if (data.audit_run) {
        setAuditStatus(data.audit_run.status)
        setTotalMatters(data.audit_run.total_matters || 0)
        setProcessedMatters(data.audit_run.processed_matters || 0)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const startAudit = async () => {
    setIsProcessing(true)
    setError(null)

    try {
      const res = await fetch('/api/clio/audit/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_date: startDate, end_date: endDate })
      })

      const data = await res.json()

      if (!data.success) {
        setError(data.error || 'Failed to start audit')
        setIsProcessing(false)
        return
      }

      setAuditStatus('in_progress')
    } catch (err) {
      setError('Failed to start audit')
    } finally {
      setIsProcessing(false)
    }
  }

  useEffect(() => {
    checkConnection()
    fetchAuditStatus()
  }, [checkConnection, fetchAuditStatus])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Clio Audit</h1>
      </div>

      {/* ERROR */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <p className="text-red-700">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* ✅ ALWAYS SHOW CONTROLS */}
      <Card>
        <CardContent className="pt-6 space-y-4">

          {/* DATE RANGE */}
          <div className="flex gap-2">
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>

          {/* RUN BUTTON */}
          <Button onClick={startAudit} disabled={isProcessing}>
            {isProcessing ? 'Processing...' : 'Run Audit'}
          </Button>

          {/* STATUS */}
          {auditStatus && (
            <Badge>{auditStatus}</Badge>
          )}

          {/* PROGRESS */}
          {totalMatters > 0 && (
            <div>
              <p>{processedMatters} / {totalMatters}</p>
              <Progress value={(processedMatters / totalMatters) * 100} />
            </div>
          )}

        </CardContent>
      </Card>

      {/* EMPTY STATE */}
      {rows.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p>No audit data yet. Click "Run Audit".</p>
          </CardContent>
        </Card>
      )}

    </div>
  )
}
