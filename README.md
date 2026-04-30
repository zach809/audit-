# Clio Workflow Compliance Auditor

Read-only Clio Manage workflow audit dashboard for Vercel + Neon Postgres.

## What It Does

- Pulls Clio matters, communications, calendar entries, notes, and optional activity metrics.
- Excludes Closed matters.
- Groups the dashboard by the matter's responsible attorney.
- Applies Monday-Friday, 8 AM-5 PM America/Chicago deadline rules.
- Tracks setup, client contact, appearance filing, court results, post-court calls, and client follow-up risks.
- Stores minimal local audit data and evidence references only.
- Provides manual refresh, Vercel Cron refresh, filters, historical metrics, and CSV export.

No AI is used.

## Deploy On Vercel

1. Push this folder to GitHub.
2. In Vercel, import the GitHub repo.
3. Add a Neon Postgres database from the Vercel Marketplace. Neon Free is enough to start.
4. Add the environment variables from `.env.example`.
5. In Clio Developer Portal, set the redirect URI to:

   `https://YOUR-APP.vercel.app/api/auth/clio/callback`

6. Deploy.
7. Open the app, log in with `DASHBOARD_PASSWORD`, and click **Connect Clio**.
8. After Clio OAuth succeeds, click **Run Audit Now**.

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
- `SESSION_SECRET`: long random string for login cookies.
- `TOKEN_ENCRYPTION_KEY`: 32-byte base64 key preferred. You can generate one with `openssl rand -base64 32`.
- `CRON_SECRET`: random string used to secure cron/manual worker access.
- `AUDIT_BATCH_SIZE`: matters per audit run. Start with `10`.
- `CLIO_INITIAL_LOOKBACK_DAYS`: first-run discovery window. Start with `90`.
- `CLIO_RATE_LIMIT_PER_MINUTE`: default `40`.

## Notes

The worker is intentionally chunked. Each cron/manual run audits a limited number of matters so Vercel functions stay reliable and Clio rate limits are respected.

