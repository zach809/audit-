import { Pool } from 'pg'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Scale, CheckCircle, RefreshCw, AlertCircle } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })
  const client = await pool.connect()
  let clioToken = null
  try {
    const result = await client.query('SELECT id, updated_at FROM clio_tokens LIMIT 1')
    clioToken = result.rows[0] || null
  } finally {
    client.release()
    await pool.end()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Configure your Clio audit system</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              Clio Connection
            </CardTitle>
            <CardDescription>
              Connect your Clio account to run operational audits
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {clioToken ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                    <CheckCircle className="mr-1 h-3 w-3" />
                    Connected
                  </Badge>
                </div>
                <div className="text-sm">
                  <p className="text-muted-foreground">
                    Last updated: {new Date(clioToken.updated_at).toLocaleString()}
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/api/auth/clio">
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reconnect
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                    <AlertCircle className="mr-1 h-3 w-3" />
                    Not Connected
                  </Badge>
                </div>
                <Button asChild>
                  <Link href="/api/auth/clio">
                    <Scale className="mr-2 h-4 w-4" />
                    Connect Clio
                  </Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              Audit Configuration
            </CardTitle>
            <CardDescription>
              Operational compliance checks for case management
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm space-y-2">
              <p><strong>Audit Checks:</strong></p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Client-attorney meeting scheduled within 48h</li>
                <li>Welcome packet sent</li>
                <li>Client contact within 24h</li>
                <li>Appearance filed email sent</li>
                <li>Court date/reminder added</li>
                <li>Court results sent within 24h</li>
                <li>Signed retainer on file</li>
              </ul>
            </div>
            <div className="text-sm space-y-2">
              <p><strong>Time Window:</strong> Last 14 days</p>
              <p><strong>Batch Size:</strong> 20 matters per request</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Privacy & Security</CardTitle>
          <CardDescription>
            How we protect your client data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-2">
            <li>Clio data is processed in memory only - no raw client data is permanently stored</li>
            <li>OAuth tokens are stored server-side only and never exposed to the browser</li>
            <li>All audit routes require authentication and email allowlist verification</li>
            <li>No data is sent to external AI services</li>
            <li>Rate limits are respected - audit stops safely if Clio limits are reached</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
