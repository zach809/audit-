# Clio Workflow Compliance Auditor (CWCA)

Version: 1.1  
Operational mode: Read-only, scheduled batch  
Clio region: US  
Firm timezone: America/Chicago  
Business hours: Monday-Friday, 8:00 AM-5:00 PM local time

## 1. Purpose

CWCA audits whether matter workflow tasks are completed in Clio using only API-visible, timestamped evidence. The system exists to support attorney-level dashboard visibility, coaching, corrective action, and historical performance trends.

The auditor does not measure intent. If Clio shows timestamped evidence, it counts. If Clio does not show evidence, the result is Missing or Unknown depending on API visibility.

## 2. Hard Constraints

- Use only Clio Manage read-only API capabilities.
- Never create, update, delete, subscribe to webhooks, or request write scopes.
- Exclude Closed matters only. Include Open and Pending matters.
- Use explicit field selection on every request.
- Respect Clio rate limits: cap the application at 40 requests/minute.
- Use `limit=200` for list requests.
- Use cursor pagination via `page_token` and `meta.paging.next`.
- Store minimal information only.
- Do not store message bodies, note details, document contents, billing data, financial data, or unrelated PII.
- Clio Tasks do not count as workflow evidence.
- Text messages and client portal messages do not count as template evidence.

## 3. Approved Clio Objects

Primary objects:

- Matters
- Contacts
- Users
- Calendar Entries
- Communications
- Notes
- Activities, for call/activity metrics only if available

Optional objects:

- Documents metadata only, no downloads or content parsing
- Court Rules only if available under the firm's plan and read-only API access

Disallowed:

- Accounting
- Billing
- Payment distributions
- Clio Payments
- Reporting
- Settings
- Imports
- Webhooks
- Custom actions
- Client share permissions
- Grants
- Personal injury
- Any write-enabled scope

If a workflow requirement depends on disallowed access, mark it as Unsupported by permitted API scope. If a required API capability is unclear, mark it Unknown and surface it in the permission/API gap report.

## 4. Business-Day Deadline Rules

All deadlines use America/Chicago business time.

Business window:

- Monday-Friday
- 8:00 AM-5:00 PM
- Weekends are non-working time

Effective matter intake time:

- If a matter is created during business hours, use the actual Clio `created_at` time.
- If created before 8:00 AM on a business day, use 8:00 AM that day.
- If created after 5:00 PM on a business day, use 8:00 AM the next business day.
- If created Saturday or Sunday, use Monday 8:00 AM.

Setup on-time deadline:

- 2 business hours after effective matter intake time for the initial attorney call standard.

Setup same-day corrective deadline:

- 5:00 PM on the same business day as the setup on-time deadline.

Setup grading:

- Evidence at or before the 1-business-hour deadline: On Time.
- Evidence after the 2-business-hour setup goal but before 5:00 PM same business day: Late, coaching-worthy but completed.
- No evidence before 5:00 PM same business day: Missing.
- Before 5:00 PM, the dashboard should show an operational state such as Needs Welcome Packet, Needs Attorney Call, or Needs Court Date.

Client contact deadline:

- Next business day by 5:00 PM after effective matter intake.

Appearance filing deadline:

- Second business day by 5:00 PM after effective matter intake.

Court results deadline:

- Next business day by 5:00 PM after court event end.

Post-court attorney call deadline:

- Next business day by 5:00 PM after court event end, only if the case continues and a next court date exists.

## 5. Workflow Steps

### Step 1: Matter Intake

Anchor: Clio Matter creation.

Capture:

- Matter ID
- Matter number/display number
- Matter created timestamp
- Responsible attorney
- Client first and last name
- Matter status

Closed matters are excluded from audit evaluation.

### Step 2: Setup Audit

Anchor: effective matter intake.

Checks:

- Welcome packet sent.
- Attorney/client phone call scheduled.
- Court date added.

Welcome packet evidence:

- Must be the correct Clio email/template communication.
- Subject/body may be scanned transiently for matching, but body is never stored.
- Known English and Spanish template patterns should be configured.

