import { Card, CardContent } from '@/components/ui/card'
import { 
  Mail, 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  HelpCircle 
} from 'lucide-react'

interface AuditSummaryStatsProps {
  totalProcessed: number
  statusCounts: Record<string, number>
}

export function AuditSummaryStats({ totalProcessed, statusCounts }: AuditSummaryStatsProps) {
  const stats = [
    {
      label: 'Total Processed',
      value: totalProcessed,
      icon: Mail,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      label: 'Looks Good',
      value: statusCounts.looks_good || 0,
      icon: CheckCircle,
      color: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
    },
    {
      label: 'Needs Follow-Up',
      value: statusCounts.needs_follow_up || 0,
      icon: AlertTriangle,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
    },
    {
      label: 'No Reply',
      value: statusCounts.no_reply || 0,
      icon: XCircle,
      color: 'text-red-600',
      bgColor: 'bg-red-50',
    },
    {
      label: 'Needs Clarification',
      value: statusCounts.needs_clarification || 0,
      icon: HelpCircle,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-5">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
