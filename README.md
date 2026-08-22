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

## Standards Score

The case-manager Standards score uses four KPIs: Welcome Letter, Initial Attorney-Client Call, Court Date Added, and Weekly Client Check-In. Each score begins at 100 points.

- Missing or incorrect proof: deduct 2 points per item.
- Completed after the deadline: deduct 0.5 points per item.
- Completed on time: no deduction.
- Approved Exception: no deduction.
- Not Due Yet, Pending, N/A, and Not Checked: excluded from the score.

The three new-matter setup KPIs use the operational 2-business-hour grace period. The score cannot fall below 0.

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
- `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_EXCEL_USER_ID`, `MICROSOFT_EXCEL_TEMPLATE_PATH`, and `MICROSOFT_EXCEL_WORKBOOK_PATH`: optional live Standards Excel Online sync. Prefer `MICROSOFT_EXCEL_REFRESH_TOKEN` (delegated `Files.ReadWrite` + `offline_access`; public client, no `client_secret`). If that env var is unset, CWCA uses application client-credentials and `MICROSOFT_CLIENT_SECRET`.

## Standards Google Sheet

The Standards tab can update a live Google Sheet. CWCA writes one tab per case manager for the weekly standards report and uses this exact order:

`Case Manager`, `Date`, `ATC / new matters #`, `Initial Meeting set - Phone call`, `Welcome letters sent`, `Court date event made`, `Weekly check-ins completed`, `Workflow completion %`.

This is one-way from CWCA to Google Sheets. It does not write to Clio.

To connect it:

1. Create a Google Cloud service account with Google Sheets API access.
2. Copy the service account email into `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
3. Create a JSON key for that service account, then copy the private key into `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.
4. Create or open the Google Sheet you want CWCA to update.
5. Share that Sheet with the service account email as Editor.
6. Copy the Sheet ID from the Google Sheet URL into `GOOGLE_SHEETS_SPREADSHEET_ID`.
7. Redeploy Vercel, then use Standards -> Sync Google Sheet.

The CWCA Standards page also separates Ongoing Cases from the new-matter setup score so case managers can see client contact, weekly check-ins, court results, and appearance filing email follow-up without mixing those items into the weekly standards score.

## Standards Excel Online Workbook

The Standards tab can also update a live Microsoft Excel workbook stored in OneDrive or SharePoint. CWCA writes exactly one worksheet, `Data`, and nothing else. Every report tab in the workbook is a formula over `Data`, written by hand in the template; CWCA never writes a formula and never writes a report tab, so the workbook's design survives every sync.

`Data` holds one row per case manager per calendar day of the month, in this order:

`Case Manager`, `Date`, `ATC / new matters #`, `Initial Meeting set - Phone call`, `Welcome letters sent`, `Court date event made`, `Weekly check-ins completed`, `Workflow completion %`.

Column `J` of row 1 carries the last-updated stamp. A day with no activity is a row of zeros, not a missing row, so a filter can tell "nothing happened" apart from "no data". Days later in the month than today are left blank. The block of rows a case manager occupies does not move for the rest of the month, so formulas can address it.

Each Chicago month gets its own workbook, created by copying `MICROSOFT_EXCEL_TEMPLATE_PATH`. `MICROSOFT_EXCEL_WORKBOOK_PATH` must contain the literal `{month}` token, which is replaced with the month key: `CWCA/Standards {month}.xlsx` becomes `CWCA/Standards 2026-08.xlsx`. Without the token every month would resolve to the same workbook, so CWCA refuses to run.

This is one-way from CWCA to Excel. It does not write to Clio.

To connect it:

1. Create a Microsoft Entra / Azure App Registration. For delegated sync, register it as a public client (no client secret on the refresh grant).
2. Copy the Directory tenant ID into `MICROSOFT_TENANT_ID`.
3. Copy the Application client ID into `MICROSOFT_CLIENT_ID`.
4. Preferred: obtain a delegated refresh token for a named user who can edit the workbook, with Graph delegated `Files.ReadWrite` and `offline_access`, and put it in `MICROSOFT_EXCEL_REFRESH_TOKEN`. Do not send a client secret with that grant. Copying the template needs delegated `Files.ReadWrite`; the application path would need `Files.ReadWrite.All`, which this firm's IT has refused (step 5).
5. Application fallback only: if `MICROSOFT_EXCEL_REFRESH_TOKEN` is unset, create a client secret (`MICROSOFT_CLIENT_SECRET`) and use Graph application permission. That path is unchanged; this firm’s IT has already refused `Files.ReadWrite.All`.
6. Build the template workbook in OneDrive or SharePoint, for example `CWCA/Standards Template.xlsx`. It must already contain a worksheet named `Data`; CWCA writes into that worksheet and never creates it. Put the report tabs and their formulas in the template too, since every month's workbook is a copy of it.
7. Put the workbook owner email into `MICROSOFT_EXCEL_USER_ID`, for example `zach@hirschlawgroup.com`. Delegated writes are attributed to this named account.
8. Set `MICROSOFT_EXCEL_TEMPLATE_PATH="CWCA/Standards Template.xlsx"` and `MICROSOFT_EXCEL_WORKBOOK_PATH="CWCA/Standards {month}.xlsx"`, both relative to that user's OneDrive root. They must name files in the same folder: Graph copies the template into the template's own folder, so the month workbook cannot land anywhere else.
9. Optional but recommended: paste the workbook's browser URL into `MICROSOFT_EXCEL_WORKBOOK_WEB_URL` so CWCA can show an Open Excel Workbook button.
10. Redeploy Vercel, then use Standards -> Sync Excel Workbook.

