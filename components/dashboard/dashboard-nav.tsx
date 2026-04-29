'use client'

import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Scale, LogOut, Settings, Play } from 'lucide-react'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'

interface DashboardNavProps {
  user: User
}

export function DashboardNav({ user }: DashboardNavProps) {
  const router = useRouter()
  const supabase = createClient()

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/dashboard/clio-audit" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Scale className="h-4 w-4" />
            </div>
            <span className="font-semibold">Clio Audit</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link 
              href="/dashboard/clio-audit" 
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Audit
            </Link>
            <Link 
              href="/dashboard/settings" 
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">{user.email}</span>
          <Button variant="ghost" size="icon" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
            <span className="sr-only">Sign out</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
