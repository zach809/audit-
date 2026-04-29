import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  User,
  Briefcase,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Gavel,
  Calendar
} from 'lucide-react'
import type { EmailAudit } from '@/lib/types'

interface CourtResultsCardProps {
  result: EmailAudit
  subject: string
}

export function CourtResultsCard({ result, subject }: CourtResultsCardProps) {
  const confirmationStatus = result.confirmation_status
  const isOverdue = result.is_overdue
  const auditStatus = result.audit_status

  const getStatusBadge = () => {
    if (isOverdue) {
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
          <AlertTriangle className="mr-1 h-3 w-3" />
          Overdue
        </Badge>
      )
    }
    switch (confirmationStatus) {
      case 'confirmed':
        return (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            Confirmed
          </Badge>
        )
      case 'not_confirmed':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
            <XCircle className="mr-1 h-3 w-3" />
            Not Confirmed
          </Badge>
        )
      case 'inconclusive':
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
            <HelpCircle className="mr-1 h-3 w-3" />
            Inconclusive
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
            No Reply
          </Badge>
        )
    }
  }

  const getAuditStatusBadge = () => {
    switch (auditStatus) {
      case 'looks_good':
        return <Badge variant="secondary" className="bg-emerald-100">Looks Good</Badge>
      case 'needs_follow_up':
        return <Badge variant="secondary" className="bg-amber-100">Needs Follow-Up</Badge>
      case 'no_reply':
        return <Badge variant="secondary" className="bg-red-100">No Reply</Badge>
      case 'wrong_case_manager':
        return <Badge variant="secondary" className="bg-orange-100">Wrong CM</Badge>
      case 'needs_clarification':
        return <Badge variant="secondary" className="bg-yellow-100">Needs Clarification</Badge>
      default:
        return null
    }
  }

  const formatTimestamp = (timestamp: string | null | undefined) => {
    if (!timestamp) return 'N/A'
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Chicago'
    }) + ' CDT'
  }

  return (
    <Card className={`${isOverdue ? 'border-red-300 bg-red-50/30' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold">{result.client_name || 'Unknown Client'}</h4>
              {getStatusBadge()}
              {getAuditStatusBadge()}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-1">{subject}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Attorney:</span>
            <span className="font-medium">{result.attorney || 'N/A'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Case Manager:</span>
            <span className="font-medium">{result.actual_replier || 'No reply'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Received:</span>
            <span className="font-medium">{formatTimestamp(result.audited_at)}</span>
          </div>
          {result.next_court_date && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">Next Court:</span>
              <span className="font-medium">
                {new Date(result.next_court_date).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>

        {result.court_results_details && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Gavel className="h-4 w-4" />
                Court Results
              </div>
              <p className="text-sm bg-background p-3 rounded-md border">
                {typeof result.court_results_details === 'string'
                  ? result.court_results_details
                  : JSON.stringify(result.court_results_details)}
              </p>
            </div>
          </>
        )}

        {result.case_manager_reply && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <User className="h-4 w-4" />
                Case Manager Response
              </div>
              <div className={`text-sm p-3 rounded-md border ${
                confirmationStatus === 'confirmed'
                  ? 'bg-emerald-50 border-emerald-200'
                  : confirmationStatus === 'not_confirmed'
                    ? 'bg-red-50 border-red-200'
                    : 'bg-amber-50 border-amber-200'
              }`}>
                {result.case_manager_reply}
              </div>
            </div>
          </>
        )}

        {result.missing_or_unclear && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
            <p className="text-sm text-amber-700">
              <strong>Missing/Unclear:</strong> {result.missing_or_unclear}
            </p>
          </div>
        )}

        {result.flags && result.flags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {result.flags.map((flag: string, index: number) => (
              <Badge key={index} variant="outline" className="text-xs">
                {flag}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
