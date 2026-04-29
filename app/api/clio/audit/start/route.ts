import { NextResponse } from "next/server"
import { isClioConnected } from "@/lib/clio/client"

export async function POST() {
  try {
    const connected = await isClioConnected()

    if (!connected) {
      return NextResponse.json(
        {
          success: false,
          connected: false,
          mode: "local-only",
          error: "Clio is not connected. Missing CLIO_ACCESS_TOKEN in .env.local.",
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      connected: true,
      mode: "local-only",
      message:
        "Local-only audit is ready. Run /api/clio/audit/batch to generate fresh audit results. Results are not stored.",
    })
  } catch (error) {
    console.error("[Clio Audit Start] Error:", error)

    return NextResponse.json(
      {
        success: false,
        connected: false,
        mode: "local-only",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}