Known template names:

- `Welcome Letter`
- `Carta de bienvenida`

Attorney/client call evidence:

- Calendar entry scheduled for the matter.
- Future scheduled calls count.
- Logged/completed calls are reported as metrics but do not replace the scheduled-call setup requirement unless later configured.

Known calendar title examples:

- `LQ-Phone Call-Stephen Williams`
- `AP-PhoneCall-Ali Kasim`

Matching patterns:

- `{initials}-Phone Call-{client name}`
- `{initials}-PhoneCall-{client name}`
- `phone`
- `phone call`
- `client call`
- `attorney call`
- `PHONE-CLIENT`
- `MF-PHONE-CLIENT`

Court date evidence:

- Calendar entry on the matter matching court-event language.
- If no court date is added by the setup checkpoint, operational status is Needs Court Date.
- If still absent after the same-day 5:00 PM corrective deadline, status becomes Missing.

Known court/calendar examples:

- `AP-Spanish Jail zoom`
- location `Zoom`
- event text mentioning court, jail, hearing, arraignment, pretrial, trial, status, courtroom, or Zoom court.

### Step 3: Client Contact Audit

Deadline: next business day by 5:00 PM.

Evidence:

- Outgoing email/log communication to the client.
- Matter note only if explicitly configured as acceptable evidence.
- Text messages and client portal messages do not count for template evidence.

If communication direction cannot be proven from API-visible senders/receivers/users/contacts, mark Unknown.

### Step 4: Appearance Filing Audit

Deadline: 48 hours after the matter was created, skipping non-business days.

Evidence:

- Clio communication showing appearance filing template or appearance-related email.

Known example:

- `Court Appearance Has Been Filed Notification: ...`
- `Notificación de Presentación en la Corte`

Matching language:

- `appearance`
- `notice of appearance`
- `filed appearance`
- `e-filed`
- `court appearance has been filed`
- `presentacion en la corte`
- `presentación en la corte`

### Step 5: Court Event Monitoring

Cadence: continuous scheduled sweep.

Evidence:

- Calendar entries linked to the matter that appear to represent a court event.

Court event matching language:

- `court`
- `hearing`
- `arraignment`
- `pretrial`
- `trial`
- `status`
- `zoom`
- `courtroom`
- `jail`

Maintain:

- Rolling list of court events per matter.
- Last court date, calculated as the latest court event start time before now.
- Next court date, calculated as the earliest court event start time after the previous court event.

### Step 6: Court Results Audit

Deadline: next business day by 5:00 PM after court event end.

Evidence:

- Court result email/template communication.
- Matter note may be included if configured later.
- Adding the next court date alone is useful context but does not satisfy the court results communication requirement unless explicitly configured.

Known examples:

- `Court Result 04/06/2026 || Next Court Date 05/04/2026`
- `Court Result 02/17/26 | Next Court Date 04/06/26`
- `Court Result and Next Court Date`
- `Final Court Result - Your Representation has Ended`
- `Resultado del juicio y próxima fecha de audiencia`
- `Resultado final del caso: Su representación ha terminado`

Matching language:

- `court result`
- `court results`
- `results`
- `resultado`
- `proxima corte`
- `próxima corte`
- `next court date`

### Step 7: Post-Court Attorney Call

Deadline: next business day by 5:00 PM after court event end.

Required only when:

- A next court date exists, meaning the case appears to continue.

Evidence:

- Matter calendar entry scheduling an attorney/client call.
- Future scheduled call counts.

If no next court date exists, status is N/A.

### Step 8: Client Follow-Up Monitoring

Cadence: continuous scheduled sweep.

Evidence source:

- Email/log communications only.
- Text messages and client portal messages are excluded unless later configured.

Risk rule:

- Two or more inbound communications from the client before a firm response creates a high-risk follow-up flag.

If inbound/outbound direction cannot be proven from Clio data, mark Unknown.

## 6. Status Model

