import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { capturePayPalOrder, completedCapture, getPayPalOrder, PayPalClientError } from '../_shared/paypal.ts'

type RequestBody = { purchaseId?: string }
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
  if (!body?.purchaseId) return json({ error: 'A credit purchase is required.' }, 400)

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: purchase, error: purchaseError } = await admin.from('credit_purchases')
    .select('id, user_id, paypal_order_id, status')
    .eq('id', body.purchaseId).eq('user_id', user.id).eq('provider', 'paypal').maybeSingle()
  if (purchaseError || !purchase || !purchase.paypal_order_id) return json({ error: 'Credit purchase not found.' }, 404)
  if (purchase.status === 'credited') {
    const { data: wallet } = await admin.from('credit_wallets').select('balance').eq('user_id', user.id).maybeSingle()
    return json({ status: 'credited', balance: wallet?.balance ?? 0 })
  }

  try {
    let order = await getPayPalOrder(purchase.paypal_order_id)
    let capture = completedCapture(order)
    if (!capture) {
      order = await capturePayPalOrder(purchase.paypal_order_id, purchase.id)
      capture = completedCapture(order)
    }
    if (!capture) return json({ error: 'PayPal has not completed this payment.' }, 409)
    const { data: balance, error: creditError } = await admin.rpc('confirm_paypal_credit_purchase', {
      p_purchase_id: purchase.id,
      p_paypal_order_id: purchase.paypal_order_id,
      p_paypal_capture_id: capture.captureId,
      p_amount: capture.amount,
      p_currency: capture.currency,
    })
    if (creditError) return json({ error: 'The payment was received but CEZIK could not confirm its credit grant.' }, 503)
    return json({ status: 'credited', balance })
  } catch (error) {
    const message = error instanceof PayPalClientError ? error.message : 'PayPal could not capture this payment.'
    return json({ error: message }, 503)
  }
})
