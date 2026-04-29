import { NextResponse } from "next/server"
import { isClioConnected } from "@/lib/clio/client"

export async function GET() {
  try {
    const connected = await isClioConnected()

    return NextResponse.json({
      success: true,
      connected,
      mode: "local-only",
    })
  } catch (error) {
    console.error("[Clio Status] Error:", error)

    return NextResponse.json(
      {
        success: false,
        connected: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}