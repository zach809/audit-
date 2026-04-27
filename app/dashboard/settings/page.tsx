import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Mail, CheckCircle, Users, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import type { AttorneyAssignment } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const supabase = await createClient()

  // Check Gmail connection
  const { data: gmailToken } = await supabase
    .from('gmail_tokens')
    .select('email, updated_at')
    .limit(1)
    .single()

  // Get attorney assignments
  const { data: assignments } = await supabase
    .from('attorney_assignments')
    .select('*')
    .order('attorney_name')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Configure your email audit system</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Gmail Connection
            </CardTitle>
            <CardDescription>
              Connect your Gmail account to scan email threads
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {gmailToken ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Connected
                  </Badge>
                </div>
                <div className="text-sm">
                  <p className="font-medium">{gmailToken.email}</p>
                  <p className="text-muted-foreground">
                    Last synced: {new Date(gmailToken.updated_at).toLocaleString()}
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/api/auth/gmail">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reconnect
                  </Link>
                </Button>
              </div>
            ) : (
              <Button asChild>
                <Link href="/api/auth/gmail">
                  <Mail className="mr-2 h-4 w-4" />
                  Connect Gmail
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Audit Schedule
            </CardTitle>
            <CardDescription>
              Daily audit runs automatically at 5 PM EST
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm space-y-2">
              <p><strong>Email Types Scanned:</strong></p>
              <ul className="list-disc list-inside text-muted-foreground">
                <li>Subject contains &quot;Court Results&quot;</li>
                <li>Subject contains &quot;Add to Calendar&quot;</li>
              </ul>
            </div>
            <form action="/api/audit/run" method="POST">
              <Button type="submit" variant="outline" size="sm">
                <RefreshCw className="mr-2 h-4 w-4" />
                Run Audit Now
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Attorney Assignments</CardTitle>
          <CardDescription>
            Attorney to Case Manager mappings used for audit validation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {assignments?.map((assignment: AttorneyAssignment) => (
              <div 
                key={assignment.id} 
                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
              >
                <div>
                  <p className="font-medium text-sm">{assignment.attorney_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {assignment.case_manager_name || 'Unassigned'}
                  </p>
                </div>
                {assignment.is_unassigned && (
                  <Badge variant="outline" className="text-xs">Manual Review</Badge>
                )}
              </div>
            ))}
          </div>
          <Separator className="my-4" />
          <p className="text-sm text-muted-foreground">
            <strong>Special Rule:</strong> Zach handles Lori&apos;s Spanish calls.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
