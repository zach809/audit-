import { NextResponse } from 'next/server'
import { Pool } from 'pg'

export async function GET() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })

  try {
    const client = await pool.connect()

    try {
      const result = await client.query(
        'SELECT id, updated_at, expires_at FROM clio_tokens LIMIT 1'
      )

      const token = result.rows[0] || null

      return NextResponse.json({
        success: true,
        connected: Boolean(token),
        token,
      })
    } finally {
      client.release()
    }
  } catch (error) {
    console.error('[Clio Status] Error:', error)

    return NextResponse.json(
      {
        success: false,
        connected: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  } finally {
    await pool.end()
  }
}
