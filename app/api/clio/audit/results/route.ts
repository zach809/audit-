import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({
    success: true,
    mode: "local-only",
    message:
      "Audit results are not stored because this app is running in local-only mode. Use /api/clio/audit/batch to generate fresh audit results.",
    rows: [],
    summary: {
      totalRows: 0,
      passRows: 0,
      flagRows: 0,
      missingItemCounts: {},
    },
  })
}