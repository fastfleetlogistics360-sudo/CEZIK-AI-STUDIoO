# CEZIK API V1 — internal service architecture

CEZIK's first-party application API is its authenticated Supabase Edge Function
layer plus its Postgres procedures, RLS rules, Storage policies, and server-side
service adapters. Supabase is infrastructure, not CEZIK's product boundary.

## Request classes

| Caller | CEZIK interface | Exposure |
| --- | --- | --- |
| Browser | `submit-ai-job` now; versioned browser endpoints later | Authenticated user JWT only |
| Worker | `process-ai-job` | Internal secret only |
| Payment provider | provider-specific webhook function | Public URL, signed and verified |
| Future developers | `api.cezikaistudio.com/v1/...` | Not implemented; API keys and quotas required |

The browser never calls an AI or payment provider directly. It only asks CEZIK
to perform an application action and receives a CEZIK-shaped response.

## Proposed V1 surface

The existing two-function setup remains the safe launch path. As features are
added, route names can become the following Edge Functions without changing the
database ownership model:

```text
POST /v1/images/generate          browser-authenticated job submission
GET  /v1/generations              user-scoped creation history
GET  /v1/generations/:id          user-scoped creation detail
GET  /v1/credits                  wallet balance
GET  /v1/credits/transactions     user-scoped ledger
POST /v1/payments/initialize      starts a CEZIK payment record
GET  /v1/payments/:reference      reads the caller's payment state
POST /v1/payments/webhooks/:rail  verifies provider event then credits wallet
POST /v1/files/upload             returns a constrained upload workflow
GET  /v1/files/:id                returns a user-authorized signed asset URL
```

Names are CEZIK application contracts. Provider names, payloads, and secrets
stay in server-only adapters.

## Image service

```text
Dashboard → CEZIK job API → CEZIK image provider contract → provider adapter
          → credit/job ledger → private CEZIK Storage → creation history
```

`ImageGenerationProvider` standardizes an image request and returned bytes,
content type, model, provider, and normalized metadata. `OpenAIImageProvider`
is the first adapter. A self-hosted or commercial fallback implements the same
contract; no dashboard, wallet, job, or Storage rewrite is required.

## Payments

```text
Customer → CEZIK Payment Service → payment rail
                 ↑                      ↓
            CEZIK payment record ← signed webhook + server verification
                 ↓
        atomic CEZIK ledger and wallet credit
```

CEZIK owns package selection, internal payment ID, user authorization, status,
credits expected/granted, and ledger entry. The rail owns regulated payment
collection and sends a provider reference only for reconciliation. Browser
redirects and callbacks are never payment proof.

The existing `payments` table and `confirm_credit_payment` RPC are a secure
foundation. Before multi-currency checkout, add a `credit_package_prices`
table keyed by `(package_id, currency, payment_provider)` so the browser never
calculates exchange rates or payment amounts.

## Build phases

1. **Launch:** keep image flow as deployed; complete one provider-funded image.
2. **API cleanup:** split browser routes, worker orchestration, provider
   adapters, validation, and audited service functions.
3. **Payments:** add one rail behind `PaymentProvider`, with test mode,
   server verification, signed webhooks, and idempotent credit grant.
4. **CEZIK-native tools:** image resizing/conversion/compression, file
   management, ZIP/QR utilities, and metadata extraction.
5. **Self-hosted AI:** add a separately operated GPU worker only after volume
   justifies hosting cost and operational work.
6. **Developer API:** introduce API keys, scopes, quotas, metering, and docs;
   do not expose internal browser endpoints as-is.
