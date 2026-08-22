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
      max: 10,
      idle_timeout: 20,
      connect_timeout: 8,
    });
  }
  return global.cwcaSql;
}

function dbErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("CONNECT_TIMEOUT")) {
    return "Database connection timed out. Check that DATABASE_URL is correct, the database is awake, and Vercel is allowed to connect.";
  }
  if (raw.includes("ECONNREFUSED") || raw.includes("ENOTFOUND") || raw.includes("ETIMEDOUT")) {
    return "Database connection failed. Check DATABASE_URL and the database network settings.";
  }
  return raw;
}

export function formatDbError(error: unknown): Error {
  const formatted = new Error(dbErrorMessage(error));
  if (error instanceof Error && error.stack) formatted.stack = error.stack;
  return formatted;
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
  audit_version text,
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
  app_version text,
  message text
);

create table if not exists audit_review (
  matter_id text not null references audit_matter(matter_id) on delete cascade,
  step_code text not null,
  review_decision text not null default 'Needs Review',
  review_note text not null default '',
  case_manager_name text not null default '',
  proof_type text not null default 'None Available',
  proof_reference text not null default '',
  next_step text not null default '',
  report_summary text not null default '',
  internal_notes text not null default '',
  include_in_report boolean not null default true,
  reviewed_by text not null default '',
  review_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (matter_id, step_code)
);

create table if not exists audit_review_history (
  history_id bigserial primary key,
  matter_id text not null references audit_matter(matter_id) on delete cascade,
  step_code text not null,
  previous_decision text,
  review_decision text not null,
  results_details text not null default '',
  case_manager_name text not null default '',
  proof_type text not null default 'None Available',
  proof_reference text not null default '',
  next_step text not null default '',
  report_summary text not null default '',
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists audit_metric_exclusion (
  matter_id text primary key references audit_matter(matter_id) on delete cascade,
  active boolean not null default false,
  requested_by text not null default '',
  request_reason text not null default '',
  approved_by text not null default '',
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists post_closure_followup (
  matter_id text not null,
  touchpoint_months integer not null,
  touchpoint_label text not null,
  matter_number text not null default '',
  client_first_name text not null default '',
  client_last_name text not null default '',
  responsible_attorney_name text not null default '',
  matter_closed_at timestamptz not null,
  due_at timestamptz not null,
  review_status text not null default '',
  contact_method text not null default '',
  issue_type text not null default '',
  followup_note text not null default '',
  reviewed_by text not null default '',
  completed_at timestamptz,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (matter_id, touchpoint_months)
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

alter table if exists audit_item add column if not exists audit_version text;
alter table if exists audit_item add column if not exists last_evaluated_at timestamptz;
update audit_item set last_evaluated_at = now() where last_evaluated_at is null;
alter table if exists audit_item alter column last_evaluated_at set default now();
alter table if exists audit_item alter column last_evaluated_at set not null;
alter table if exists audit_run add column if not exists app_version text;
alter table if exists audit_review add column if not exists review_decision text;
alter table if exists audit_review add column if not exists review_note text;
alter table if exists audit_review add column if not exists case_manager_name text;
alter table if exists audit_review add column if not exists proof_type text;
alter table if exists audit_review add column if not exists proof_reference text;
alter table if exists audit_review add column if not exists next_step text;
alter table if exists audit_review add column if not exists report_summary text;
alter table if exists audit_review add column if not exists internal_notes text;
alter table if exists audit_review add column if not exists include_in_report boolean;
alter table if exists audit_review add column if not exists reviewed_by text;
alter table if exists audit_review add column if not exists review_completed_at timestamptz;
alter table if exists audit_review add column if not exists created_at timestamptz;
alter table if exists audit_review add column if not exists updated_at timestamptz;
update audit_review
set review_decision = coalesce(nullif(review_decision, 'Pending'), 'Needs Review'),
    review_note = coalesce(review_note, ''),
    case_manager_name = coalesce(case_manager_name, ''),
    proof_type = coalesce(proof_type, 'None Available'),
    proof_reference = coalesce(proof_reference, ''),
    next_step = coalesce(next_step, ''),
    report_summary = coalesce(report_summary, ''),
    internal_notes = coalesce(internal_notes, ''),
    include_in_report = coalesce(include_in_report, true),
    reviewed_by = coalesce(reviewed_by, ''),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now());
alter table if exists audit_review alter column review_decision set default 'Needs Review';
alter table if exists audit_review alter column review_note set default '';
alter table if exists audit_review alter column case_manager_name set default '';
alter table if exists audit_review alter column proof_type set default 'None Available';
alter table if exists audit_review alter column proof_reference set default '';
alter table if exists audit_review alter column next_step set default '';
alter table if exists audit_review alter column report_summary set default '';
alter table if exists audit_review alter column internal_notes set default '';
alter table if exists audit_review alter column include_in_report set default true;
alter table if exists audit_review alter column reviewed_by set default '';
alter table if exists audit_review alter column created_at set default now();
alter table if exists audit_review alter column updated_at set default now();
alter table if exists audit_review alter column review_decision set not null;
alter table if exists audit_review alter column review_note set not null;
alter table if exists audit_review alter column case_manager_name set not null;
alter table if exists audit_review alter column proof_type set not null;
alter table if exists audit_review alter column proof_reference set not null;
alter table if exists audit_review alter column next_step set not null;
alter table if exists audit_review alter column report_summary set not null;
alter table if exists audit_review alter column internal_notes set not null;
alter table if exists audit_review alter column include_in_report set not null;
alter table if exists audit_review alter column reviewed_by set not null;
alter table if exists audit_review alter column created_at set not null;
alter table if exists audit_review alter column updated_at set not null;
alter table if exists audit_review_history add column if not exists case_manager_name text;
update audit_review_history set case_manager_name = coalesce(case_manager_name, '');
alter table if exists audit_review_history alter column case_manager_name set default '';
alter table if exists audit_review_history alter column case_manager_name set not null;
alter table if exists audit_metric_exclusion add column if not exists active boolean;
alter table if exists audit_metric_exclusion add column if not exists requested_by text;
alter table if exists audit_metric_exclusion add column if not exists request_reason text;
alter table if exists audit_metric_exclusion add column if not exists approved_by text;
alter table if exists audit_metric_exclusion add column if not exists approved_at timestamptz;
alter table if exists audit_metric_exclusion add column if not exists created_at timestamptz;
alter table if exists audit_metric_exclusion add column if not exists updated_at timestamptz;
update audit_metric_exclusion
set active = coalesce(active, false),
    requested_by = coalesce(requested_by, ''),
    request_reason = coalesce(request_reason, ''),
    approved_by = coalesce(approved_by, ''),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now());
alter table if exists audit_metric_exclusion alter column active set default false;
alter table if exists audit_metric_exclusion alter column requested_by set default '';
alter table if exists audit_metric_exclusion alter column request_reason set default '';
alter table if exists audit_metric_exclusion alter column approved_by set default '';
alter table if exists audit_metric_exclusion alter column created_at set default now();
alter table if exists audit_metric_exclusion alter column updated_at set default now();
alter table if exists audit_metric_exclusion alter column active set not null;
alter table if exists audit_metric_exclusion alter column requested_by set not null;
alter table if exists audit_metric_exclusion alter column request_reason set not null;
alter table if exists audit_metric_exclusion alter column approved_by set not null;
alter table if exists audit_metric_exclusion alter column created_at set not null;
alter table if exists audit_metric_exclusion alter column updated_at set not null;
alter table if exists audit_metric_snapshot add column if not exists logged_call_count integer;
update audit_metric_snapshot set logged_call_count = 0 where logged_call_count is null;
alter table if exists audit_metric_snapshot alter column logged_call_count set default 0;
alter table if exists audit_metric_snapshot alter column logged_call_count set not null;
alter table if exists post_closure_followup add column if not exists contact_method text;
alter table if exists post_closure_followup add column if not exists issue_type text;
alter table if exists post_closure_followup add column if not exists followup_note text;
alter table if exists post_closure_followup add column if not exists reviewed_by text;
alter table if exists post_closure_followup add column if not exists completed_at timestamptz;
alter table if exists post_closure_followup add column if not exists last_synced_at timestamptz;
alter table if exists post_closure_followup add column if not exists created_at timestamptz;
alter table if exists post_closure_followup add column if not exists updated_at timestamptz;
update post_closure_followup
set contact_method = coalesce(contact_method, ''),
    issue_type = coalesce(issue_type, ''),
    followup_note = coalesce(followup_note, ''),
    reviewed_by = coalesce(reviewed_by, ''),
    last_synced_at = coalesce(last_synced_at, now()),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now());
