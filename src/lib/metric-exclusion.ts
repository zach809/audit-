import { db, initDb } from "./db";

export async function writeMetricExclusion(input: {
  action: string;
  matterId: string;
  reason: string;
  requestedBy: string;
}): Promise<{ excluded: boolean }> {
  const action = input.action.trim();
  const matterId = input.matterId.trim();
  if (action !== "exclude" && action !== "restore") {
    throw new Error("Unknown metric action.");
  }
  if (!matterId) {
    throw new Error("Matter details were missing.");
  }

  await initDb();
  const sql = db();
  const reason = input.reason.trim();
  const requestedBy = input.requestedBy.trim();

  if (action === "exclude") {
    await sql`
      insert into audit_metric_exclusion (
        matter_id, active, requested_by, request_reason, approved_by, approved_at, updated_at
      ) values (
        ${matterId}, true, ${requestedBy}, ${reason || "Excluded by admin."}, 'Admin', now(), now()
      )
      on conflict (matter_id) do update set
        active = true,
        request_reason = excluded.request_reason,
        approved_by = 'Admin',
        approved_at = now(),
        updated_at = now()
    `;
    return { excluded: true };
  }

  await sql`
    update audit_metric_exclusion
    set active = false,
        approved_by = '',
        approved_at = null,
        updated_at = now()
    where matter_id = ${matterId}
  `;
  return { excluded: false };
}
