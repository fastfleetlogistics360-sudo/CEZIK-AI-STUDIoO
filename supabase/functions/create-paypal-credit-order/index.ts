import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { createPayPalOrder, PayPalClientError } from '../_shared/paypal.ts'

type RequestBody = { packageId?: string }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const authorization = request.headers.get('Authorization')
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization || !url || !anonKey || !serviceRoleKey) return json({ error: 'Authentication required' }, 401)
  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return json({ error: 'Authentication required' }, 401)
  const body = await request.json().catch(() => null) as RequestBody | null
  if (!body?.packageId) return json({ error: 'A credit package is required.' }, 400)

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: creditPackage, error: packageError } = await admin
    .from('credit_packages')
    .select('id, name, credits, price, currency, active')
    .eq('id', body.packageId)
    .eq('active', true)
    .maybeSingle()
  if (packageError || !creditPackage) return json({ error: 'That credit package is unavailable.' }, 404)

  const { data: purchase, error: purchaseError } = await admin.from('credit_purchases').insert({
    user_id: user.id,
    credit_package_id: creditPackage.id,
    credit_amount: creditPackage.credits,
    amount: creditPackage.price,
    currency: creditPackage.currency.toUpperCase(),
    provider: 'paypal',
  }).select('id').single()
  if (purchaseError || !purchase) return json({ error: 'Could not start this credit purchase.' }, 500)

  try {
    const order = await createPayPalOrder({
      purchaseId: purchase.id,
      amount: Number(creditPackage.price).toFixed(2),
      currency: creditPackage.currency.toUpperCase(),
      description: `${creditPackage.name} — ${creditPackage.credits} CEZIK Credits`,
    })
    if (!order.id) throw new PayPalClientError('PAYPAL_ORDER_INVALID', 'PayPal did not return an order.')
    const { error: updateError } = await admin.from('credit_purchases').update({
      paypal_order_id: order.id,
      status: order.status === 'APPROVED' ? 'approved' : 'created',
      provider_metadata: { order_status: order.status },
    }).eq('id', purchase.id)
    if (updateError) return json({ error: 'The PayPal order was created but CEZIK could not record it. Please contact support.' }, 503)
    return json({ purchaseId: purchase.id, orderId: order.id })
  } catch (error) {
    await admin.from('credit_purchases').update({ status: 'failed' }).eq('id', purchase.id)
    const message = error instanceof PayPalClientError ? error.message : 'PayPal could not start this checkout.'
    return json({ error: message }, 503)
  }
})
