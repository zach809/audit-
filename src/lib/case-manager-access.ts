import { standardsCaseManagerFor } from "./dashboard-data";
import { db, initDb } from "./db";
import { caseManagerPortalIdentity, normalizeCaseManagerIdentity } from "./case-manager-identity";

type MatterAssignmentRow = {
  matter_id: string;
  matter_number: string;
  client_first_name: string | null;
  client_last_name: string | null;
  responsible_attorney_name: string | null;
  case_manager_name: string | null;
};

export async function caseManagerCanAccessMatter(login: string, matterId: string): Promise<boolean> {
  const identity = caseManagerPortalIdentity(login);
  if (identity.isAdmin) return true;
  if (!identity.owner || !matterId) return false;

  await initDb();
  const sql = db();
  const rows = await sql<MatterAssignmentRow[]>`
    select
      m.matter_id,
      m.matter_number,
      m.client_first_name,
      m.client_last_name,
      m.responsible_attorney_name,
      latest_review.case_manager_name
    from audit_matter m
    left join lateral (
      select r.case_manager_name
      from audit_review r
      where r.matter_id = m.matter_id
      order by r.updated_at desc
      limit 1
    ) latest_review on true
    where m.matter_id = ${matterId}
    limit 1
  `;
  const matter = rows[0];
  if (!matter) return false;

  return normalizeCaseManagerIdentity(standardsCaseManagerFor(matter)) === normalizeCaseManagerIdentity(identity.owner);
}
