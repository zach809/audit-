# Clio Workflow Auditor

Read-only Clio Manage workflow audit dashboard for Vercel + Neon Postgres. CWCA is for internal compliance checking and workflow coaching only.

## What It Does

- Pulls Clio matters, communications, and calendar entries through read-only API calls.
- Excludes Closed matters from active audit views.
- Provides a separate Post-Closure tab for closed-matter client follow-up reminders.
- Groups the dashboard by the matter's responsible attorney.
- Applies Monday-Friday, 8 AM-5 PM America/Chicago deadline rules.
- Tracks setup, client contact, appearance filing, court results, post-court calls, and client follow-up risks.
- Stores minimal local audit data and evidence references only.
- Provides manual refresh, Vercel Cron refresh, filters, historical metrics, and CSV export.
- Provides a Case Manager action CSV named `cwca-case-manager-action-report.csv`.
- Provides a Notepad-friendly Case Manager to-do list named `cwca-case-manager-to-do-list.txt`.
- Optionally drafts plain-English review wording and single-issue AI help when `OPENAI_API_KEY` is configured.

## Post-Closure Follow-Up

The Post-Closure tab is an internal reminder queue for closed matters. It reads closed matters from Clio and creates follow-up touchpoints at:

- 1 month after closure.
- 6 months after closure.
- 12 months after closure.

Each reminder is an opportunity for staff to call the client, confirm satisfaction, identify unresolved concerns, and note any billing, document, new legal issue, or supervision concern. The app does not send client messages and does not update Clio.

Stored locally for this feature:

- Matter ID and matter number.
- Client name.
- Responsible attorney.
- Matter close date.
- Follow-up due date and stage.
- Staff-entered follow-up status, contact method, issue type, note, reviewer, and completion date.

## Optional Manual AI Help

CWCA can use AI only when an auditor clicks a button. It does not run during audit batches, page loads, or bulk matter review.

The matter card can show a small **Ask CWCA AI** chat box on a single flagged issue. The Reports review builder can also use **Draft with AI** to draft plain-English Results Details, Report Summary, and a Teams message for the selected flagged matter. These are helper features only:

- It does not write to Clio.
- It does not save the review automatically.
- It does not decide whether an item is compliant.
- It uses only selected audit metadata and auditor-entered notes.
- It should be reviewed by a human before saving or sending.
- AI does not bulk-analyze every matter automatically.
- AI does not repair logic automatically.

To use the helper, set `OPENAI_API_KEY` and optionally `AI_MODEL`. The default model is `gpt-4o-mini` because it keeps these short manual helper prompts low-cost.

If the OpenAI key is not configured, CWCA still works normally and shows a clear AI-not-configured message.

## Current Workflow Rules

CWCA checks open matters using Illinois business time: Monday-Friday, 8:00 AM-5:00 PM America/Chicago. After-hours and weekend items roll into business-time handling so the audit is less strict than a plain clock timer.

- Welcome Letter: welcome letter / bienvenida communication sent within 2 business hours of a new matter being created.
- Attorney Call: attorney/client call calendar event scheduled within 2 business hours of a new matter being created.
- Court Date Added: court, hearing, status, or continuance calendar event added within 2 business hours when the court date is known.
- Client Contact: outgoing client contact completed by the next business day at 5:00 PM.
- Appearance Filed: appearance filing notification or template evidence checked after 48 hours from matter creation, skipping non-business days.
- Court Results: court result communication sent by the next business day at 5:00 PM after court.
- Post-Court Call: post-court attorney/client call scheduled by the next business day at 5:00 PM after court when the case continues.
- Client Follow-Up: flags when 2 or more inbound client messages appear before a firm response.

Template proof is checked from matter-linked Clio Communications. CWCA looks at the email subject line for templates like Welcome Letter, Carta de bienvenida, Welcome to Hirsch Law Group, Court Appearance Has Been Filed Notification, and Court Result / Resultado messages.

## Compliance And Data Handling

CWCA must stay read-only against Clio. Do not add create, update, delete, webhook, billing, payment, or document-content behavior.

Stored locally:

- Matter IDs and matter numbers.
- Client names.
- Responsible attorney.
- Workflow timestamps and statuses.
- Evidence IDs and proof links.
- Audit-run history.
- Post-closure follow-up reminder metadata and staff-entered follow-up notes.
- Encrypted OAuth tokens.

