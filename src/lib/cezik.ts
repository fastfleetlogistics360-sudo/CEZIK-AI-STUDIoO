import type { SupabaseClient } from '@supabase/supabase-js'

export type AiActivity = {
  id: string
  slug: string
  name: string
  description: string
  credit_cost: number
  provider: string | null
  enabled: boolean
}

export type Creation = {
  id: string
  title: string
  type: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  storage_bucket: string
  storage_path: string | null
  preview_path: string | null
  metadata: Record<string, unknown>
  created_at: string
  assetUrl: string | null
}

export type CreditPackage = {
  id: string
  name: string
  credits: number
  price: number
  currency: string
  description: string | null
  sort_order: number
}

export type StudioData = {
  balance: number
  activity: AiActivity | null
  imageActivity: AiActivity | null
  creations: Creation[]
  packages: CreditPackage[]
}

const emptyStudioData: StudioData = {
  balance: 0,
  activity: null,
  imageActivity: null,
  creations: [],
  packages: [],
}

export async function loadStudioData(client: SupabaseClient): Promise<StudioData> {
  const [wallet, activity, creations, packages] = await Promise.all([
    client.from('credit_wallets').select('balance').maybeSingle(),
    client.from('ai_activities').select('id, slug, name, description, credit_cost, provider, enabled').in('slug', ['video-generation', 'image-generation']),
    client.from('creations').select('id, title, type, status, storage_bucket, storage_path, preview_path, metadata, created_at').order('created_at', { ascending: false }).limit(24),
    client.from('credit_packages').select('id, name, credits, price, currency, description, sort_order').eq('active', true).order('sort_order'),
  ])

  const errors = [wallet.error, activity.error, creations.error, packages.error].filter(Boolean)
  if (errors.length > 0) throw errors[0]

  const creationRows = creations.data ?? []
  const creationsWithUrls = await Promise.all(creationRows.map(async (creation) => {
    if (!creation.storage_path) return { ...creation, assetUrl: null }
    const { data } = await client.storage.from(creation.storage_bucket ?? 'cezik-creations').createSignedUrl(creation.storage_path, 60 * 60)
    return { ...creation, assetUrl: data?.signedUrl ?? null }
  }))
  const activities = activity.data ?? []

  return {
    balance: wallet.data?.balance ?? emptyStudioData.balance,
    activity: activities.find((item) => item.slug === 'video-generation') ?? null,
    imageActivity: activities.find((item) => item.slug === 'image-generation') ?? null,
    creations: creationsWithUrls,
    packages: packages.data ?? [],
  }
}

export function isActivityAvailable(activity: AiActivity | null) {
  return Boolean(activity?.enabled && activity.provider)
}
