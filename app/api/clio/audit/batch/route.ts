import { NextResponse } from "next/server"
import { getRecentMatters, getMatterAuditBundle } from "@/lib/clio/client"
import {
  auditMatterBundles,
  summarizeAuditRows,
  MatterAuditBundle,
} from "@/lib/clio/audit-engine"
import { ClioRateLimitError } from "@/lib/clio/types"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))

    const now = new Date()

    const fromDate = body.fromDate
      ? new Date(body.fromDate)
      : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const toDate = body.toDate ? new Date(body.toDate) : now

    const matters = await getRecentMatters(fromDate, toDate)

    const bundles: MatterAuditBundle[] = []

    for (const matter of matters) {
      const bundle = await getMatterAuditBundle(matter, fromDate, toDate)
      bundles.push(bundle)
    }

    const rows = auditMatterBundles(bundles)
    const summary = summarizeAuditRows(rows)

    return NextResponse.json({
      success: true,
      mode: "local-only",
      processedMatters: matters.length,
      rows,
      summary,
    })
  } catch (error) {
    console.error("[Clio Audit Batch] Error:", error)

    if (error instanceof ClioRateLimitError) {
      return NextResponse.json(
        {
          success: false,
          error: "Clio API rate limit reached. Please continue later.",
          resetAt: error.resetAt?.toISOString(),
        },
        { status: 429 }
      )
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}