If the refresh token is revoked or expired, sync fails with a named `invalid_grant` error. A person must re-issue the token; retrying will not fix it.

If the template is missing, sync fails with a named error and writes nothing. A month workbook that already exists is never replaced or renamed and never copied a second time: the same month always resolves to the same workbook.

### Testing the Excel sync from a preview deployment

Preview deployments block every write. Their database is a Neon branch and, with the variables below, their Excel workbook is a separate file, so the reason is the rule rather than a risk to production data: the Google Sheet and the Clio OAuth connection are the two systems a preview shares with production outright. A preview still reads Clio with production's credential, but it can no longer refresh it. See "Clio on a preview deployment" below. The Excel sync is the one route that can be opened, and only against a separate test workbook.

Set both of these on the Vercel **Preview** environment, never on Production:

1. `CWCA_ALLOW_PREVIEW_EXCEL_SYNC="1"` lets `/api/standards/excel-sync` run. Every other write route keeps answering 403: `/api/audit/run`, `/api/audit/recheck-items`, `/api/case-manager/complete`, `/api/metrics/exclusion`, `/api/standards/google-sync`, `/api/reviews`, `/api/post-closure/sync`, `/api/post-closure/followups` and `/api/auth/clio/callback`.
2. `MICROSOFT_EXCEL_WORKBOOK_PATH_PREVIEW` names the test workbook and carries the same `{month}` token, for example `CWCA/cwca-standards-test {month}.xlsx`. `MICROSOFT_EXCEL_WORKBOOK_WEB_URL_PREVIEW` feeds the Open Excel Workbook button.

A preview deployment inherits the production variables it does not override, so on preview the sync ignores `MICROSOFT_EXCEL_WORKBOOK_PATH` and `MICROSOFT_EXCEL_WORKBOOK_WEB_URL` entirely. With no `_PREVIEW` path set, the sync refuses with a named error rather than falling back to the production workbook. `MICROSOFT_EXCEL_USER_ID` is still inherited, so the test workbook must live in that user's drive.

`MICROSOFT_EXCEL_TEMPLATE_PATH` is **not** scoped, because it is a read-only source rather than a destination: both scopes copy the same template. Graph copies a template into the template's own folder, so the preview path has to name a different file inside that folder.

The sync response names the month workbook it wrote to, as `<path> (preview)` or `<path> (production)`.

Two things to expect on preview while only part of this is configured. With no `_PREVIEW` location set, the Sync Excel Workbook button is disabled. With a `_PREVIEW` location set but no `CWCA_ALLOW_PREVIEW_EXCEL_SYNC`, the button is enabled and the click comes back 403.

`CWCA_ALLOW_PREVIEW_EXCEL_SYNC` gates the `/api/standards/excel-sync` route. It does not gate the publisher that `/api/reviews` triggers after a review is saved, but `/api/reviews` now answers 403 outside production, so that publisher no longer runs there. It follows the same workbook rule in any case, writing to the `_PREVIEW` workbook or, with none set, skipping.

The Excel sync never touches Clio. It reads `standardsReportRows` from the database and writes to Microsoft Graph, so the refusal below does not affect it.

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

### Clio on a preview deployment

A preview deployment's database is a Neon branch, and that branch carries a copy of production's Clio refresh token. Refreshing from preview would ask Clio to reissue production's credential and would save the replacement in the branch, where production cannot read it. So outside production the refresh is refused before the network call is made:

> Clio refresh blocked: only production refreshes Clio. This deployment reads a database branch that carries a copy of production's Clio refresh token, so refreshing here would ask Clio to reissue production's credential and would save the replacement where production cannot read it. Reconnect Clio from production, or give this deployment its own Clio application.

What this means day to day. A preview keeps reading Clio normally while the access token in its branch is still valid, which is up to 30 days from the last production refresh. Once that token is inside its last 10 minutes, anything that needs Clio fails with the message above instead of a generic error: the evidence pages, `/api/debug/recent-matters`, and any audit run. Everything that does not need Clio, including the Excel sync, is unaffected.

The refusal is on the network call, not on saving the token. Letting the call through and blocking the save would be worse than doing nothing: it would exercise production's grant and then discard whatever came back.

`CWCA_ALLOW_WRITES="1"` with `VERCEL_ENV` unset still refreshes, so a local checkout that has deliberately opted into writes behaves as before. No setting opens refresh on preview.

Clio Manage does not rotate refresh tokens, which limits how bad a preview refresh could have been. Clio's FAQ states it plainly: "Clio Manage: Refresh tokens do not expire and can be reused across multiple refresh calls. They remain valid until explicitly revoked", against "Clio Platform: Refresh tokens do not have a time-based expiry, but they are rotated on each use" (https://docs.developers.clio.com/faq/). The Clio Manage refresh response documents no `refresh_token` field at all (https://docs.developers.clio.com/api-docs/clio-manage/authorization/), which is why `clio.ts` falls back to the stored one. Two things keep the guard worth having anyway. Clio does not document whether a refresh invalidates the access token it replaces, and `CLIO_BASE_URL` is a variable, so a future move to Clio Platform would make rotation real.

Giving preview its own Clio connection is the only way to make it fully functional without borrowing production's. It needs a second application registered in the firm's Clio developer account, with the preview callback URL as its redirect URI, and `CLIO_CLIENT_ID`, `CLIO_CLIENT_SECRET` and `CLIO_REDIRECT_URI` set on the Vercel Preview environment only. Someone at the firm then authorizes that application once from a preview deployment. That is a decision for the firm, because it is a second application with its own access to live matter data.

## Notes

The worker is intentionally chunked. Each cron/manual run audits a limited number of matters so Vercel functions stay reliable and Clio rate limits are respected.
