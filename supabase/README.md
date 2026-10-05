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

## Activate image generation

Image generation is implemented with the OpenAI Images API and `gpt-image-1`.
Deploy the image migration and both functions first:

```bash
supabase db push
supabase functions deploy submit-ai-job
supabase functions deploy process-ai-job
```

Set these **Supabase Edge Function secrets** (never Vite/browser variables):

```bash
supabase secrets set OPENAI_API_KEY=... CEZIK_WORKER_SECRET=...
```

Then, once the OpenAI project has image-model access, activate the catalog entry from the Supabase SQL Editor or an admin-only workflow:

```sql
update public.ai_activities
set provider = 'openai:gpt-image-1', enabled = true
where slug = 'image-generation';
```

The price is database-controlled (`credit_cost`, seeded as 10), not client-controlled. Change it in `ai_activities` if required. A successful run atomically reserves/deducts the configured credits, writes the image to the private `cezik-creations` bucket as `<user-id>/<job-id>/image.png`, records the generalized `ai_jobs` and `creations` history, and returns a user-scoped signed URL. Provider or storage failures call `fail_ai_job`, which refunds the charge.

## Payments

When a payment provider is chosen, create a pending `payments` row first. Only its verified webhook may call `confirm_credit_payment`; that procedure marks the row successful and credits the package amount atomically. Never grant browser write access to `payments`, `credit_wallets`, or `credit_transactions`.

## PayPal Sandbox credit checkout

The PayPal implementation is deliberately sandbox-only. Apply the additive
`202610030001_paypal_credit_purchases.sql` migration and deploy these Edge
Functions together: `paypal-sdk-config`, `create-paypal-credit-order`,
`capture-paypal-credit-order`, and `billing-webhook`.

Set the following **Edge Function secrets**, never Vite/browser variables:

```text
CEZIK_PAYPAL_ENV=sandbox
PAYPAL_API_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_WEBHOOK_ID=...
```

Register the deployed `billing-webhook` HTTPS endpoint in the PayPal Sandbox
Developer Dashboard for `PAYMENT.CAPTURE.COMPLETED`,
`PAYMENT.CAPTURE.DENIED`, and `CHECKOUT.PAYMENT-APPROVAL.REVERSED`. CEZIK posts
each notification back to PayPal for signature verification and ignores
duplicate event IDs. Only a verified completed capture whose order, capture ID,
amount, and currency match a local purchase can call the locked wallet grant
function. The PayPal client secret never reaches the browser; the authenticated
SDK-config endpoint returns only the public client ID needed to load the SDK.

## Premium subscriptions and watermark policy

The hybrid entitlement migrations add three distinct credit sources:

- **Free credits:** promotional credits that create watermark-required assets.
- **Purchased credits:** one-time packs that create clean generated assets and
  do not expire under this policy.
- **Premium allowance:** 1,000 clean-output credits granted for each verified
  active PayPal billing period. These expire at the end of the allowance period.

`start_ai_job` allocates credit grants server-side and stores the allocation and
watermark decision on the immutable job record. A free image generation is
written to Storage only as a CEZIK-watermarked SVG delivery asset; its clean
provider image is never uploaded by CEZIK. Browser-only native image tools also
watermark free exports locally, while Premium exports remain clean.

Apply both new migrations before deploying the code:

```bash
supabase db push
supabase functions deploy create-paypal-premium-subscription
supabase functions deploy billing-webhook
supabase functions deploy process-ai-job
```

Create the recurring Premium product and monthly plan in the **PayPal Sandbox**
dashboard at **USD 9.99/month** for the launch offer: it includes 1,000 CEZIK
credits. The active `gpt-image-1` adapter explicitly uses OpenAI's low-quality
tier so the allowance is cost-bounded. Run `202610050003_launch_pricing.sql`
to update the one-time packs before enabling checkout. Do not put prices or
PayPal plan IDs in the browser. Set these additional Edge Function secrets:

```text
PAYPAL_PREMIUM_PLAN_ID=the_sandbox_monthly_plan_id
CEZIK_APP_URL=https://your-public-cezik-domain.example
```

Add these webhook event types to the existing Sandbox webhook registration in
addition to the credit-purchase events:

```text
BILLING.SUBSCRIPTION.ACTIVATED
BILLING.SUBSCRIPTION.CANCELLED
BILLING.SUBSCRIPTION.SUSPENDED
BILLING.SUBSCRIPTION.EXPIRED
PAYMENT.SALE.COMPLETED
```

The webhook still verifies every notification with PayPal before changing any
subscription, credit, or entitlement state. The application remains
**Sandbox-only** until the PayPal live-environment rollout is deliberately
implemented and reviewed; do not point live credentials at this code yet.
