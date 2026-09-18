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
  storage_path: string | null
  preview_path: string | null
  metadata: Record<string, unknown>
  created_at: string
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
  creations: Creation[]
  packages: CreditPackage[]
}

const emptyStudioData: StudioData = {
  balance: 0,
  activity: null,
  creations: [],
  packages: [],
}

export async function loadStudioData(client: SupabaseClient): Promise<StudioData> {
  const [wallet, activity, creations, packages] = await Promise.all([
    client.from('credit_wallets').select('balance').maybeSingle(),
    client.from('ai_activities').select('id, slug, name, description, credit_cost, provider, enabled').eq('slug', 'video-generation').maybeSingle(),
    client.from('creations').select('id, title, type, status, storage_path, preview_path, metadata, created_at').order('created_at', { ascending: false }).limit(24),
    client.from('credit_packages').select('id, name, credits, price, currency, description, sort_order').eq('active', true).order('sort_order'),
  ])

  const errors = [wallet.error, activity.error, creations.error, packages.error].filter(Boolean)
  if (errors.length > 0) throw errors[0]

  return {
    balance: wallet.data?.balance ?? emptyStudioData.balance,
    activity: activity.data,
    creations: creations.data ?? [],
    packages: packages.data ?? [],
  }
}

export function isActivityAvailable(activity: AiActivity | null) {
  return Boolean(activity?.enabled && activity.provider)
}