Not stored locally:

- Communication bodies.
- Note text.
- Document contents.
- Billing data.
- Payment data.

For AI help, CWCA sends only the selected matter/audit-item metadata and auditor-entered notes needed for that one request. It does not send stored communication bodies, note text, document contents, billing data, or payment data.

Retention defaults:

- `AUDIT_RUN_RETENTION_DAYS`: `90`.
- `AUDIT_METRIC_RETENTION_DAYS`: `365`.
- `CLOSED_MATTER_RETENTION_DAYS`: `30`.

Expired stored access tokens are cleared automatically. Refresh tokens remain encrypted so the read-only connection can continue working.

## Illinois-Focused Operational Guardrails

- Use this internally for workflow coaching and compliance review only.
- Limit dashboard access to approved staff.
- Require MFA for Clio, Vercel, database, and repository access.
- Review vendors, hosting, and access logs on a regular schedule.
- Rotate secrets on a schedule and after staff changes.
- Treat dashboard findings as operational signals, not legal advice.

## Deploy On Vercel

1. Push this folder to GitHub.
2. In Vercel, import the GitHub repo.
3. Add a Neon Postgres database from the Vercel Marketplace. Neon Free is enough to start.
4. Add the environment variables from `.env.example`.
5. In Clio Developer Portal, set the redirect URI to:

   `https://YOUR-APP.vercel.app/api/auth/clio/callback`

6. Deploy.
7. Open the app, log in with `DASHBOARD_PASSWORD`, and click **Connect Clio**.
8. After Clio OAuth succeeds, click **Run Audit Batch**.

## Required Clio Permissions

Use read-only permissions only:

- Matters
- Contacts
- Users
- Calendars
- Communications
- Notes
- Activities, optional for call metrics

Do not enable write permissions.

## Environment Variables

- `DATABASE_URL`: Neon Postgres connection string.
- `CLIO_CLIENT_ID`: Clio app key.
- `CLIO_CLIENT_SECRET`: Clio app secret.
- `CLIO_REDIRECT_URI`: OAuth callback URL.
- `CLIO_BASE_URL`: `https://app.clio.com` for US.
- `DASHBOARD_PASSWORD`: password for the dashboard.
- `CASE_MANAGER_USERS`: comma-separated case-manager logins for `/case-manager`. Current default CM setup uses the listed Hirsch emails with password `Hirsch12345678`.
- `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`: optional live Standards Google Sheet sync. Share the target Sheet with the service-account email as Editor, then use the Standards tab button or the weekday cron sync.

## Standards Google Sheet

The Standards tab can now update a live Google Sheet. CWCA writes one tab per case manager for New Matter Onboarding and uses this exact order:

`Case Manager`, `Date`, `ATC / new matters #`, `Initial Meeting set - Phone call`, `Welcome letters sent`, `Court date event made`, `Worflow completion %`.

This is one-way from CWCA to Google Sheets. It does not write to Clio.

The CWCA Standards page also separates Ongoing Cases from onboarding so case managers can see client contact, weekly check-ins, court results, and appearance filing email follow-up without mixing those items into the new-matter score.
- `SESSION_SECRET`: long random string for login cookies.
- `TOKEN_ENCRYPTION_KEY`: 32-byte base64 key preferred. You can generate one with `openssl rand -base64 32`.
- `CRON_SECRET`: random string used to secure cron/manual worker access.
- `AUDIT_BATCH_SIZE`: matters per audit run. Start with `10`.
- `AUDIT_COOLDOWN_SECONDS`: pause between audit batches. Default `30`.
- `CLIO_INITIAL_LOOKBACK_DAYS`: first-run discovery window. Start with `90`.
- `CLIO_RATE_LIMIT_PER_MINUTE`: default `40`.
- `AUDIT_RUN_RETENTION_DAYS`: audit-run history retention. Default `90`.
- `AUDIT_METRIC_RETENTION_DAYS`: monthly snapshot retention. Default `365`.
- `CLOSED_MATTER_RETENTION_DAYS`: closed-matter audit-row retention. Default `30`.
- `OPENAI_API_KEY`: optional OpenAI API key for manual AI help.
- `AI_MODEL`: optional OpenAI model name. Default `gpt-4o-mini`.

## Notes

The worker is intentionally chunked. Each cron/manual run audits a limited number of matters so Vercel functions stay reliable and Clio rate limits are respected.
