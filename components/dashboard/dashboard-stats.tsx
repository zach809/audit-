import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Mail, AlertTriangle, XCircle, CheckCircle, Clock } from 'lucide-react'
import type { AuditSummary } from '@/lib/types'

interface DashboardStatsProps {
  summary: AuditSummary | null
}

export function DashboardStats({ summary }: DashboardStatsProps) {
  const stats = [
    {
      title: 'Total Scanned',
      value: summary?.total_emails_scanned ?? 0,
      icon: Mail,
      description: 'Emails processed today',
    },
    {
      title: 'Needs Follow-Up',
      value: summary?.needs_follow_up ?? 0,
      icon: AlertTriangle,
      description: 'Require attention',
      variant: 'warning' as const,
    },
    {
      title: 'No Reply',
      value: summary?.no_reply ?? 0,
      icon: XCircle,
      description: 'Missing responses',
      variant: 'error' as const,
    },
    {
      title: 'Needs Clarification',
      value: summary?.needs_clarification ?? 0,
      icon: Clock,
      description: 'Vague replies',
      variant: 'warning' as const,
    },
    {
      title: 'Looks Good',
      value: summary?.looks_good ?? 0,
      icon: CheckCircle,
      description: 'Properly handled',
      variant: 'success' as const,
    },
  ]

  const getVariantStyles = (variant?: 'warning' | 'error' | 'success') => {
    switch (variant) {
      case 'warning':
        return 'text-amber-600'
      case 'error':
        return 'text-red-600'
      case 'success':
        return 'text-emerald-600'
      default:
        return 'text-foreground'
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      {stats.map((stat) => (
        <Card key={stat.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
            <stat.icon className={`h-4 w-4 ${getVariantStyles(stat.variant)}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getVariantStyles(stat.variant)}`}>
              {stat.value}
            </div>
            <p className="text-xs text-muted-foreground">{stat.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
