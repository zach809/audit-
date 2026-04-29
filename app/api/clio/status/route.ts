import { NextResponse } from "next/server"
import { isClioConnected } from "@/lib/clio/client"

export async function GET() {
  try {
    const connected = await isClioConnected()

    return NextResponse.json({
      success: true,
      connected,
      mode: "local-only",
      status: connected ? "ready" : "not_connected",
      message: connected
        ? "Clio is connected. Run /api/clio/audit/batch to generate fresh local-only audit results."
        : "Clio is not connected. Add CLIO_ACCESS_TOKEN to .env.local.",
    })
  } catch (error) {
    console.error("[Clio Audit Status] Error:", error)

    return NextResponse.json(
      {
        success: false,
        connected: false,
        mode: "local-only",
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}