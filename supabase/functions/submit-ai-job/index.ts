import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

type JobRequest = {
  activitySlug?: string
  input?: Record<string, unknown>
  idempotencyKey?: string
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('Authorization')
  if (!authorization) return json({ error: 'Authentication required' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !serviceRoleKey || !anonKey) return json({ error: 'Server configuration is incomplete' }, 500)

  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: { user }, error: userError } = await authClient.auth.getUser()
  if (userError || !user) return json({ error: 'Authentication required' }, 401)

  let payload: JobRequest
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const prompt = typeof payload.input?.prompt === 'string' ? payload.input.prompt.trim() : ''
  if (payload.activitySlug !== 'video-generation' || !prompt || prompt.length > 2000) {
    return json({ error: 'Provide a valid video prompt of up to 2,000 characters' }, 400)
  }
  if (!payload.idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.idempotencyKey)) {
    return json({ error: 'A valid idempotency key is required' }, 400)
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: job, error: jobError } = await admin.rpc('start_ai_job', {
    p_user_id: user.id,
    p_activity_slug: payload.activitySlug,
    p_input_data: payload.input,
    p_idempotency_key: payload.idempotencyKey,
  })

  if (jobError) {
    const message = jobError.message.includes('Insufficient credits')
      ? 'You do not have enough CEZIK Credits for this generation.'
      : jobError.message
    return json({ error: message }, 400)
  }

  // A trusted worker or provider webhook owns the next transition. The browser
  // only receives the queued job and can safely poll its own job record.
  return json({ job }, 202)
})

