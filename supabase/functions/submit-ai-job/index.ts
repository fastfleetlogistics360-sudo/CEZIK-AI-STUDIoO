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
  if (!['video-generation', 'image-generation'].includes(payload.activitySlug ?? '') || !prompt || prompt.length > 2000) {
    return json({ error: 'Provide a valid generation prompt of up to 2,000 characters' }, 400)
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

  // The browser never receives the worker secret. Calling the trusted worker
  // here makes synchronous image providers usable tonight; a queue or provider
  // webhook can use this same worker for longer-running activities later.
  const workerSecret = Deno.env.get('CEZIK_WORKER_SECRET')
  if (!workerSecret) {
    await admin.rpc('fail_ai_job', {
      p_job_id: job.id,
      p_error_message: 'The generation worker is not configured.',
      p_refund: true,
    })
    return json({ error: 'Generation is not configured yet. No credits were used.' }, 503)
  }

  try {
    const workerResponse = await fetch(`${url}/functions/v1/process-ai-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cezik-worker-secret': workerSecret },
      body: JSON.stringify({ jobId: job.id }),
    })
    const workerResult = await workerResponse.json().catch(() => null)
    if (!workerResponse.ok || workerResult?.error) {
      return json({ error: workerResult?.error ?? 'Generation could not be processed. Your credits were refunded if applicable.' }, 502)
    }
    return json({ job: workerResult.job ?? job, creation: workerResult.creation ?? null }, 200)
  } catch {
    await admin.rpc('fail_ai_job', {
      p_job_id: job.id,
      p_error_message: 'The generation worker could not be reached.',
      p_refund: true,
    })
    return json({ error: 'Generation could not be processed. No credits were used.' }, 502)
  }
})
