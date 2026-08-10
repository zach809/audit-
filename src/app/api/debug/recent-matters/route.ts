import { NextRequest, NextResponse } from "next/server";
import { ClioClient } from "@/lib/clio";
import { db, initDb } from "@/lib/db";
import { isAuthorizedWorkerRequest } from "@/lib/session";
import type { ClioMatter } from "@/lib/types";

export const dynamic = "force-dynamic";

function summarizeMatter(matter: ClioMatter) {
  return {
    id: matter.id,
    number: matter.display_number ?? matter.number ?? "",
    status: matter.status ?? "",
    created_at: matter.created_at,
    attorney: matter.responsible_attorney?.name ?? matter.originating_attorney?.name ?? "",
    client: matter.client?.name ?? [matter.client?.first_name, matter.client?.last_name].filter(Boolean).join(" "),
  };
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedWorkerRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await initDb();
  const sql = db();
  const client = new ClioClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fields = "id,number,display_number,status,created_at,responsible_attorney{id,name},originating_attorney{id,name},client{id,first_name,last_name,name}";
  const [createdResult, updatedResult] = await Promise.allSettled([
    client.list<ClioMatter>("/matters.json", { fields, created_since: since, order: "id(asc)" }),
    client.list<ClioMatter>("/matters.json", { fields, updated_since: since, order: "id(asc)" }),
  ]);
  const [dbRecent, dbLatest] = await Promise.all([
    sql`
      select matter_id, matter_number, matter_status, matter_created_at, responsible_attorney_name, client_first_name, client_last_name
      from audit_matter
      where matter_created_at >= ${new Date(since)}
      order by matter_created_at desc
      limit 25
    `,
    sql`
      select max(matter_created_at) as latest_matter_created_at, count(*)::int as total_saved
      from audit_matter
    `,
  ]);

  const createdMatters = createdResult.status === "fulfilled" ? createdResult.value : [];
  const updatedMatters = updatedResult.status === "fulfilled" ? updatedResult.value : [];
  const merged = Array.from(new Map([...createdMatters, ...updatedMatters].map((matter) => [String(matter.id), matter])).values())
    .sort((a, b) => new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime());

  return NextResponse.json({
    since,
    clio: {
      created_count: createdMatters.length,
      updated_count: updatedMatters.length,
      created_error: createdResult.status === "rejected" ? String(createdResult.reason) : null,
      updated_error: updatedResult.status === "rejected" ? String(updatedResult.reason) : null,
      merged_count: merged.length,
      newest_25: merged.slice(0, 25).map(summarizeMatter),
    },
    database: {
      latest: dbLatest[0] ?? null,
      recent_25: dbRecent,
    },
  });
}
