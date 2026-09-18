import { createClient } from 'npm:@supabase/supabase-js@2'

type WorkerRequest = { jobId?: string }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

Deno.serve(async (request) => {
  // This endpoint is intentionally not callable by the browser. Invoke it from
  // a scheduled worker, queue consumer, or verified provider callback only.
  const workerSecret = Deno.env.get('CEZIK_WORKER_SECRET')
  if (!workerSecret || request.headers.get('x-cezik-worker-secret') !== workerSecret) {
    return json({ error: 'Unauthorized worker' }, 401)
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) return json({ error: 'Server configuration is incomplete' }, 500)

  const { jobId }: WorkerRequest = await request.json()
  if (!jobId) return json({ error: 'jobId is required' }, 400)

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: job, error } = await admin
    .from('ai_jobs')
    .select('*, ai_activities (*)')
    .eq('id', jobId)
    .maybeSingle()
  if (error || !job) return json({ error: 'Job not found' }, 404)
  if (job.status !== 'queued') return json({ job, message: 'Job has already been handled' })

  await admin.from('ai_jobs').update({
    status: 'processing',
    started_at: new Date().toISOString(),
  }).eq('id', job.id)

  // Provider adapters belong here. Keep API keys in Edge Function secrets and
  // route by job.provider; never put a provider key or price in the client.
  // Until a real provider is configured, fail and refund rather than producing
  // a fake paid result.
  await admin.rpc('fail_ai_job', {
    p_job_id: job.id,
    p_error_message: 'No video provider has been configured for this activity.',
    p_refund: true,
  })
  return json({ jobId: job.id, status: 'failed_refunded' })
})

