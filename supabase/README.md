# CEZIK Supabase foundation

## What this adds

- A one-row-per-user credit wallet and append-only transaction ledger.
- Database-configured activity pricing and credit packages.
- Atomic job creation + credit deduction, with a unique idempotency key per request.
- Server-only completion/failure/refund procedures.
- Per-user RLS for wallets, jobs, payments, creations, and private generated media.
- A private `cezik-creations` bucket. Store files under `<user-id>/<asset-id>/...`.

## Deploy the database

Install and authenticate the Supabase CLI, link this project, then run:

```bash
supabase db push
```

Alternatively, paste the contents of `migrations/202609180001_credit_job_foundation.sql` into the Supabase SQL Editor and run it once.

## Deploy functions

```bash
supabase functions deploy submit-ai-job
supabase functions deploy process-ai-job
```

Set `CEZIK_WORKER_SECRET` only in Supabase Edge Function secrets. `process-ai-job` is for a trusted queue/cron worker or verified provider webhook; it must never be called by the browser.

## Provider activation

The seeded video activity is deliberately disabled. Select a video provider, set its key only as an Edge Function secret, add its adapter in `functions/process-ai-job`, then set the activity's `provider` and `enabled` fields through an admin-only server workflow. This prevents CEZIK from taking credits for a fake result.

## Payments

When a payment provider is chosen, create a pending `payments` row first. Only its verified webhook may call `confirm_credit_payment`; that procedure marks the row successful and credits the package amount atomically. Never grant browser write access to `payments`, `credit_wallets`, or `credit_transactions`.
