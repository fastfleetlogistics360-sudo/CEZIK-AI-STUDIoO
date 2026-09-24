import { createClient } from 'npm:@supabase/supabase-js@2'
import { resolveImageGenerationProvider, type ImageSize } from '../_shared/image-providers.ts'

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

  let payload: WorkerRequest
  try {
    payload = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }
  const { jobId } = payload
  if (!jobId) return json({ error: 'jobId is required' }, 400)

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })
  const { data: job, error } = await admin
    .from('ai_jobs')
    .select('*, ai_activities (*)')
    .eq('id', jobId)
    .maybeSingle()
  if (error || !job) return json({ error: 'Job not found' }, 404)
  if (job.status !== 'queued') return json({ job, message: 'Job has already been handled' })

  const { data: claimedJobs, error: processingError } = await admin.from('ai_jobs').update({
    status: 'processing',
    started_at: new Date().toISOString(),
  }).eq('id', job.id).eq('status', 'queued').select('id')
  if (processingError) return json({ error: 'Could not start generation' }, 500)
  if (!claimedJobs?.length) return json({ job: { ...job, status: 'processing' }, message: 'Job is already being processed' }, 202)

  const apiKey = Deno.env.get('OPENAI_API_KEY')
  const imageProvider = resolveImageGenerationProvider(job.provider, { openAiApiKey: apiKey })
  if (job.ai_activities?.slug !== 'image-generation' || !imageProvider) {
    await admin.rpc('fail_ai_job', {
      p_job_id: job.id,
      p_error_message: 'No provider adapter has been configured for this activity.',
      p_refund: true,
    })
    return json({ error: 'This generation provider is not configured. No credits were used.' }, 503)
  }

  const prompt = typeof job.input_data?.prompt === 'string' ? job.input_data.prompt.trim() : ''
  const requestedSize = typeof job.input_data?.size === 'string' ? job.input_data.size : '1024x1024'
  const size: ImageSize = ['1024x1024', '1536x1024', '1024x1536'].includes(requestedSize) ? requestedSize as ImageSize : '1024x1024'
  if (!prompt || prompt.length > 2000) {
    await admin.rpc('fail_ai_job', {
      p_job_id: job.id,
      p_error_message: 'Invalid image-generation input.',
      p_refund: true,
    })
    return json({ error: 'Invalid image prompt. No credits were used.' }, 503)
  }

  try {
    const result = await imageProvider.generate({
      prompt,
      size,
      outputFormat: 'png',
      jobId: job.id,
      userId: job.user_id,
    })
    const storagePath = `${job.user_id}/${job.id}/image.${result.extension}`
    const { error: storageError } = await admin.storage.from('cezik-creations').upload(storagePath, result.bytes, {
      contentType: result.contentType,
      upsert: false,
    })
    if (storageError) throw new Error('The generated image could not be saved.')

    const { data: creation, error: completionError } = await admin.rpc('complete_ai_job', {
      p_job_id: job.id,
      p_output_data: result.metadata,
      p_title: prompt.length > 72 ? `${prompt.slice(0, 69)}…` : prompt,
      p_creation_type: 'image',
      p_storage_path: storagePath,
      p_preview_path: storagePath,
    })
    if (completionError) throw new Error('The generated image could not be recorded.')
    return json({ job: { ...job, status: 'completed' }, creation })
  } catch (error) {
    await admin.rpc('fail_ai_job', {
      p_job_id: job.id,
      p_error_message: error instanceof Error ? error.message : 'Image generation failed.',
      p_refund: true,
    })
    return json({ error: 'Image generation failed. Your credits were refunded.' }, 502)
  }
})
