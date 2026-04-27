'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { AuditCard } from './audit-card'
import type { EmailAudit } from '@/lib/types'

interface AuditSectionProps {
  title: string
  description: string
  audits: EmailAudit[]
  variant: 'warning' | 'error' | 'success'
  defaultCollapsed?: boolean
}

export function AuditSection({ 
  title, 
  description, 
  audits, 
  variant,
  defaultCollapsed = false 
}: AuditSectionProps) {
  const [isOpen, setIsOpen] = useState(!defaultCollapsed && audits.length > 0)

  const getVariantStyles = () => {
    switch (variant) {
      case 'warning':
        return 'border-l-amber-500'
      case 'error':
        return 'border-l-red-500'
      case 'success':
        return 'border-l-emerald-500'
    }
  }

  return (
    <Card className={`border-l-4 ${getVariantStyles()}`}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                {title}
                <span className="text-sm font-normal text-muted-foreground">
                  ({audits.length})
                </span>
              </CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                {isOpen ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
                <span className="sr-only">Toggle</span>
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>
            {audits.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No items in this category
              </p>
            ) : (
              <div className="grid gap-4">
                {audits.map((audit) => (
                  <AuditCard key={audit.id} audit={audit} />
                ))}
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
