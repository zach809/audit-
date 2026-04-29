'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { RefreshCw, ChevronDown, Code2 } from 'lucide-react'
import { CourtResultsCard } from '@/components/dashboard/court-results-card'
import { AddToCalendarCard } from '@/components/dashboard/add-to-calendar-card'
import { AuditSummaryStats } from '@/components/dashboard/audit-summary-stats'

interface AuditResultsData {
  success: boolean
  message?: string
  error?: string
  totalProcessed?: number
  statusCounts?: Record<string, number>
  results?: Array<{
    thread: { id: string; subject: string }
    emailType: 'court_results' | 'add_to_calendar'
    result: Record<string, unknown>
  }>
}

export default function AuditResultsPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [auditData, setAuditData] = useState<AuditResultsData | null>(null)
  const [showRawJson, setShowRawJson] = useState(false)

  const runAudit = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/audit/run', { method: 'POST' })
      const data = await response.json()
      setAuditData(data)
    } catch (error) {
      setAuditData({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      })
    } finally {
      setIsLoading(false)
    }
  }

  const courtResults = auditData?.results?.filter(r => r.emailType === 'court_results') || []
  const addToCalendar = auditData?.results?.filter(r => r.emailType === 'add_to_calendar') || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Run Audit</h1>
          <p className="text-muted-foreground">
            Analyze today&apos;s email threads for case manager follow-up
          </p>
        </div>
        <Button onClick={runAudit} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          {isLoading ? 'Running Audit...' : 'Run Audit Now'}
        </Button>
      </div>

      {auditData && (
        <>
          {auditData.success ? (
            <div className="space-y-6">
              <AuditSummaryStats 
                totalProcessed={auditData.totalProcessed || 0}
                statusCounts={auditData.statusCounts || {}}
              />

              <Tabs defaultValue="court_results" className="space-y-4">
                <TabsList>
                  <TabsTrigger value="court_results" className="gap-2">
                    Court Results
                    <Badge variant="secondary" className="ml-1">
                      {courtResults.length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="add_to_calendar" className="gap-2">
                    Add to Calendar
                    <Badge variant="secondary" className="ml-1">
                      {addToCalendar.length}
                    </Badge>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="court_results" className="space-y-4">
                  {courtResults.length === 0 ? (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground">
                        No Court Results emails found today
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid gap-4">
                      {courtResults.map((item, index) => (
                        <CourtResultsCard 
                          key={item.thread.id || index} 
                          result={item.result}
                          subject={item.thread.subject}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="add_to_calendar" className="space-y-4">
                  {addToCalendar.length === 0 ? (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground">
                        No Add to Calendar emails found today
                      </CardContent>
                    </Card>
                  ) : (
                    <div className="grid gap-4">
                      {addToCalendar.map((item, index) => (
                        <AddToCalendarCard 
                          key={item.thread.id || index} 
                          result={item.result}
                          subject={item.thread.subject}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              <Collapsible open={showRawJson} onOpenChange={setShowRawJson}>
                <Card>
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Code2 className="h-4 w-4" />
                          <CardTitle className="text-sm">Raw JSON Response</CardTitle>
                        </div>
                        <ChevronDown className={`h-4 w-4 transition-transform ${showRawJson ? 'rotate-180' : ''}`} />
                      </div>
                      <CardDescription>For debugging purposes</CardDescription>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent>
                      <pre className="text-xs bg-muted p-4 rounded-lg overflow-auto max-h-96">
                        {JSON.stringify(auditData, null, 2)}
                      </pre>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            </div>
          ) : (
            <Card className="border-red-200 bg-red-50">
              <CardHeader>
                <CardTitle className="text-red-700">Audit Failed</CardTitle>
                <CardDescription className="text-red-600">
                  {auditData.error || auditData.message || 'An unknown error occurred'}
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </>
      )}

      {!auditData && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground mb-4">
              Click &quot;Run Audit Now&quot; to analyze today&apos;s email threads
            </p>
            <p className="text-sm text-muted-foreground">
              The audit will scan for emails with subjects containing &quot;Court Results&quot; or &quot;Add to Calendar&quot;
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