Per audit item status:

- On Time: evidence found at or before the on-time deadline.
- Late: evidence found after the deadline.
- Missing: relevant API data was accessible but no qualifying evidence was found.
- N/A: item is not required for the matter.
- Unknown: result cannot be determined because of missing permission, endpoint failure, unavailable API field, unclear direction, or unclear API support.

Dashboard operational states:

- Pending: deadline has not arrived yet.
- Needs Welcome Packet: setup checkpoint passed and welcome packet evidence is missing, but same-day corrective deadline has not passed.
- Needs Attorney Call: setup checkpoint passed and attorney/client call evidence is missing, but same-day corrective deadline has not passed.
- Needs Court Date: setup checkpoint passed and court-date evidence is missing, but same-day corrective deadline has not passed.
- Overdue: corrective deadline has passed and evidence is still missing.

Overall matter status hierarchy:

1. Review, if any item is Unknown.
2. Flag, if any required item is Missing.
3. Late, if every required item is complete but one or more is Late.
4. Pass, if all required items are On Time or N/A.

When Missing and Unknown coexist, Review wins because the audit cannot be trusted as complete.

## 7. Concrete Classification Examples

Matter created Saturday:

- Effective intake: Monday 8:00 AM.
- Setup on-time deadline: Monday 9:00 AM.
- Corrective deadline: Monday 5:00 PM.

Welcome packet examples:

- Sent Monday 8:50 AM: On Time.
- Sent Monday 10:00 AM: Late.
- Not sent by Monday 3:00 PM: operational state Needs Welcome Packet.
- Not sent by Monday 5:01 PM: Missing.

Appearance filing examples:

- Matter effective intake Monday 8:00 AM.
- Appearance filing due Wednesday 5:00 PM.
- Filed Wednesday 4:30 PM: On Time.
- Filed Thursday 9:00 AM: Late.
- No appearance communication found after successful communications query: Missing.
- Communications endpoint forbidden: Unknown.

Court results examples:

- Court ends Tuesday 2:30 PM.
- Court result email due Wednesday 5:00 PM.
- Sent Wednesday 4:55 PM: On Time.
- Sent Thursday 9:00 AM: Late.
- No court result email found: Missing.
- Direction/template cannot be determined from accessible API data: Unknown.

Post-court call examples:

- Court event has no future court date: N/A.
- Court event has a future court date and attorney/client call is scheduled by next business day 5:00 PM: On Time.
- Future court date exists, no call scheduled: Missing.

## 8. API Integration

Base URL:

```http
https://app.clio.com/api/v4
```

Headers:

```http
Authorization: Bearer <access_token>
Accept: application/json
X-API-VERSION: 4.0.13
```

Authentication:

- OAuth 2.0 Authorization Code flow.
- Store refresh tokens encrypted at rest.
- Refresh access tokens before expiry.
- Never place tokens in logs.
- Credentials should be stored in a local environment/config file, not hard-coded.

Pagination:

- Always pass `limit=200`.
- Follow `meta.paging.next`.
- Persist pagination progress for recoverable batch runs.
- On partial page failure, resume from last successful cursor.

Rate limiting:

- Token bucket capacity: 40 requests.
- Refill: 40 requests/minute.
- Each API call consumes one token.
- On HTTP 429, honor `Retry-After` and use exponential backoff with jitter.

## 9. API Query Patterns

### Matter Discovery

```http
GET /matters.json
  ?fields=id,number,display_number,status,created_at,
          responsible_attorney{id,name},
          client{id,first_name,last_name,name}
  &status=Open
  &created_since=<last_run_iso8601>
  &limit=200
```

Also query Pending matters or query without `status` and filter out Closed locally if Clio filtering does not support multiple statuses cleanly.

Stored fields:

- `matter_id`
- `matter_number`
- `matter_status`
- `matter_created_at`
- `responsible_attorney_id`
- `responsible_attorney_name`
- `client_first_name`
- `client_last_name`

### Communications

