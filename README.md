# Clio Workflow Compliance Auditor - Vercel Starter

This is a read-only Next.js/Vercel starter for the CWCA workflow auditor.

## What it includes

- Vercel Cron endpoint at `/api/audit/run`
- Manual refresh endpoint at `/api/audit/manual`
- Clio OAuth callback stub
- Read-only Clio API client with explicit fields, cursor pagination, and rate limiting
- Business-day deadline calculator for America/Chicago
- Audit evaluator skeleton for the eight CWCA workflow steps
- Postgres schema and initialization script
- Dashboard page with status cards and matter-level table

## Deployment

1. Create a Vercel project from this folder.
2. Provision Postgres and set `POSTGRES_URL`.
3. Set all environment variables from `.env.example`.
4. Run `npm install`.
5. Run `npm run db:init` locally or in a secure setup job.
6. Deploy production with `vercel deploy --prod`.

Cron jobs are defined in `vercel.json` and run every 15 minutes in production.

## Security notes

- The app is designed for read-only Clio access.
- Do not request write scopes in the Clio developer app.
- Do not log Clio access tokens, refresh tokens, communication bodies, note details, billing data, or unrelated PII.
- Communication bodies, if fetched later for template matching, should be scanned transiently and discarded.

## Next implementation steps

- Wire Clio OAuth token exchange and encrypted token persistence in `app/api/auth/clio/callback/route.ts`.
- Finish template matching in `audit/evaluator.ts` using firm-specific English/Spanish markers.
- Add user auth for dashboard access before production use.
- Add CSV export endpoint.
