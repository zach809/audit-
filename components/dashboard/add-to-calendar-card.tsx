import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { 
  User, 
  Briefcase, 
  Users, 
  Calendar,
  CheckCircle2,
  Clock,
  MessageSquare,
  FileText
} from 'lucide-react'

interface AddToCalendarCardProps {
  result: Record<string, unknown>
  subject: string
}

export function AddToCalendarCard({ result, subject }: AddToCalendarCardProps) {
  const onboardingStatus = result.onboarding_status as string | null
  const auditStatus = result.audit_status as string
  const peopleInvolved = result.people_involved as string[] | null

  const getOnboardingBadge = () => {
    if (onboardingStatus === 'welcome_packet_sent_meeting_scheduled') {
      return (
        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Welcome Packet Sent, Meeting Scheduled
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
        <Clock className="mr-1 h-3 w-3" />
        Meeting Not Confirmed
      </Badge>
    )
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold">{String(result.client_name ?? '') || 'Unknown Client'}</h4>
              {getAuditStatusBadge()}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-1">{subject}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-muted/50 p-4 rounded-lg space-y-3 text-sm">
          {peopleInvolved && peopleInvolved.length > 0 && (
            <div className="flex items-start gap-2">
              <Users className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <span className="text-muted-foreground">People Involved: </span>
                <span className="font-medium">{peopleInvolved.join(' & ')}</span>
              </div>
            </div>
          )}
          <div className="flex items-start gap-2">
            <Briefcase className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <span className="text-muted-foreground">Attorney: </span>
              <span className="font-medium">{String(result.attorney ?? '') || 'N/A'}</span>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <span className="text-muted-foreground">Case Manager: </span>
              <span className="font-medium">{String(result.actual_replier ?? '') || 'No reply'}</span>
            </div>
          </div>
          {!!result.initial_calendar_entry && (
            <div className="flex items-start gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <span className="text-muted-foreground">Calendar Entry: </span>
                <span className="font-medium">{String(result.initial_calendar_entry ?? '')}</span>
              </div>
            </div>
          )}
          {result.attorney_instructions && (
            <div className="flex items-start gap-2">
              <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <span className="text-muted-foreground">Attorney Notes: </span>
                <span className="font-medium">{String(result.attorney_instructions ?? '')}</span>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Onboarding Status:</span>
          {getOnboardingBadge()}
        </div>
        {result.case_manager_reply && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MessageSquare className="h-4 w-4" />
                Case Manager Response
              </div>
              <div className={`text-sm p-3 rounded-md border ${
                onboardingStatus === 'welcome_packet_sent_meeting_scheduled'
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-amber-50 border-amber-200'
              }`}>
                {String(result.case_manager_reply ?? '')}
              </div>
            </div>
          </>
        )}
        {result.missing_or_unclear && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
            <p className="text-sm text-amber-700">
              <strong>Missing/Unclear:</strong> {String(result.missing_or_unclear ?? '')}
            </p>
          </div>
        )}
        {result.flags && (result.flags as string[]).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {(result.flags as string[]).map((flag, index) => (
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