Clio's current OpenAPI schema exposes `body`, not `body_preview`, and does not expose a simple `direction` field. Direction must be inferred from `user`, `senders`, `receivers`, known firm users, and the matter client/contact.

List query:

```http
GET /communications.json
  ?fields=id,subject,type,date,created_at,received_at,
          matter{id},
          user{id,name},
          senders{id,name},
          receivers{id,name}
  &matter_id=<matter_id>
  &created_since=<iso8601>
  &limit=200
```

Transient narrowed body query, only when needed:

```http
GET /communications/{id}.json
  ?fields=id,body
```

Rules:

- Scan body in memory only.
- Do not store body.
- Prefer subject/template matching first to reduce body fetches.

### Calendar Entries

```http
GET /calendar_entries.json
  ?fields=id,summary,description,start_at,end_at,created_at,all_day,
          matter{id},
          calendar_owner{id,name},
          calendar_entry_event_type{id,name}
  &matter_id=<matter_id>
  &from=<effective_matter_intake_date>
  &to=<now_plus_180_days>
  &limit=200
```

### Notes

Use the current top-level notes endpoint with `matter_id`. Do not use `/matters/{id}/notes.json`.

```http
GET /notes.json
  ?fields=id,subject,created_at,updated_at,
          matter{id},
          author{id,name}
  &matter_id=<matter_id>
  &created_since=<iso8601>
  &limit=200
```

Note details are not stored. If note body scanning is ever enabled, details must be fetched transiently and discarded.

### Activities, Optional Metrics Only

Activities are not workflow evidence unless explicitly approved later. They may be used for dashboard metrics such as call counts.

```http
GET /activities.json
  ?fields=id,type,date,created_at,
          matter{id},
          user{id,name},
          communication{id},
          matter_note{id},
          calendar_entry{id},
          activity_description{id,name}
  &matter_id=<matter_id>
  &created_since=<iso8601>
  &limit=200
```

## 10. Data Storage

### audit_matter

- `matter_id`
- `matter_number`
- `matter_status`
- `client_first_name`
- `client_last_name`
- `responsible_attorney_id`
- `responsible_attorney_name`
- `matter_created_at`
- `effective_intake_at`
- `last_court_date`
- `next_court_date`
- `overall_status`
- `last_audited_at`

### audit_item

- `id`
- `matter_id`
- `step_code`
- `status`
- `operational_state`
- `deadline_at`
- `corrective_deadline_at`
- `evidence_at`
- `evidence_source`
- `evidence_ref_id`
- `evidence_url`
- `reason_code`
- `last_evaluated_at`

Step codes:

- `SETUP_WELCOME`
- `SETUP_ATTY_CALL`
- `SETUP_COURT_DATE`
- `CLIENT_CONTACT`
- `APPEARANCE_FILING`
- `COURT_RESULTS`
- `POST_COURT_CALL`
- `CLIENT_FOLLOWUP`

### audit_metric_snapshot

Stores historical weekly/monthly trends grouped by responsible attorney.

- `snapshot_id`
- `period_start`
- `period_end`
- `period_type`
- `responsible_attorney_id`
- `responsible_attorney_name`
- `matters_checked`
- `pass_count`
- `late_count`
- `flag_count`
- `review_count`
- `missing_item_count`
- `late_item_count`
- `unknown_item_count`
- `welcome_packets_sent`
- `appearance_filings_sent`
- `court_result_emails_sent`
- `attorney_calls_scheduled`
- `logged_call_count`, optional if Activities are enabled
- `created_at`

### audit_metric_detail

Stores drilldown from attorney summary to matter-level reasons and evidence references.

- `snapshot_id`
- `matter_id`
- `matter_number`
- `responsible_attorney_id`
- `overall_status`
- `late_items`
- `missing_items`
- `unknown_items`
- `evidence_refs`

## 11. Dashboard Requirements

Primary dashboard grouping:

- Responsible attorney from the Matter's `responsible_attorney` field.

Primary controls:

