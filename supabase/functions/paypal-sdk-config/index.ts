import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { PayPalClientError, paypalPublicConfig } from '../_shared/paypal.ts'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
  const authorization = request.headers.get('Authorization')
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!authorization || !url || !anonKey) return json({ error: 'Authentication required' }, 401)
  const auth = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: { user } } = await auth.auth.getUser()
  if (!user) return json({ error: 'Authentication required' }, 401)
  try {
    // The client ID is intentionally returned for loading PayPal's browser SDK;
    // the client secret is never returned or named in this response.
    return json(paypalPublicConfig())
  } catch (error) {
    const message = error instanceof PayPalClientError ? error.message : 'PayPal Sandbox is unavailable.'
    return json({ error: message }, 503)
  }
})
