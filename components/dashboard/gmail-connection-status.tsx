'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Mail, CheckCircle, AlertCircle } from 'lucide-react'
import Link from 'next/link'

interface GmailConnectionStatusProps {
  isConnected: boolean
  email?: string
  lastSync?: string
}

export function GmailConnectionStatus({ isConnected, email, lastSync }: GmailConnectionStatusProps) {
  if (!isConnected) {
    return (
      <Button asChild variant="outline">
        <Link href="/api/auth/gmail">
          <Mail className="mr-2 h-4 w-4" />
          Connect Gmail
        </Link>
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
        <CheckCircle className="mr-1 h-3 w-3" />
        Gmail Connected
      </Badge>
      <div className="text-sm text-muted-foreground">
        <span>{email}</span>
        {lastSync && (
          <span className="ml-2">
            Last sync: {new Date(lastSync).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  )
}
