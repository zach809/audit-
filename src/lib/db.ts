import postgres from "postgres";
import { appConfig } from "./config";

declare global {
  // eslint-disable-next-line no-var
  var cwcaSql: postgres.Sql | undefined;
  // eslint-disable-next-line no-var
  var cwcaDbReady: Promise<void> | undefined;
}

export function db() {
  if (!global.cwcaSql) {
    global.cwcaSql = postgres(appConfig().databaseUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }
  return global.cwcaSql;
}

const schema = `
create table if not exists oauth_tokens (
  provider text primary key,
  encrypted_refresh_token text not null,
  encrypted_access_token text,
  access_token_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists audit_state (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists audit_matter (
  matter_id text primary key,
  matter_number text not null,
  matter_status text not null,
  client_id text,
  client_first_name text not null default '',
  client_last_name text not null default '',
  responsible_attorney_id text,
  responsible_attorney_name text not null default '',
  matter_created_at timestamptz not null,
  effective_intake_at timestamptz not null,
  last_court_date timestamptz,
  next_court_date timestamptz,
  overall_status text not null default 'Pass',
  last_audited_at timestamptz
);

create table if not exists audit_item (
  matter_id text not null references audit_matter(matter_id) on delete cascade,
  step_code text not null,
  status text not null,
  operational_state text not null default '',
  deadline_at timestamptz,
  corrective_deadline_at timestamptz,
  evidence_at timestamptz,
  evidence_source text,
  evidence_ref_id text,
  evidence_url text,
  reason_code text,
  last_evaluated_at timestamptz not null default now(),
  primary key (matter_id, step_code)
);

create table if not exists audit_run (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  matters_discovered integer not null default 0,
  matters_audited integer not null default 0,
  message text
);

create table if not exists audit_metric_snapshot (
  snapshot_id bigserial primary key,
  period_start date not null,
  period_end date not null,
  period_type text not null,
  responsible_attorney_id text,
  responsible_attorney_name text not null default '',
  matters_checked integer not null default 0,
  pass_count integer not null default 0,
  late_count integer not null default 0,
  flag_count integer not null default 0,
  review_count integer not null default 0,
  missing_item_count integer not null default 0,
  late_item_count integer not null default 0,
  unknown_item_count integer not null default 0,
  welcome_packets_sent integer not null default 0,
  appearance_filings_sent integer not null default 0,
  court_result_emails_sent integer not null default 0,
  attorney_calls_scheduled integer not null default 0,
  logged_call_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists audit_matter_attorney_idx on audit_matter(responsible_attorney_id);
create index if not exists audit_matter_created_idx on audit_matter(matter_created_at);
create index if not exists audit_matter_last_audited_idx on audit_matter(last_audited_at);
create index if not exists audit_item_status_idx on audit_item(status);
`;

export async function initDb(): Promise<void> {
  if (!global.cwcaDbReady) {
    global.cwcaDbReady = db().unsafe(schema).then(() => undefined);
  }
  return global.cwcaDbReady;
}

export async function pruneExpiredStoredData(): Promise<void> {
  await initDb();
  const sql = db();
  const config = appConfig();

  await sql`
    update oauth_tokens
    set encrypted_access_token = null,
        access_token_expires_at = null,
        updated_at = now()
    where encrypted_access_token is not null
      and access_token_expires_at is not null
      and access_token_expires_at < now()
  `;

  await sql`
    delete from audit_run
    where coalesce(finished_at, started_at) < now() - (${config.auditRunRetentionDays}::int * interval '1 day')
  `;

  await sql`
    delete from audit_metric_snapshot
    where created_at < now() - (${config.auditMetricRetentionDays}::int * interval '1 day')
  `;

  await sql`
    delete from audit_matter
    where lower(matter_status) = 'closed'
      and coalesce(last_audited_at, matter_created_at) < now() - (${config.closedMatterRetentionDays}::int * interval '1 day')
  `;
}