- Manual refresh.
- Date range selector: daily, weekly, monthly, custom.
- Responsible attorney filter.
- Court date range filter.
- Overall status filter.
- Task status filters.
- Missing item type filter.
- Late item type filter.
- Unknown item type filter.
- Optional CSV export.

Primary table columns:

- Client Name
- Matter Number
- Responsible Attorney
- Overall Status
- Setup Status
- Client Contact Status
- Appearance Filing Status
- Court Results Status
- Post-Court Attorney Call Status
- Client Follow-Up Status
- Matter Created Date
- Last Court Date
- Late Items
- Missing Items
- Unknown Items
- Evidence Links

Operational dashboard labels:

- Pending
- Needs Welcome Packet
- Needs Attorney Call
- Needs Court Date
- Overdue
- On Time
- Late
- Missing
- Unknown
- N/A

Historical dashboard views:

- Attorney weekly/monthly trend summary.
- Attorney-to-matter drilldown for coaching.
- Matter-level evidence links back to Clio.

## 12. Evidence Links

Store Clio object ID and object type for every evidence item.

Preferred display:

- A direct Clio URL if URL format is stable.
- If a stable URL cannot be guaranteed, show the object type and ID with enough context for lookup.

Examples:

- Communication evidence: `Communication #12345`
- Calendar evidence: `Calendar Entry #67890`
- Note evidence: `Note #44444`

## 13. Error Handling

| Condition | Action |
|---|---|
| 401 | Refresh token, retry once |
| 403 | Mark dependent item Unknown and record permission gap |
| 404 | Treat as Missing if endpoint/object was expected and accessible |
| 429 | Honor Retry-After, exponential backoff with jitter |
| 5xx | Retry up to 3 times, then Unknown |
| Timeout | Retry 2 times, then Unknown |
| Unsupported field | Remove field if nonessential; otherwise Unknown and alert |
| Direction unclear | Unknown |
| Endpoint unavailable | Unknown |

## 14. Idempotency

- Upsert audit items by `(matter_id, step_code)`.
- Re-running the same period should produce the same result unless Clio data changed.
- Evidence references use Clio object IDs only.
- Historical metric snapshots should be versioned by period and run timestamp.

## 15. Known Template/Pattern Inputs Needed

Required from firm before production tuning:

- Welcome packet English template subject/body markers.
- Welcome packet Spanish template subject/body markers.
- Court result English and Spanish template subject/body markers.
- Any alternate appearance filing template subjects.
- Any additional attorney/client call naming formats.

Known examples already captured:

- `LQ-Phone Call-Stephen Williams`
- `AP-PhoneCall-Ali Kasim`
- `AP-Spanish Jail zoom`
- `Welcome Letter`
- `Carta de bienvenida`
- `Court Result 04/06/2026 || Next Court Date 05/04/2026`
- `Court Result 02/17/26 | Next Court Date 04/06/26`
- `Court Result and Next Court Date`
- `Final Court Result - Your Representation has Ended`
- `Resultado del juicio y próxima fecha de audiencia`
- `Resultado final del caso: Su representación ha terminado`
- `Court Appearance Has Been Filed Notification: ...`
- `Notificación de Presentación en la Corte`
- `You Have Court Monday In-Person`
- `You Have Court Tuesday In-Person`
- `In-Person Court Reminder`
- `Recordatorio de audiencia presencial`
- `Zoom Court Reminder & Instructions`
- `Recordatorio e instrucciones para la audiencia por Zoom manana DD/MM/YR`

## 16. Immediate Implementation Checklist

1. Configure local OAuth credentials using the Clio Developer Application.
2. Implement read-only Clio API client with pagination and rate limiting.
3. Implement business-day deadline calculator.
4. Implement matter discovery excluding Closed matters.
5. Implement evidence collectors for communications, calendar entries, notes, and optional activities.
6. Implement eight-step evaluator.
7. Implement dashboard data tables and filters.
8. Implement historical attorney metric snapshots.
9. Add CSV export.
10. Add permission/API gap report.
