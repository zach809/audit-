import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { 
  User, 
  Briefcase, 
  Users, 
  FileText, 
  MapPin, 
  Calendar, 
  MessageSquare,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Gavel
} from 'lucide-react'
import type { EmailAudit } from '@/lib/types'

interface AuditCardProps {
  audit: EmailAudit
}

// Format response time into human readable string
function formatResponseTime(minutes: number | null): string {
  if (minutes === null) return 'No reply'
  if (minutes < 1) return 'Less than 1 min'
  if (minutes < 60) return `${minutes} min`
  
  const hours = Math.floor(minutes / 60)
  const remainingMins = minutes % 60
  
  if (hours < 24) {
    return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`
  }
  
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

// Get color based on response time (green = fast, yellow = moderate, red = slow)
function getResponseTimeColor(minutes: number | null): string {
  if (minutes === null) return 'text-muted-foreground'
  if (minutes <= 30) return 'text-emerald-600' // Under 30 mins - great
  if (minutes <= 120) return 'text-amber-600' // Under 2 hours - okay
  return 'text-red-600' // Over 2 hours - slow
}

export function AuditCard({ audit }: AuditCardProps) {
  const getStatusBadge = () => {
    switch (audit.audit_status) {
      case 'looks_good':
        return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Looks Good</Badge>
      case 'needs_follow_up':
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Needs Follow-Up</Badge>
      case 'no_reply':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">No Reply</Badge>
      case 'wrong_case_manager':
        return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">Wrong CM</Badge>
      case 'needs_clarification':
        return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">Needs Clarification</Badge>
    }
  }

  const getEmailTypeBadge = () => {
    return audit.email_type === 'court_results' 
      ? <Badge variant="secondary">Court Results</Badge>
      : <Badge variant="secondary">Add to Calendar</Badge>
  }

  const getOverdueBadge = () => {
    if (audit.is_overdue) {
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
          <AlertTriangle className="mr-1 h-3 w-3" />
          Overdue
        </Badge>
      )
    }
    return null
  }

  const getConfirmationBadge = () => {
    if (audit.email_type !== 'court_results' || !audit.confirmation_status) return null
    
    switch (audit.confirmation_status) {
      case 'confirmed':
        return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Confirmed</Badge>
      case 'not_confirmed':
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">Not Confirmed</Badge>
      case 'inconclusive':
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Inconclusive</Badge>
    }
  }

  return (
    <Card className="bg-muted/30">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold">{audit.client_name || 'Unknown Client'}</h4>
              {getOverdueBadge()}
              {getStatusBadge()}
              {getEmailTypeBadge()}
              {getConfirmationBadge()}
            </div>
            <p className="text-sm text-muted-foreground line-clamp-1">{audit.subject}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm md:grid-cols-2 lg:grid-cols-3">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Attorney:</span>
            <span className="font-medium">{audit.attorney || 'N/A'}</span>
          </div>
          
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Expected CM:</span>
            <span className="font-medium">{audit.expected_case_manager || 'N/A'}</span>
          </div>
          
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Replied by:</span>
            <span className={`font-medium ${audit.actual_replier !== audit.expected_case_manager ? 'text-amber-600' : ''}`}>
              {audit.actual_replier || 'No reply'}
            </span>
          </div>

          {audit.county && (
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">County:</span>
              <span className="font-medium">{audit.county}</span>
            </div>
          )}

          {audit.case_number && (
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Case #:</span>
              <span className="font-medium">{audit.case_number}</span>
            </div>
          )}

          {audit.next_court_date && (
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Next Court:</span>
              <span className="font-medium">
                {new Date(audit.next_court_date).toLocaleDateString()}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Response Time:</span>
            <span className={`font-medium ${getResponseTimeColor(audit.response_time_minutes)}`}>
              {formatResponseTime(audit.response_time_minutes)}
            </span>
          </div>
        </div>

        {audit.court_results_details && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Gavel className="h-4 w-4" />
                Court Results
              </div>
              <p className="text-sm bg-background p-3 rounded-md border">
                {audit.court_results_details}
              </p>
            </div>
          </>
        )}

        {audit.case_manager_reply && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MessageSquare className="h-4 w-4" />
                Case Manager Reply
              </div>
              <p className="text-sm text-muted-foreground bg-background p-3 rounded-md border">
                {audit.case_manager_reply}
              </p>
            </div>
          </>
        )}

        {audit.missing_or_unclear && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-600">
                <AlertCircle className="h-4 w-4" />
                Missing / Unclear
              </div>
              <p className="text-sm text-amber-700 bg-amber-50 p-3 rounded-md border border-amber-200">
                {audit.missing_or_unclear}
              </p>
            </div>
          </>
        )}

        {audit.flags && audit.flags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {audit.flags.map((flag, index) => (
              <Badge key={index} variant="outline" className="text-xs">
                {flag}
              </Badge>
            ))}
          </div>
        )}

        {audit.notes_for_zach && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                Notes for Zach
              </div>
              <p className="text-sm text-muted-foreground italic">
                {audit.notes_for_zach}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