alter table if exists post_closure_followup alter column contact_method set default '';
alter table if exists post_closure_followup alter column issue_type set default '';
alter table if exists post_closure_followup alter column followup_note set default '';
alter table if exists post_closure_followup alter column reviewed_by set default '';
alter table if exists post_closure_followup alter column last_synced_at set default now();
alter table if exists post_closure_followup alter column created_at set default now();
alter table if exists post_closure_followup alter column updated_at set default now();
alter table if exists post_closure_followup alter column contact_method set not null;
alter table if exists post_closure_followup alter column issue_type set not null;
alter table if exists post_closure_followup alter column followup_note set not null;
alter table if exists post_closure_followup alter column reviewed_by set not null;
alter table if exists post_closure_followup alter column last_synced_at set not null;
alter table if exists post_closure_followup alter column created_at set not null;
alter table if exists post_closure_followup alter column updated_at set not null;

create index if not exists audit_matter_attorney_idx on audit_matter(responsible_attorney_id);
create index if not exists audit_matter_created_idx on audit_matter(matter_created_at);
create index if not exists audit_matter_last_audited_idx on audit_matter(last_audited_at);
create index if not exists audit_item_status_idx on audit_item(status);
create index if not exists audit_item_audit_version_idx on audit_item(audit_version);
create index if not exists audit_review_decision_idx on audit_review(review_decision);
create index if not exists audit_review_history_matter_idx on audit_review_history(matter_id, step_code, updated_at desc);
create index if not exists audit_metric_exclusion_active_idx on audit_metric_exclusion(active);
create index if not exists post_closure_followup_due_idx on post_closure_followup(due_at);
create index if not exists post_closure_followup_status_idx on post_closure_followup(review_status);
create index if not exists post_closure_followup_touchpoint_idx on post_closure_followup(touchpoint_months);
`;

export async function initDb(): Promise<void> {
  if (!global.cwcaDbReady) {
    global.cwcaDbReady = db()
      .unsafe(schema)
      .then(() => undefined)
      .catch((error) => {
        global.cwcaDbReady = undefined;
        throw formatDbError(error);
      });
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
