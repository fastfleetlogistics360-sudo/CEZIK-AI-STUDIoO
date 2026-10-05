import { createClient } from 'npm:@supabase/supabase-js@2'
import { getPayPalSubscription, PayPalClientError, verifyPayPalWebhook } from '../_shared/paypal.ts'

type PayPalWebhook = {
  id?: string
  event_type?: string
  create_time?: string
  resource?: {
    id?: string; status?: string; billing_agreement_id?: string; subscription_id?: string
    amount?: { value?: string; currency_code?: string }
    billing_info?: { next_billing_time?: string; last_payment?: { time?: string } }
    supplementary_data?: { related_ids?: { order_id?: string } }
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const rawBody = await request.text()
  let event: PayPalWebhook
  try { event = JSON.parse(rawBody) } catch { return json({ error: 'Invalid webhook payload' }, 400) }
  if (!event.id || !event.event_type) return json({ error: 'Invalid webhook event' }, 400)

  const transmissionTime = request.headers.get('paypal-transmission-time')
  const transmissionTimestamp = transmissionTime ? Date.parse(transmissionTime) : Number.NaN
  if (!Number.isFinite(transmissionTimestamp) || Math.abs(Date.now() - transmissionTimestamp) > 5 * 60 * 1000) {
    return json({ error: 'Stale PayPal webhook transmission' }, 401)
  }

  try {
    const verified = await verifyPayPalWebhook({
      authAlgo: request.headers.get('paypal-auth-algo'), certUrl: request.headers.get('paypal-cert-url'),
      transmissionId: request.headers.get('paypal-transmission-id'), transmissionSig: request.headers.get('paypal-transmission-sig'),
      transmissionTime, webhookEvent: event,
    })
    if (!verified) return json({ error: 'Invalid PayPal webhook signature' }, 401)
  } catch (error) {
    const message = error instanceof PayPalClientError ? error.message : 'Could not verify PayPal webhook.'
    return json({ error: message }, 503)
  }

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) return json({ error: 'Server configuration is incomplete' }, 500)
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { error: insertError } = await admin.from('billing_webhook_events').insert({
    provider: 'paypal', environment: 'sandbox', provider_event_id: event.id, event_type: event.event_type,
    provider_created_at: event.create_time ?? null, payload_hash: await sha256(rawBody),
  })
  if (insertError) {
    if (insertError.code === '23505') {
      const { data: existing } = await admin.from('billing_webhook_events').select('processing_status, processing_attempts')
        .eq('provider', 'paypal').eq('environment', 'sandbox').eq('provider_event_id', event.id).maybeSingle()
      if (existing?.processing_status !== 'failed') return json({ status: 'already_processed' })
      const { data: retried, error: retryError } = await admin.from('billing_webhook_events').update({
        processing_status: 'received', processing_attempts: existing.processing_attempts + 1, error_code: null,
      }).eq('provider', 'paypal').eq('environment', 'sandbox').eq('provider_event_id', event.id).eq('processing_status', 'failed').select('id')
      if (retryError) return json({ error: 'Could not resume PayPal webhook processing.' }, 503)
      if (!retried?.length) return json({ status: 'already_processing' })
    } else {
      return json({ error: 'Could not record PayPal webhook.' }, 503)
    }
  }

  const orderId = event.resource?.supplementary_data?.related_ids?.order_id
  const captureId = event.resource?.id
  const amount = event.resource?.amount?.value
  const currency = event.resource?.amount?.currency_code
  try {
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      if (!orderId || !captureId || !amount || !currency) throw new Error('Missing PayPal capture fields')
      const { data: purchase, error: purchaseError } = await admin.from('credit_purchases').select('id')
        .eq('provider', 'paypal').eq('paypal_order_id', orderId).maybeSingle()
      if (purchaseError || !purchase) {
        await admin.from('billing_webhook_events').update({ processing_status: 'ignored', processed_at: new Date().toISOString() }).eq('provider_event_id', event.id).eq('provider', 'paypal').eq('environment', 'sandbox')
        return json({ status: 'ignored' })
      }
      const { error: creditError } = await admin.rpc('confirm_paypal_credit_purchase', {
        p_purchase_id: purchase.id, p_paypal_order_id: orderId, p_paypal_capture_id: captureId, p_amount: amount, p_currency: currency,
      })
      if (creditError) throw new Error('Could not confirm credit purchase')
    } else if (event.event_type.startsWith('BILLING.SUBSCRIPTION.') || event.event_type.startsWith('PAYMENT.SALE.')) {
      const providerSubscriptionId = event.resource?.id && event.event_type.startsWith('BILLING.SUBSCRIPTION.')
        ? event.resource.id
        : event.resource?.billing_agreement_id ?? event.resource?.subscription_id
      if (!providerSubscriptionId) throw new Error('Missing PayPal subscription ID')
      const { data: localSubscription, error: subscriptionError } = await admin.from('user_subscriptions')
        .select('id').eq('provider', 'paypal').eq('provider_subscription_id', providerSubscriptionId).maybeSingle()
      if (subscriptionError || !localSubscription) {
        await admin.from('billing_webhook_events').update({ processing_status: 'ignored', processed_at: new Date().toISOString() }).eq('provider_event_id', event.id).eq('provider', 'paypal').eq('environment', 'sandbox')
        return json({ status: 'ignored' })
      }
      const verifiedSubscription = await getPayPalSubscription(providerSubscriptionId)
      const statusMap: Record<string, string> = { ACTIVE: 'active', SUSPENDED: 'suspended', CANCELLED: 'cancelled', EXPIRED: 'expired' }
      const status = statusMap[verifiedSubscription.status] ?? 'past_due'
      const periodEnd = verifiedSubscription.billing_info?.next_billing_time ?? null
      await admin.from('user_subscriptions').update({
        status, current_period_end: periodEnd, provider_metadata: { paypal_status: verifiedSubscription.status },
      }).eq('id', localSubscription.id)
      if (status === 'active' && (event.event_type === 'BILLING.SUBSCRIPTION.ACTIVATED' || event.event_type === 'PAYMENT.SALE.COMPLETED')) {
        const periodKey = verifiedSubscription.billing_info?.last_payment?.time ?? verifiedSubscription.billing_info?.next_billing_time ?? event.id
        const { error: allowanceError } = await admin.rpc('grant_subscription_allowance', { p_provider_subscription_id: providerSubscriptionId, p_period_key: periodKey })
        if (allowanceError) throw new Error('Could not grant Premium allowance')
      }
    } else if (event.event_type === 'PAYMENT.CAPTURE.DENIED' || event.event_type === 'CHECKOUT.PAYMENT-APPROVAL.REVERSED') {
      if (orderId) await admin.from('credit_purchases').update({ status: 'failed' })
        .eq('provider', 'paypal').eq('paypal_order_id', orderId).in('status', ['created', 'approved', 'captured'])
    } else {
      await admin.from('billing_webhook_events').update({ processing_status: 'ignored', processed_at: new Date().toISOString() }).eq('provider_event_id', event.id).eq('provider', 'paypal').eq('environment', 'sandbox')
      return json({ status: 'ignored' })
    }
    await admin.from('billing_webhook_events').update({ processing_status: 'processed', processed_at: new Date().toISOString() }).eq('provider_event_id', event.id).eq('provider', 'paypal').eq('environment', 'sandbox')
    return json({ status: 'processed' })
  } catch {
    await admin.from('billing_webhook_events').update({ processing_status: 'failed', error_code: 'PROCESSING_FAILED' }).eq('provider_event_id', event.id).eq('provider', 'paypal').eq('environment', 'sandbox')
    return json({ error: 'Could not process PayPal webhook.' }, 503)
  }
})
