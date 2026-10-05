import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { createPayPalSubscription, PayPalClientError } from '../_shared/paypal.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const authorization = request.headers.get('Authorization')
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const planId = Deno.env.get('PAYPAL_PREMIUM_PLAN_ID')
  const appUrl = Deno.env.get('CEZIK_APP_URL')
  if (!authorization || !url || !anonKey || !serviceRoleKey) return json({ error: 'Authentication required' }, 401)
  if (!planId || !appUrl) return json({ error: 'Premium checkout is not configured yet.' }, 503)

  let billingUrl: URL
  try { billingUrl = new URL(appUrl) } catch { return json({ error: 'Premium checkout URL is misconfigured.' }, 503) }
  if (!['https:', 'http:'].includes(billingUrl.protocol)) return json({ error: 'Premium checkout URL is misconfigured.' }, 503)
  billingUrl.pathname = '/billing'
  const returnUrl = new URL(billingUrl); returnUrl.searchParams.set('subscription', 'approved')
  const cancelUrl = new URL(billingUrl); cancelUrl.searchParams.set('subscription', 'cancelled')

  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return json({ error: 'Authentication required' }, 401)
  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: plan, error: planError } = await admin.from('subscription_plans')
    .select('id').eq('code', 'premium').eq('active', true).maybeSingle()
  if (planError || !plan) return json({ error: 'The Premium plan is unavailable.' }, 503)

  const { data: existing } = await admin.from('user_subscriptions').select('id, status')
    .eq('user_id', user.id).eq('plan_id', plan.id).in('status', ['approval_pending', 'active', 'past_due', 'suspended']).maybeSingle()
  if (existing?.status === 'active') return json({ error: 'Your CEZIK Premium subscription is already active.' }, 409)
  if (existing?.status === 'approval_pending') return json({ error: 'A Premium checkout is already awaiting approval.' }, 409)

  const { data: subscription, error: insertError } = await admin.from('user_subscriptions').insert({
    user_id: user.id, plan_id: plan.id, provider: 'paypal', status: 'approval_pending',
  }).select('id').single()
  if (insertError || !subscription) return json({ error: 'Could not start Premium checkout.' }, 503)

  try {
    const paypalSubscription = await createPayPalSubscription({
      localSubscriptionId: subscription.id, planId, returnUrl: returnUrl.href, cancelUrl: cancelUrl.href,
    })
    const approveUrl = paypalSubscription.links?.find((link) => link.rel === 'approve')?.href
    if (!paypalSubscription.id || !approveUrl) throw new PayPalClientError('PAYPAL_SUBSCRIPTION_INVALID', 'PayPal did not return a subscription approval link.')
    const { error: updateError } = await admin.from('user_subscriptions').update({
      provider_subscription_id: paypalSubscription.id,
      provider_metadata: { paypal_status: paypalSubscription.status, paypal_plan_id: planId },
    }).eq('id', subscription.id)
    if (updateError) return json({ error: 'Premium checkout was created but could not be recorded. Please contact support.' }, 503)
    return json({ approveUrl })
  } catch (error) {
    await admin.from('user_subscriptions').update({ status: 'cancelled' }).eq('id', subscription.id)
    const message = error instanceof PayPalClientError ? error.message : 'PayPal could not start Premium checkout.'
    return json({ error: message }, 503)
  }
})
