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

export type CreditPurchase = {
  id: string
  credit_amount: number
  amount: number
  currency: string
  provider: string
  status: string
  created_at: string
  credit_packages: { name: string } | null
}

export type Profile = {
  display_name: string | null
  email: string | null
  created_at: string
}

export type CreditTransaction = {
  id: string
  type: string
  amount: number
  balance_after: number
  description: string
  created_at: string
}

export type StudioData = {
  profile: Profile | null
  balance: number
  activity: AiActivity | null
  imageActivity: AiActivity | null
  creations: Creation[]
  packages: CreditPackage[]
  purchases: CreditPurchase[]
  transactions: CreditTransaction[]
}

const emptyStudioData: StudioData = {
  profile: null,
  balance: 0,
  activity: null,
  imageActivity: null,
  creations: [],
  packages: [],
  purchases: [],
  transactions: [],
}

export async function loadStudioData(client: SupabaseClient): Promise<StudioData> {
  const [profile, wallet, activity, creations, packages, purchases, transactions] = await Promise.all([
    client.from('profiles').select('display_name, email, created_at').maybeSingle(),
    client.from('credit_wallets').select('balance').maybeSingle(),
    client.from('ai_activities').select('id, slug, name, description, credit_cost, provider, enabled').in('slug', ['video-generation', 'image-generation']),
    client.from('creations').select('id, title, type, status, storage_bucket, storage_path, preview_path, metadata, created_at').order('created_at', { ascending: false }).limit(24),
    client.from('credit_packages').select('id, name, credits, price, currency, description, sort_order').eq('active', true).order('sort_order'),
    client.from('credit_purchases').select('id, credit_amount, amount, currency, provider, status, created_at, credit_packages(name)').order('created_at', { ascending: false }).limit(8),
    client.from('credit_transactions').select('id, type, amount, balance_after, description, created_at').order('created_at', { ascending: false }).limit(12),
  ])

  const errors = [profile.error, wallet.error, activity.error, creations.error, packages.error, purchases.error, transactions.error].filter(Boolean)
  if (errors.length > 0) throw errors[0]

  const creationRows = creations.data ?? []
  const creationsWithUrls = await Promise.all(creationRows.map(async (creation) => {
    if (!creation.storage_path) return { ...creation, assetUrl: null }
    const { data } = await client.storage.from(creation.storage_bucket ?? 'cezik-creations').createSignedUrl(creation.storage_path, 60 * 60)
    return { ...creation, assetUrl: data?.signedUrl ?? null }
  }))
  const activities = activity.data ?? []

  return {
    profile: profile.data ?? emptyStudioData.profile,
    balance: wallet.data?.balance ?? emptyStudioData.balance,
    activity: activities.find((item) => item.slug === 'video-generation') ?? null,
    imageActivity: activities.find((item) => item.slug === 'image-generation') ?? null,
    creations: creationsWithUrls,
    packages: packages.data ?? [],
    purchases: (purchases.data ?? []).map((purchase) => ({
      ...purchase,
      credit_packages: Array.isArray(purchase.credit_packages) ? purchase.credit_packages[0] ?? null : purchase.credit_packages,
    })) as CreditPurchase[],
    transactions: (transactions.data ?? []) as CreditTransaction[],
  }
}

export function isActivityAvailable(activity: AiActivity | null) {
  return Boolean(activity?.enabled && activity.provider)
}
