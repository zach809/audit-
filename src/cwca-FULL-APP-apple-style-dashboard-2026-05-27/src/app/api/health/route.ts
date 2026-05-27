import { NextResponse } from "next/server";
import { APP_VERSION } from "@/lib/version";
import { db, initDb } from "@/lib/db";
import { hasClioConnection } from "@/lib/token-store";

export async function GET() {
  try {
    await initDb();
    const [summary, lastRun] = await Promise.all([
      db()`select count(*)::int as matters from audit_matter`,
      db()`select status, started_at, finished_at, message from audit_run order by started_at desc limit 1`,
    ]);
    return NextResponse.json({
      ok: true,
      version: APP_VERSION,
      clioConnected: await hasClioConnection().catch(() => false),
      matters: summary[0]?.matters ?? 0,
      lastRun: lastRun[0] ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        version: APP_VERSION,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
