import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table'
import { Calendar, Mail, AlertTriangle, CheckCircle, XCircle } from 'lucide-react'
import type { AuditSummary } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function HistoryPage() {
  const supabase = await createClient()

  // Get audit summaries for the past 30 days
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: summaries } = await supabase
    .from('audit_summaries')
    .select('*')
    .gte('audit_date', thirtyDaysAgo.toISOString().split('T')[0])
    .order('audit_date', { ascending: false })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit History</h1>
        <p className="text-muted-foreground">Daily audit summaries for the past 30 days</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Daily Summaries
          </CardTitle>
          <CardDescription>
            Overview of email audits performed each day
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!summaries || summaries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No audit history available yet.</p>
              <p className="text-sm">Run your first audit to see results here.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-center">Total</TableHead>
                  <TableHead className="text-center">
                    <span className="flex items-center justify-center gap-1">
                      <CheckCircle className="h-4 w-4 text-emerald-600" />
                      Good
                    </span>
                  </TableHead>
                  <TableHead className="text-center">
                    <span className="flex items-center justify-center gap-1">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      Follow-Up
                    </span>
                  </TableHead>
                  <TableHead className="text-center">
                    <span className="flex items-center justify-center gap-1">
                      <XCircle className="h-4 w-4 text-red-600" />
                      No Reply
                    </span>
                  </TableHead>
                  <TableHead className="text-center">Clarify</TableHead>
                  <TableHead>Summary Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaries.map((summary: AuditSummary) => (
                  <TableRow key={summary.id}>
                    <TableCell className="font-medium">
                      {new Date(summary.audit_date).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </TableCell>
                    <TableCell className="text-center">
                      {summary.total_emails_scanned}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                        {summary.looks_good}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {summary.needs_follow_up > 0 ? (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                          {summary.needs_follow_up}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {summary.no_reply > 0 ? (
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                          {summary.no_reply}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {summary.needs_clarification > 0 ? (
                        <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                          {summary.needs_clarification}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {summary.summary_sent ? (
                        <div className="text-sm">
                          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                            Sent
                          </Badge>
                          {summary.summary_sent_at && (
                            <span className="ml-2 text-muted-foreground">
                              {new Date(summary.summary_sent_at).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">Not sent</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
