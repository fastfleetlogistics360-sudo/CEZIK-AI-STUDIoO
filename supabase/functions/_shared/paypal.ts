export type PayPalEnvironment = 'sandbox'

type PayPalError = {
  name?: string
  message?: string
  details?: Array<{ issue?: string; description?: string }>
  debug_id?: string
}

export type PayPalOrder = {
  id: string
  status: string
  purchase_units?: Array<{
    amount?: { currency_code?: string; value?: string }
    payments?: { captures?: Array<{ id?: string; status?: string; amount?: { currency_code?: string; value?: string } }> }
  }>
}

export type PayPalSubscription = {
  id: string
  status: string
  custom_id?: string
  start_time?: string
  billing_info?: { next_billing_time?: string; last_payment?: { time?: string } }
  links?: Array<{ href?: string; rel?: string }>
}

export class PayPalClientError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = false) {
    super(message)
  }
}

const SANDBOX_BASE_URL = 'https://api-m.sandbox.paypal.com'

function readConfig() {
  const environment = Deno.env.get('CEZIK_PAYPAL_ENV')
  const baseUrl = Deno.env.get('PAYPAL_API_BASE_URL')
  const clientId = Deno.env.get('PAYPAL_CLIENT_ID')
  const clientSecret = Deno.env.get('PAYPAL_CLIENT_SECRET')
  if (environment !== 'sandbox') throw new PayPalClientError('PAYPAL_ENVIRONMENT_INVALID', 'PayPal Sandbox is required for this deployment.')
  if (baseUrl !== SANDBOX_BASE_URL) throw new PayPalClientError('PAYPAL_BASE_URL_INVALID', 'PayPal Sandbox base URL is required for this deployment.')
  if (!clientId || !clientSecret) throw new PayPalClientError('PAYPAL_CONFIGURATION_MISSING', 'PayPal Sandbox configuration is incomplete.')
  return { environment: 'sandbox' as PayPalEnvironment, baseUrl, clientId, clientSecret }
}

let cachedToken: { value: string; expiresAt: number } | null = null

async function accessToken() {
  const config = readConfig()
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return { token: cachedToken.value, config }
  const response = await fetch(`${config.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  })
  const payload = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number } & PayPalError
  if (!response.ok || !payload.access_token) throw responseError(response.status, payload)
  cachedToken = { value: payload.access_token, expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 300) * 1000 }
  return { token: cachedToken.value, config }
}

function responseError(status: number, payload: PayPalError) {
  const detail = payload.details?.[0]
  const message = detail?.description ?? payload.message ?? 'PayPal could not process this request.'
  if (status === 401 || status === 403) return new PayPalClientError('PAYPAL_AUTHENTICATION_FAILED', 'PayPal Sandbox credentials were rejected.')
  if (status === 409 || status === 422) return new PayPalClientError(detail?.issue ?? payload.name ?? 'PAYPAL_ORDER_REJECTED', message)
  return new PayPalClientError('PAYPAL_UNAVAILABLE', 'PayPal is temporarily unavailable. Please try again.', status >= 500 || status === 429)
}

async function paypalFetch(path: string, init: RequestInit) {
  const { token, config } = await accessToken()
  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...init.headers },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw responseError(response.status, payload as PayPalError)
  return payload
}

export function paypalPublicConfig() {
  const config = readConfig()
  return { clientId: config.clientId, environment: config.environment }
}

export async function createPayPalOrder(input: { purchaseId: string; amount: string; currency: string; description: string }) {
  return await paypalFetch('/v2/checkout/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PayPal-Request-Id': input.purchaseId,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: input.purchaseId, description: input.description, amount: { currency_code: input.currency, value: input.amount } }],
      application_context: { user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' },
    }),
  }) as Promise<PayPalOrder>
}

export async function capturePayPalOrder(orderId: string, requestId: string) {
  return await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'PayPal-Request-Id': requestId, Prefer: 'return=representation' },
  }) as Promise<PayPalOrder>
}

export async function getPayPalOrder(orderId: string) {
  return await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: { Prefer: 'return=representation' },
  }) as Promise<PayPalOrder>
}

export async function createPayPalSubscription(input: {
  localSubscriptionId: string
  planId: string
  returnUrl: string
  cancelUrl: string
}) {
  return await paypalFetch('/v1/billing/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'PayPal-Request-Id': input.localSubscriptionId, Prefer: 'return=representation' },
    body: JSON.stringify({
      plan_id: input.planId,
      custom_id: input.localSubscriptionId,
      application_context: {
        brand_name: 'CEZIK AI Studio', user_action: 'SUBSCRIBE_NOW', shipping_preference: 'NO_SHIPPING',
        return_url: input.returnUrl, cancel_url: input.cancelUrl,
      },
    }),
  }) as Promise<PayPalSubscription>
}

export async function getPayPalSubscription(subscriptionId: string) {
  return await paypalFetch(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'GET', headers: { Prefer: 'return=representation' },
  }) as Promise<PayPalSubscription>
}

export async function verifyPayPalWebhook(input: {
  authAlgo: string | null
  certUrl: string | null
  transmissionId: string | null
  transmissionSig: string | null
  transmissionTime: string | null
  webhookEvent: unknown
}) {
  const webhookId = Deno.env.get('PAYPAL_WEBHOOK_ID')
  if (!webhookId) throw new PayPalClientError('PAYPAL_WEBHOOK_CONFIGURATION_MISSING', 'PayPal webhook configuration is incomplete.')
  if (!input.authAlgo || !input.certUrl || !input.transmissionId || !input.transmissionSig || !input.transmissionTime) return false
  const verified = await paypalFetch('/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: input.authAlgo,
      cert_url: input.certUrl,
      transmission_id: input.transmissionId,
      transmission_sig: input.transmissionSig,
      transmission_time: input.transmissionTime,
      webhook_id: webhookId,
      webhook_event: input.webhookEvent,
    }),
  }) as { verification_status?: string }
  return verified.verification_status === 'SUCCESS'
}

export function completedCapture(order: PayPalOrder) {
  const capture = order.purchase_units?.flatMap((unit) => unit.payments?.captures ?? []).find((item) => item.status === 'COMPLETED')
  const amount = capture?.amount
  if (order.status !== 'COMPLETED' || !capture?.id || !amount?.value || !amount.currency_code) return null
  return { captureId: capture.id, amount: amount.value, currency: amount.currency_code }
}
